/**
 * Chat de diseño con IA, compartido por la Galería (asistente paso a paso) y el editor (diálogo del botón flotante).
 * La conversación vive en el servidor; este módulo sólo la dibuja y manda los mensajes.
 *
 * Preguntas: vienen en formularios (una o varias, una debajo de la otra). Las de opción única se contestan con un
 * clic; si el formulario tiene alguna de opción múltiple, se confirma con «Enviar».
 *
 * Adjuntos: con el clip (o pegando una imagen en el campo) se manda la foto o captura de un plano para que el asistente
 * lo calque. La imagen viaja reducida y sólo con ese mensaje.
 */
import { h, add, clear, svgEl } from './dom.js';
import { fmt, int } from './format.js';
import { clientId } from './client.js';

export { clientId };

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_SIDE = 1600; // px del lado mayor: alcanza para leer las cotas de un plano
const IMAGE_MAX = 900000; // caracteres en base64 (el servidor admite hasta 1 000 000)
const CLIP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2"/></svg>';

/** Imagen lista para mandar: reducida y en JPEG, para que el mensaje no pase el tamaño admitido. */
async function shrinkImage(file) {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('Sólo se pueden adjuntar imágenes JPG, PNG o WebP.');
    const source = await new Promise((ok, fail) => {
        const r = new window.FileReader();
        r.onload = () => ok(r.result);
        r.onerror = () => fail(new Error('No se pudo leer la imagen.'));
        r.readAsDataURL(file);
    });
    const img = await new Promise((ok, fail) => {
        const i = new window.Image();
        i.onload = () => ok(i);
        i.onerror = () => fail(new Error('No se pudo leer la imagen.'));
        i.src = source;
    });
    let side = IMAGE_SIDE;
    for (;;) {
        const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // los PNG con transparencia quedan sobre blanco
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', 0.85);
        const datos = url.slice(url.indexOf(',') + 1);
        if (datos.length <= IMAGE_MAX || side <= 600) return { tipo: 'image/jpeg', datos, url };
        side = Math.round(side * 0.8);
    }
}

export async function api(url, body) {
    const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) } : { headers: { Accept: 'application/json' } });
    let data = null;
    try { data = await res.json(); } catch { /* vacío */ }
    if (!res.ok) {
        const msg = data?.error === 'invalid_project' ? 'El proyecto actual no es válido para el asistente.' : (data?.error ?? `Error ${res.status}`);
        throw Object.assign(new Error(msg), { status: res.status });
    }
    return data;
}

/** Miniatura SVG del servidor como imagen (sin insertar HTML). */
export const thumb = (svg, alt, cls = 'ai-thumb') => h('img', { class: cls, alt, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });

export const kpis = (r) => h('div', { class: 'ai-kpis' },
    h('span', {}, `${fmt(r.superficieUtilM2, 1)} m²`),
    h('span', {}, `${r.niveles} planta${r.niveles > 1 ? 's' : ''}`),
    h('span', {}, `${int(r.bloques)} bloques`),
    h('span', {}, `${r.moneda} ${int(r.costoReferencia)}`));

export function reviewLine(r) {
    const errors = r.observaciones.filter((o) => o.severidad === 'error').length;
    const warns = r.observaciones.length - errors;
    if (!errors && !warns) return h('p', { class: 'small ai-ok' }, '✓ Sin observaciones');
    return h('p', { class: `small ${errors ? 'ai-err' : 'ai-warn'}` }, [errors ? `${errors} error(es)` : '', warns ? `${warns} advertencia(s)` : ''].filter(Boolean).join(' y '));
}

/**
 * @param {object} o
 * @param {HTMLElement} o.log      contenedor de mensajes
 * @param {HTMLFormElement} o.form formulario de texto libre (input[type=text] + submit)
 * @param {'galeria'|'editor'} o.mode
 * @param {(ev, isLast) => Node} o.house   tarjeta de una casa
 * @param {(conv) => string[]} o.suggestions pedidos rápidos después de una casa
 * @param {() => object} [o.extra]  datos que viajan con cada mensaje (p. ej. el proyecto del editor)
 * @param {(conv, fresh) => void} [o.onChange]  después de cada respuesta del servidor (fresh: eventos nuevos)
 */
