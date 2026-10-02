/**
 * Asistente en el editor: botón flotante (✦ IA) y un diálogo para pedir cambios sobre la casa abierta. El modelo actúa
 * directo si el pedido es claro; cada casa que devuelve se aplica al editor como un paso que se puede deshacer.
 * Con cada mensaje viaja el proyecto actual, así la IA ve también lo que se cambió a mano.
 */
import { $, h, add } from '../lib/dom.js';
import { api, createChat, kpis, reviewLine } from '../lib/ai-chat.js';

const LABEL = 'Cambio del asistente';
const LINK_KEY = 'blockk.ai.link';
const IDEAS = ['Sumá un dormitorio', 'Más luz en el estar', 'Pasá el techo a un agua', 'Hacela de 2 plantas'];

export function mountAssistant(app) {
    const fab = $('#ai-fab');
    const dialog = $('#ai-dialog');
    if (!fab || !dialog) return;
    const { store } = app;
    const applied = new Map(); // versión de casa → aplicada

    /** Programa de la casa si vino del asistente de la Galería (permite rearmarla sin perder su lógica). */
    function linkedProgram() {
        try {
            const link = JSON.parse(localStorage.getItem(LINK_KEY) ?? 'null');
            return link && link.name === store.project.name ? link.programa : null;
        } catch {
            return null;
        }
    }

    const chat = createChat({
        log: $('#ai-log', dialog),
        form: $('#ai-form', dialog),
        mode: 'editor',
        extra: () => ({ project: store.project }),
        house: (ev, isLast) => {
            // false: la casa de partida · true: aplicada · 'undone': deshecha · 'failed': no se pudo · sin estado: aplicándose
            const state = applied.get(ev.version);
            const title = { false: `Tu casa: ${ev.nombre}`, true: `✓ Aplicado: ${ev.nombre}`, undone: `↶ Deshecho: ${ev.nombre}`, failed: `No se aplicó: ${ev.nombre}` }[state] ?? `Aplicando: ${ev.nombre}…`;
            return h('div', { class: 'ai-house ai-house-compact' },
                h('div', { class: 'ai-house-body' },
                    h('strong', {}, title),
                    kpis(ev.resumen),
                    reviewLine(ev.resumen),
                    isLast && state === true ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => undo(ev.version) }, '↶ Deshacer este cambio') : null));
        },
        suggestions: () => [],
        onChange: async (conv, fresh) => {
            // la primera casa de la conversación es la del editor: se marca como ya presente
            const first = conv.eventos.find((e) => e.tipo === 'casa');
            if (first && !applied.size) applied.set(first.version, false);
            const last = fresh.findLast((e) => e.tipo === 'casa');
            if (!last || applied.has(last.version)) return;
            applied.set(last.version, undefined); // aplicándose: no se vuelve a aplicar si llega otra actualización
            try {
                const d = await api(`/api/assistant/designs/${last.diseno}?client=${chat.client}`);
                await store.commit(LABEL, (draft) => {
                    for (const k of Object.keys(draft)) delete draft[k];
                    Object.assign(draft, structuredClone(d.project));
                });
                applied.set(last.version, true);
            } catch (e) {
                applied.set(last.version, 'failed');
                app.toast(`No se pudo aplicar la casa (${e.message}).`, 'error');
            }
            chat.render();
        },
        onFirstMessage: (payload) => chat.start({ modo: 'editor', inicio: { tipo: 'proyecto', project: store.project, programa: linkedProgram() }, texto: payload.texto ?? '', ...(payload.adjunto ? { adjunto: payload.adjunto } : {}) }),
    });

    async function undo(version) {
        if (store.history.at(-1)?.label !== LABEL) return;
        await store.undo();
        applied.set(version, 'undone');
        chat.render();
    }

    function intro() {
        const log = $('#ai-log', dialog);
        if (chat.conv || log.childElementCount) return;
        add(log, h('div', { class: 'ai-msg ai-bot' }, 'Pedime cambios en esta casa y los aplico acá mismo (se pueden deshacer). Con el clip podés adjuntar la imagen de un plano y lo calco.'),
            h('div', { class: 'ai-suggest' }, IDEAS.map((s) => h('button', { type: 'button', class: 'chip ai-chip', onclick: () => chat.submit({ texto: s }) }, s))));
    }

    fab.addEventListener('click', () => {
        dialog.showModal();
        intro();
        $('#ai-form input', dialog).focus();
    });
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    // clic en el fondo (fuera del panel) cierra
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}
