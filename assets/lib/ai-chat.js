/**
 * Chat de diseño con IA, compartido por la Galería (asistente paso a paso) y el editor (diálogo del botón flotante).
 * La conversación vive en el servidor; este módulo sólo la dibuja y manda los mensajes.
 *
 * Preguntas: vienen en formularios (una o varias, una debajo de la otra). Las de opción única se contestan con un
 * clic; si el formulario tiene alguna de opción múltiple, se confirma con «Enviar».
 */
import { h, add, clear } from './dom.js';
import { fmt, int } from './format.js';

const CLIENT_KEY = 'blockk.client';

export function clientId() {
    try {
        let id = localStorage.getItem(CLIENT_KEY);
        if (!id || !/^[a-f0-9]{24}$/.test(id)) {
            const bytes = window.crypto.getRandomValues(new Uint8Array(12));
            id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(CLIENT_KEY, id);
        }
        return id;
    } catch {
        return 'f'.repeat(24);
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
    const input = o.form.querySelector('input');
    let conv = null;
    let busy = false;

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
            if (ev.tipo === 'usuario') add(o.log, h('div', { class: 'ai-msg ai-me' }, ev.texto));
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
        conv.eventos.push({ tipo: 'usuario', texto: [...labels, payload.texto].filter(Boolean).join(' · ') });
        conv.activa = false;
        render();
        const slow = payload.texto ? 'Pensando…' : 'Armando la casa…';
        request(api(`/api/assistant/conversations/${conv.id}/messages`, { client, ...payload, ...(o.extra?.() ?? {}) }), slow);
    }

    o.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const texto = input.value.trim();
        if (!texto || busy) return;
        input.value = '';
        submit({ texto });
    });

    return {
        client,
        get conv() { return conv; },
        /** Arranca una conversación: {inicio, modo, texto?}. */
        start(body) {
            conv = null;
            clear(o.log);
            if (body.texto) add(o.log, h('div', { class: 'ai-msg ai-me' }, body.texto));
            return request(api('/api/assistant/conversations', { client, ...body }), body.texto ? 'Pensando…' : 'Preparando…');
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
