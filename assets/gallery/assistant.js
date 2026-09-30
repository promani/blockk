/**
 * Chat de diseño con IA en la Galería. La conversación vive en el servidor (Redis); el navegador guarda sólo su id de
 * cliente (aleatorio, sin login) y la conversación abierta, para retomarla al volver.
 */
import { $, h, add, clear } from '../lib/dom.js';
import { fmt, int } from '../lib/format.js';
import { loadProject, saveProject } from '../lib/storage.js';

const CLIENT_KEY = 'blockk.client';
const CONV_KEY = 'blockk.ai.conv';

function clientId() {
    try {
        let id = localStorage.getItem(CLIENT_KEY);
        if (!id || !/^[a-f0-9]{24}$/.test(id)) {
            const bytes = window.crypto.getRandomValues(new Uint8Array(12));
            id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(CLIENT_KEY, id);
        }
        return id;
    } catch {
        return 'f'.repeat(24); // sin almacenamiento local: un id fijo (no se pueden retomar conversaciones)
    }
}

const store = {
    get: () => { try { return localStorage.getItem(CONV_KEY); } catch { return null; } },
    set: (v) => { try { if (v) localStorage.setItem(CONV_KEY, v); else localStorage.removeItem(CONV_KEY); } catch { /* ok */ } },
};

async function api(url, body) {
    const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) } : { headers: { Accept: 'application/json' } });
    let data = null;
    try { data = await res.json(); } catch { /* vacío */ }
    if (!res.ok) {
        const err = new Error(data?.error === 'invalid_project' ? 'El proyecto actual no es válido para el asistente.' : (data?.error ?? `Error ${res.status}`));
        err.status = res.status;
        throw err;
    }
    return data;
}

/** Miniatura SVG del servidor como imagen (sin insertar HTML). */
const thumb = (svg, alt) => h('img', { class: 'ai-thumb', alt, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });

