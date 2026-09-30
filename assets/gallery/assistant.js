/**
 * Asistente de la Galería: un diálogo por pasos (1 Tu casa · 2 Propuesta · 3 Ajustes). Arranca con un formulario fijo
 * (la primera casa sale sin esperar al modelo) o desde una plantilla («✦ Modificar con IA»). La conversación y los
 * diseños viven en el servidor; «Tus diseños» permite abrirlos o seguir conversando.
 */
import { $, h, add, clear } from '../lib/dom.js';
import { fmt } from '../lib/format.js';
import { saveProject } from '../lib/storage.js';
import { api, createChat, thumb, kpis, reviewLine } from '../lib/ai-chat.js';

export const LINK_KEY = 'blockk.ai.link';

export function mountAssistant({ card, dialog, confirmReplace }) {
    const list = $('#ai-design-list', card);
    const openBtn = $('#ai-open', dialog);
    const steps = [...dialog.querySelectorAll('#ai-steps li')];

    const chat = createChat({
        log: $('#ai-log', dialog),
        form: $('#ai-form', dialog),
        mode: 'galeria',
        house: (ev) => h('div', { class: 'ai-house' },
            thumb(ev.svg, `Planta de ${ev.nombre}`),
            h('div', { class: 'ai-house-body' },
                h('strong', {}, ev.nombre),
                kpis(ev.resumen),
                h('p', { class: 'ai-rooms muted small' }, ev.resumen.ambientes.map((a) => `${a.nombre.replace(' (probable)', '')}${ev.resumen.niveles > 1 ? ` (P${a.nivel})` : ''}`).join(' · ')),
                reviewLine(ev.resumen))),
        suggestions: (conv) => {
            const house = conv.eventos.findLast((e) => e.tipo === 'casa')?.resumen;
            if (!house) return [];
            return [
                'Sumá un dormitorio',
                house.niveles === 1 ? 'Pasala a 2 plantas' : 'Hacela de 1 planta',
                'Más luz en el estar',
                'Cambiá el techo',
            ];
        },
        onChange: () => { refresh(); loadDesigns(); },
    });

    function refresh() {
        const ev = chat.conv?.eventos ?? [];
        const houseAt = ev.map((e) => e.tipo).lastIndexOf('casa');
        const firstHouse = ev.findIndex((e) => e.tipo === 'casa');
        const step = houseAt < 0 ? 1 : ev.slice(firstHouse + 1).some((e) => e.tipo === 'usuario') ? 3 : 2;
        steps.forEach((li, i) => {
            li.classList.toggle('done', i + 1 < step);
            li.toggleAttribute('aria-current', i + 1 === step);
        });
        openBtn.hidden = houseAt < 0;
    }

    function open() {
        if (!dialog.open) dialog.showModal();
        refresh();
    }

    async function openInEditor(id) {
        const d = await api(`/api/assistant/designs/${id}?client=${chat.client}`);
        saveProject(d.project);
        try { localStorage.setItem(LINK_KEY, JSON.stringify({ name: d.project.name, programa: d.programa })); } catch { /* ok */ }
        location.href = '/';
    }

    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    openBtn.addEventListener('click', () => openInEditor(chat.conv.id).catch((e) => alert(e.message)));

    $('#ai-new', card).addEventListener('click', async () => {
        if (!(await confirmReplace())) return;
        open();
        await chat.start({ modo: 'galeria', inicio: { tipo: 'nueva' } });
        refresh();
    });
    for (const b of document.querySelectorAll('[data-ai-modify]')) {
        b.addEventListener('click', async () => {
            if (!(await confirmReplace())) return;
            open();
            await chat.start({ modo: 'galeria', inicio: { tipo: 'plantilla', slug: b.dataset.aiModify } });
            refresh();
        });
    }

    async function loadDesigns() {
        try {
            const { designs } = await api(`/api/assistant/designs?client=${chat.client}`);
            clear(list);
            $('#ai-designs', card).hidden = designs.length === 0;
            for (const d of designs) {
                add(list, h('article', { class: 'ai-design card' },
                    thumb(d.svg, `Planta de ${d.nombre}`),
                    h('div', { class: 'ai-design-body' },
                        h('strong', {}, d.nombre),
                        h('span', { class: 'muted small' }, `${fmt(d.resumen.superficieUtilM2, 1)} m² · ${d.resumen.niveles} planta${d.resumen.niveles > 1 ? 's' : ''} · ${new Date(d.updated * 1000).toLocaleDateString('es-AR')}`),
                        h('div', { class: 'ai-design-actions' },
                            h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => { if (await confirmReplace()) openInEditor(d.id).catch((e) => alert(e.message)); } }, 'Abrir en el editor'),
                            h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: async () => { open(); if (await chat.resume(d.id)) refresh(); } }, 'Seguir')))));
            }
        } catch {
            $('#ai-designs', card).hidden = true;
        }
    }
    loadDesigns();
}