export function createChat(o) {
    const client = clientId();
    const input = o.form.querySelector('input[type="text"]');
    const placeholder = input.placeholder;
    let conv = null;
    let busy = false;

    // Plano adjunto: el clip elige la imagen; con una ya elegida muestra su miniatura y un clic la quita.
    let attached = null;
    const picker = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
    const clip = h('button', { type: 'button', class: 'btn btn-outline ai-attach' });
    function showAttached() {
        clear(clip);
        clip.classList.toggle('on', Boolean(attached));
        add(clip, attached ? [h('img', { src: attached.url, alt: '' }), h('span', { 'aria-hidden': 'true' }, '×')] : svgEl(CLIP));
        clip.title = attached ? 'Quitar el plano adjunto' : 'Adjuntar la imagen de un plano para calcarlo';
        clip.setAttribute('aria-label', clip.title);
        input.placeholder = attached ? 'Plano adjunto: enviá para calcarlo o sumá una aclaración…' : placeholder;
    }
    async function attach(file) {
        try {
            attached = await shrinkImage(file);
        } catch (e) {
            attached = null;
            add(o.log, h('div', { class: 'ai-msg ai-bot ai-error' }, e.message));
            o.log.scrollTop = o.log.scrollHeight;
        }
        showAttached();
        input.focus();
    }
    clip.addEventListener('click', () => {
        if (!attached) { picker.click(); return; }
        attached = null;
        showAttached();
    });
    picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        picker.value = '';
        if (file) attach(file);
    });
    input.addEventListener('paste', (e) => {
        const file = [...(e.clipboardData?.files ?? [])].find((f) => IMAGE_TYPES.includes(f.type));
        if (!file) return;
        e.preventDefault();
        attach(file);
    });
    o.form.prepend(clip);
    o.form.append(picker); // al final: el primer campo del formulario sigue siendo el de texto
    showAttached();
    /** Mensaje de la persona: el texto y, si mandó un plano, su marca. */
    const mine = (ev) => h('div', { class: 'ai-msg ai-me' }, ev.adjunto ? h('span', { class: 'ai-attached' }, '📎 Plano adjunto') : null, ev.texto);

    function setBusy(v, label = 'Pensando…') {
        busy = v;
        for (const el of [input, ...o.form.querySelectorAll('button')]) el.disabled = v;
        o.log.querySelector('.ai-typing')?.remove();
        if (v) add(o.log, h('div', { class: 'ai-msg ai-bot ai-typing', role: 'status' }, h('i'), h('i'), h('i'), h('span', {}, label)));
        o.log.scrollTop = o.log.scrollHeight;
    }

    function questionForm(ev, active) {
        const answers = {};
        const needsButton = ev.preguntas.some((q) => q.multiple);
        const single = ev.preguntas.filter((q) => !q.multiple);
        const send = h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: true, onclick: () => submit({ respuestas: answers }) }, 'Enviar');
        const ready = () => single.every((q) => answers[q.id]?.length);
        const onPick = () => {
            if (!active) return;
            if (!needsButton && ready()) submit({ respuestas: answers });
            else send.disabled = !ready();
        };
        const box = h('div', { class: 'ai-form' }, ev.preguntas.map((q) => {
            const buttons = q.opciones.map((opt) => h('button', { type: 'button', class: 'chip ai-option', 'aria-pressed': 'false', disabled: !active }, opt.texto));
            buttons.forEach((btn, k) => btn.addEventListener('click', () => {
                const id = q.opciones[k].id;
                const list = answers[q.id] ?? [];
                answers[q.id] = q.multiple ? (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]) : [id];
                buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(answers[q.id].includes(q.opciones[j].id))));
                onPick();
            }));
            return h('fieldset', { class: 'ai-q' }, h('legend', {}, q.pregunta), h('div', { class: 'ai-options', role: 'group' }, buttons));
        }), active && needsButton ? h('div', { class: 'ai-form-foot' }, send) : null);
        return h('div', { class: 'ai-msg ai-bot ai-wide-form' }, box);
    }

    function render() {
        clear(o.log);
        if (!conv) return;
        const events = conv.eventos;
        const lastHouse = events.map((e) => e.tipo).lastIndexOf('casa');
        events.forEach((ev, i) => {
            const isLast = i === events.length - 1;
            if (ev.tipo === 'usuario') add(o.log, mine(ev));
            else if (ev.tipo === 'asistente') add(o.log, h('div', { class: 'ai-msg ai-bot' }, ev.texto));
            else if (ev.tipo === 'pregunta') {
                // las ya respondidas se achican a una línea: las respuestas se ven en el mensaje de la persona
                if (isLast && conv.activa && !busy) add(o.log, questionForm(ev, true));
                else add(o.log, h('div', { class: 'ai-msg ai-bot ai-q-done' }, ev.preguntas.map((q) => q.pregunta).join(' · ')));
            }
            else if (ev.tipo === 'casa') add(o.log, h('div', { class: 'ai-msg ai-bot ai-wide' }, o.house(ev, i === lastHouse)));
            else if (ev.tipo === 'error') add(o.log, h('div', { class: 'ai-msg ai-bot ai-error' }, ev.texto));
        });
        const last = events.at(-1);
        if (conv.activa && last && last.tipo !== 'pregunta' && last.tipo !== 'usuario') {
            const sug = o.suggestions(conv);
            if (sug.length) add(o.log, h('div', { class: 'ai-suggest' }, sug.map((s) => h('button', { type: 'button', class: 'chip ai-chip', onclick: () => submit({ texto: s }) }, s))));
        }
        input.disabled = !conv.activa;
        o.log.scrollTop = o.log.scrollHeight;
    }

    async function request(promise, label) {
        setBusy(true, label);
        const before = conv?.eventos.length ?? 0;
        try {
            conv = await promise;
            o.onChange?.(conv, conv.eventos.slice(before));
        } catch (e) {
            if (conv) {
                conv.eventos.push({ tipo: 'error', texto: e.message });
                conv.activa = true;
            } else {
                add(o.log, h('div', { class: 'ai-msg ai-bot ai-error' }, e.message));
            }
        } finally {
            setBusy(false);
            render();
            input.focus();
        }
    }

    function submit(payload) {
        if (busy) return;
        if (!conv) { o.onFirstMessage?.(payload); return; }
        const q = conv.eventos.at(-1);
        const labels = payload.respuestas && q?.preguntas ? q.preguntas.map((x) => x.opciones.filter((op) => payload.respuestas[x.id]?.includes(op.id)).map((op) => op.texto).join(', ')).filter(Boolean) : [];
        conv.eventos.push({ tipo: 'usuario', texto: [...labels, payload.texto].filter(Boolean).join(' · '), adjunto: Boolean(payload.adjunto) });
        conv.activa = false;
        render();
        const slow = payload.adjunto ? 'Leyendo el plano…' : payload.texto ? 'Pensando…' : 'Armando la casa…';
        request(api(`/api/assistant/conversations/${conv.id}/messages`, { client, ...payload, ...(o.extra?.() ?? {}) }), slow);
    }

    o.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const texto = input.value.trim();
        if ((!texto && !attached) || busy) return;
        input.value = '';
        const adjunto = attached && { tipo: attached.tipo, datos: attached.datos };
        attached = null;
        showAttached();
        submit(adjunto ? { texto, adjunto } : { texto });
    });

    return {
        client,
        get conv() { return conv; },
        /** Arranca una conversación: {inicio, modo, texto?, adjunto?}. */
        start(body) {
            conv = null;
            clear(o.log);
            if (body.texto || body.adjunto) add(o.log, mine({ texto: body.texto, adjunto: Boolean(body.adjunto) }));
            return request(api('/api/assistant/conversations', { client, ...body }), body.adjunto ? 'Leyendo el plano…' : body.texto ? 'Pensando…' : 'Preparando…');
        },
        async resume(id) {
            try {
                conv = await api(`/api/assistant/conversations/${id}?client=${client}`);
                render();
                return true;
            } catch {
                conv = null;
                return false;
            }
        },
        reset() { conv = null; clear(o.log); },
        render,
        submit,
    };
}
