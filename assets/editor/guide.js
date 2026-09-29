/**
 * Guía «Próximo paso»: una tarjeta sobre el lienzo que mira el proyecto y propone la siguiente acción con un botón.
 * No bloquea nada: se puede minimizar y vuelve a abrirse con el botón «?».
 */
import { h, add, clear } from '../lib/dom.js';
import { fmt, int } from '../lib/format.js';

const KEY = 'blockk.guide.min';

export function mountGuide(app, actions) {
    const { store } = app;
    const el = document.getElementById('guide');
    let minimized = false;
    try { minimized = localStorage.getItem(KEY) === '1'; } catch { /* ok */ }

    const setMin = (v) => {
        minimized = v;
        try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ok */ }
        render();
    };

    /** Pasos del proyecto en orden; el primero sin completar es el «próximo paso». */
    function steps() {
        const p = store.project;
        const a = store.analysis;
        const l0 = p.levels[0];
        const rooms0 = a?.levels?.[0]?.rooms ?? [];
        const doors = l0.openings.filter((o) => o.kind === 'door').length;
        const windows = p.levels.flatMap((l) => l.openings).filter((o) => o.kind === 'window').length;
        const list = [
            {
                done: rooms0.length > 0,
                title: 'Dibujá una habitación',
                text: l0.walls.length
                    ? 'Los muros todavía no cierran un ambiente: uní las esquinas (el imán azul ayuda) o usá la herramienta Habitación.'
                    : 'Elegí «Habitación» y arrastrá en diagonal sobre el terreno. Para la siguiente, empezá desde una pared: se comparten.',
                act: [['Habitación', () => actions.go(0, 'room')], ['Usar una plantilla', () => { window.location.href = '/galeria'; }]],
            },
            {
                done: doors > 0,
                title: 'Agregá la puerta de entrada',
                text: 'Elegí «Puerta» y apuntá a un muro: el verde indica dónde entra.',
                act: [['Puerta', () => actions.go(0, 'door')]],
            },
            {
                done: windows > 0,
                title: 'Agregá ventanas',
                text: 'Elegí «Ventana» y apuntá a un muro, o pedí sugerencias según el sol.',
                act: [['Ventana', () => actions.go(store.ui.level === 1 ? 1 : 0, 'window')], ['Sugerir por el sol', () => actions.suggest()]],
            },
        ];
        if (p.upper) {
            const rooms1 = a?.levels?.[1]?.rooms ?? [];
            const floors = (p.levels[1].slabs?.length ?? 0) + l0.timber.filter((t) => t.kind === 'joists').length;
            list.push(
                { done: rooms1.length > 0, title: 'Dibujá el Nivel 2', text: 'En la pestaña «Nivel 2» dibujá las habitaciones: el imán se pega a los muros de abajo.', act: [['Ir al Nivel 2', () => actions.go(1, 'room')]] },
                { done: floors > 0, title: 'Poné el piso del Nivel 2', text: 'Herramienta «Piso»: clic dentro de cada habitación de abajo (losa o madera).', act: [['Piso', () => actions.go(1, 'piso')]] },
                { done: (l0.stairs?.length ?? 0) > 0, title: 'Agregá la escalera', text: 'En el Nivel 1, «Escalera»: clic dentro de una habitación. Puede ser recta, en L o en U.', act: [['Escalera', () => actions.go(0, 'stair')]] },
            );
        }
        list.push({
            done: (p.roofs?.length ?? 0) > 0,
            title: 'Poné el techo',
            text: 'En la pestaña «Techo», clic dentro de cada habitación (o arrastrá un rectángulo). Elegí a un agua o a dos aguas.',
            act: [['Ir al techo', () => actions.go(2, 'roof')]],
        });

        return list;
    }

    function render() {
        clear(el);
        el.classList.toggle('open', !minimized);
        const a = store.analysis;
        if (!a) return;
        const list = steps();
        const next = list.find((s) => !s.done);
        const errors = (a.issues ?? []).filter((i) => i.severity === 'error').length;
        const done = list.filter((s) => s.done).length;

        if (minimized) {
            add(el, h('button', { type: 'button', class: 'guide-pill', title: 'Mostrar la guía', onclick: () => setMin(false) },
                next ? `? Próximo paso: ${next.title}` : '✓ Proyecto completo'));
            return;
        }
        const dots = h('div', { class: 'guide-dots', 'aria-label': `${done} de ${list.length} pasos` }, list.map((s) => h('i', { class: s.done ? 'on' : '', title: s.title })));
        const head = h('div', { class: 'guide-head' }, dots, h('button', { type: 'button', class: 'guide-x', 'aria-label': 'Minimizar la guía', title: 'Minimizar', onclick: () => setMin(true) }, '–'));

        if (next) {
            add(el, head,
                h('div', { class: 'guide-title' }, `Paso ${list.indexOf(next) + 1} · ${next.title}`),
                h('p', {}, next.text),
                h('div', { class: 'guide-actions' }, next.act.map(([label, fn], i) => h('button', { type: 'button', class: `btn btn-sm ${i ? 'btn-outline' : 'btn-primary'}`, onclick: fn }, label))),
                errors ? h('button', { type: 'button', class: 'guide-warn', onclick: () => actions.issues() }, `⚠ ${errors} problema${errors > 1 ? 's' : ''} para revisar`) : null);
            return;
        }
        const t = a.telemetry.total;
        add(el, head,
            h('div', { class: 'guide-title' }, '¡Tu casa está lista para computar!'),
            h('p', {}, `${fmt(t.netM2, 1)} m² útiles · ${int(t.blocks)} bloques · ${int(t.pallets)} pallets.`),
            h('div', { class: 'guide-actions' },
                h('a', { class: 'btn btn-sm btn-primary', href: '/computo' }, 'Ver cómputo'),
                store.project.upper ? null : h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => actions.addLevel() }, '+ Agregar nivel')),
            errors ? h('button', { type: 'button', class: 'guide-warn', onclick: () => actions.issues() }, `⚠ ${errors} problema${errors > 1 ? 's' : ''} para revisar`) : null);
    }

    return { render };
}