export function mountAssistant(root) {
    const client = clientId();
    const el = { start: $('#ai-start', root), chat: $('#ai-chat', root), log: $('#ai-log', root), form: $('#ai-form', root), text: $('#ai-text', root), reset: $('#ai-reset', root), designs: $('#ai-designs', root), list: $('#ai-design-list', root), project: $('#ai-project', root), template: $('#ai-template', root) };
    let conv = null;
    let busy = false;
    const current = loadProject();
    const hasProject = !!current?.levels?.some((l) => l.walls?.length);
    el.project.hidden = !hasProject;

    function setBusy(v) {
        busy = v;
        root.classList.toggle('ai-busy', v);
        for (const b of root.querySelectorAll('button, input, select')) if (!b.closest('.ai-designs')) b.disabled = v;
        $('.ai-typing', el.log)?.remove();
        if (v) add(el.log, h('div', { class: 'ai-msg ai-bot ai-typing', 'aria-label': 'El asistente está escribiendo' }, h('span'), h('span'), h('span')));
        el.log.scrollTop = el.log.scrollHeight;
    }

    function showChat(on) {
        el.chat.hidden = !on;
        el.start.hidden = on;
        el.reset.hidden = !on;
    }

    async function openDesign(id) {
        const d = await api(`/api/assistant/designs/${id}?client=${client}`);
        saveProject(d.project);
        location.href = '/';
    }

    function houseCard(ev, last) {
        const r = ev.resumen;
        const errors = r.observaciones.filter((o) => o.severidad === 'error').length;
        const warns = r.observaciones.length - errors;
        return h('div', { class: 'ai-house' },
            thumb(ev.svg, `Planta de ${ev.nombre}`),
            h('div', { class: 'ai-house-body' },
                h('strong', {}, ev.nombre),
                h('div', { class: 'ai-kpis' },
                    h('span', {}, `${fmt(r.superficieUtilM2, 1)} m² útiles`),
                    h('span', {}, `${r.niveles} planta${r.niveles > 1 ? 's' : ''}`),
                    h('span', {}, `${int(r.bloques)} bloques`),
                    h('span', {}, `${int(r.pallets)} pallets`),
                    h('span', {}, `${r.moneda} ${int(r.costoReferencia)} ref.`)),
                h('p', { class: 'ai-rooms muted small' }, r.ambientes.map((a) => `${a.nombre}${r.niveles > 1 ? ` (N${a.nivel})` : ''} ${fmt(a.m2, 1)} m²`).join(' · ')),
                errors || warns ? h('p', { class: `small ${errors ? 'ai-err' : 'ai-warn'}` }, `${errors ? `${errors} error(es)` : ''}${errors && warns ? ' y ' : ''}${warns ? `${warns} advertencia(s)` : ''} en la Revisión`) : h('p', { class: 'small ai-ok' }, '✓ Sin observaciones en la Revisión'),
                last ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openDesign(ev.diseno).catch((e) => alert(e.message)) }, 'Abrir en el editor') : null));
    }

    function question(ev, active) {
        const chosen = new Set();
        const confirm = ev.multiple ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: true, onclick: () => send({ opciones: [...chosen] }) }, 'Confirmar') : null;
        const opts = h('div', { class: 'ai-options', role: ev.multiple ? 'group' : 'radiogroup', 'aria-label': ev.pregunta }, ev.opciones.map((o) => {
            const btn = h('button', { type: 'button', class: 'chip ai-option', 'aria-pressed': 'false', disabled: !active, title: o.detalle || null }, o.texto, o.detalle ? h('small', {}, o.detalle) : null);
            btn.addEventListener('click', () => {
                if (!ev.multiple) {
                    send({ opciones: [o.id] });
                    return;
                }
                if (chosen.has(o.id)) chosen.delete(o.id); else chosen.add(o.id);
                btn.setAttribute('aria-pressed', String(chosen.has(o.id)));
                confirm.disabled = chosen.size === 0;
            });
            return btn;
        }), active ? confirm : null);
        return h('div', { class: 'ai-msg ai-bot' }, h('p', {}, ev.pregunta), opts, active && ev.multiple ? h('p', { class: 'muted small' }, 'Podés elegir varias.') : null);
    }

    function render() {
        clear(el.log);
        if (!conv) return;
        const events = conv.eventos;
        const lastHouse = events.map((e) => e.tipo).lastIndexOf('casa');
        events.forEach((ev, i) => {
            const isLast = i === events.length - 1;
            if (ev.tipo === 'usuario') add(el.log, h('div', { class: 'ai-msg ai-me' }, ev.texto));
            else if (ev.tipo === 'asistente') add(el.log, h('div', { class: 'ai-msg ai-bot' }, ev.texto));
            else if (ev.tipo === 'pregunta') add(el.log, question(ev, isLast && conv.activa));
            else if (ev.tipo === 'casa') add(el.log, h('div', { class: 'ai-msg ai-bot ai-wide' }, houseCard(ev, i === lastHouse)));
            else if (ev.tipo === 'error') add(el.log, h('div', { class: 'ai-msg ai-bot ai-error' }, ev.texto));
        });
        el.text.disabled = !conv.activa;
        el.log.scrollTop = el.log.scrollHeight;
    }

    async function run(promise) {
        setBusy(true);
        try {
            conv = await promise;
            store.set(conv.id);
            showChat(true);
        } catch (e) {
            if (conv) {
                conv.eventos.push({ tipo: 'error', texto: e.message });
                conv.activa = true; // se puede volver a intentar
            } else {
                showChat(false);
                alert(e.message);
            }
        } finally {
            setBusy(false);
            render();
            if (conv && !el.chat.hidden) el.text.focus();
            loadDesigns();
        }
    }

    function send(payload) {
        if (busy || !conv) return;
        // se muestra ya lo que se mandó, antes de la respuesta
        const labels = payload.opciones ? conv.eventos.at(-1)?.opciones?.filter((o) => payload.opciones.includes(o.id)).map((o) => o.texto) : [];
        conv.eventos.push({ tipo: 'usuario', texto: [labels?.join(', '), payload.texto].filter(Boolean).join('. ') });
        conv.activa = false;
        render();
        run(api(`/api/assistant/conversations/${conv.id}/messages`, { client, ...payload }));
    }

    function start(inicio) {
        showChat(true);
        clear(el.log);
        run(api('/api/assistant/conversations', { client, inicio }));
    }

    for (const b of root.querySelectorAll('[data-ai-start]')) {
        b.addEventListener('click', () => {
            const tipo = b.dataset.aiStart;
            if (tipo === 'plantilla') start({ tipo, slug: el.template.value });
            else if (tipo === 'proyecto') start({ tipo, project: loadProject() });
            else start({ tipo: 'nueva' });
        });
    }
    el.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const texto = el.text.value.trim();
        if (!texto) return;
        el.text.value = '';
        send({ texto });
    });
    el.reset.addEventListener('click', () => {
        conv = null;
        store.set(null);
        clear(el.log);
        showChat(false);
    });

    async function loadDesigns() {
        try {
            const { designs } = await api(`/api/assistant/designs?client=${client}`);
            clear(el.list);
            el.designs.hidden = designs.length === 0;
            for (const d of designs) {
                add(el.list, h('article', { class: 'ai-design card' },
                    thumb(d.svg, `Planta de ${d.nombre}`),
                    h('div', { class: 'ai-design-body' },
                        h('strong', {}, d.nombre),
                        h('span', { class: 'muted small' }, `${fmt(d.resumen.superficieUtilM2, 1)} m² · ${d.resumen.niveles} planta${d.resumen.niveles > 1 ? 's' : ''} · ${new Date(d.updated * 1000).toLocaleDateString('es-AR')}`),
                        h('div', { class: 'ai-design-actions' },
                            h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openDesign(d.id).catch((e) => alert(e.message)) }, 'Abrir en el editor'),
                            h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => resume(d.id) }, 'Seguir conversando')))));
            }
        } catch {
            el.designs.hidden = true;
        }
    }

    async function resume(id) {
        setBusy(true);
        try {
            conv = await api(`/api/assistant/conversations/${id}?client=${client}`);
            store.set(conv.id);
            showChat(true);
            root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch {
            store.set(null);
            conv = null;
            showChat(false);
        } finally {
            setBusy(false);
            render();
        }
    }

    // Arranque: desde el editor («Modificar con IA») se abre directo con el proyecto actual; si no, se retoma la última.
    const params = new URLSearchParams(location.search);
    if (params.get('ia') === 'proyecto' && hasProject) {
        window.history.replaceState(null, '', location.pathname + '#ai');
        start({ tipo: 'proyecto', project: current });
        root.scrollIntoView({ block: 'start' });
    } else if (store.get()) {
        resume(store.get());
    }
    loadDesigns();
}
