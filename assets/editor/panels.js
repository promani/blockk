import { h, add, clear, $ } from '../lib/dom.js';
import { fmt, int, m2, pct, money, cm } from '../lib/format.js';
import { suggest } from '../lib/api.js';
import { nextId } from '../lib/storage.js';
import { roomColor } from './renderer.js';

const G = 12.5;
const COMPASS = [['NO', 315], ['N', 0], ['NE', 45], ['O', 270], null, ['E', 90], ['SO', 225], ['S', 180], ['SE', 135]];
const CITIES = [['Buenos Aires', -34.6], ['Córdoba', -31.4], ['Rosario', -32.9], ['Mendoza', -32.9], ['Mar del Plata', -38.0], ['Neuquén', -38.9], ['Tucumán', -26.8], ['Salta', -24.8], ['Bariloche', -41.1], ['Ushuaia', -54.8], ['Madrid', 40.4], ['Ciudad de México', 19.4]];
const SEASONS = [['winter', 'Invierno'], ['summer', 'Verano'], ['equinox', 'Equinoccio']];

const wallLen = (w) => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);

export function mountPanels(app) {
    const { store } = app;
    const cfg = store.config;
    const el = { tele: $('#telemetry'), props: $('#props'), solar: $('#solar'), issues: $('#issues'), badge: $('#issues-badge') };

    // ------------------------------------------------------------------ telemetría
    function renderTelemetry() {
        const a = store.analysis;
        clear(el.tele);
        if (!a) {
            add(el.tele, h('p', { class: 'empty-note' }, 'Calculando…'));
            return;
        }
        const t = a.telemetry;
        const lv = t.levels[Math.min(store.ui.level, 1)];
        const tot = t.total;
        const roofBom = a.roof?.bom;
        const nRoofs = a.roof?.parts?.length ?? 0;
        const roofBlock = store.ui.level === 2
            ? h('div', {},
                h('div', { class: 'kv-title' }, 'Techos'),
                nRoofs && roofBom
                    ? h('dl', { class: 'dl' },
                        h('dt', {}, 'Techos'), h('dd', {}, int(nRoofs)),
                        h('dt', {}, 'Superficie de cubierta'), h('dd', {}, m2(roofBom.coverM2)),
                        h('dt', {}, 'Cabios'), h('dd', {}, int(roofBom.raftersCount)),
                        h('dt', {}, 'Cumbrera / correas'), h('dd', {}, `${fmt(roofBom.ridgeMl, 1)} m / ${fmt(roofBom.battenMl, 0)} m`),
                        h('dt', {}, 'Hastiales de bloque'), h('dd', { title: 'Se computan por superficie (+10 %); están en el cómputo, no en el despiece de cortes.' }, m2(roofBom.gableMasonryM2)))
                    : h('p', { class: 'empty-note' }, 'Todavía no hay techos. Arrastrá un rectángulo sobre los muros (herramienta Techo).'))
            : null;
        const full = tot.heightM >= tot.maxHeightM;
        add(el.tele, 
            roofBlock,
            h('div', { class: 'kv-title' }, cfg.levelNames[Math.min(store.ui.level, 1)]),
            h('dl', { class: 'dl' },
                h('dt', {}, 'Superficie útil'), h('dd', {}, m2(lv.netM2)),
                h('dt', {}, 'Superficie a ejes'), h('dd', {}, m2(lv.grossM2)),
                h('dt', {}, 'Muros (longitud)'), h('dd', {}, `${fmt(lv.wallLengthM, 2)} m`),
                h('dt', {}, 'Ambientes cerrados'), h('dd', {}, int(lv.rooms)),
                h('dt', {}, 'Hiladas'), h('dd', { title: '11 hiladas de bloque + 1 hilada de bloque U (corona)' }, `${lv.courses.regular} + 1 U = ${lv.courses.total}/${lv.courses.total}`),
                h('dt', {}, 'Bloques HCCA del nivel'), h('dd', {}, int(lv.blocks))),
            t.slabM2 > 0 || t.stairs > 0 ? h('dl', { class: 'dl' }, t.slabM2 > 0 ? [h('dt', {}, 'Losa de piso'), h('dd', {}, m2(t.slabM2))] : null, t.stairs > 0 ? [h('dt', {}, 'Escaleras'), h('dd', {}, int(t.stairs))] : null) : null,
            h('div', { class: 'kv-title' }, 'Obra completa'),
            h('div', { class: `meter${full ? ' full' : ''}`, title: 'Altura autoportante' }, h('i', { style: `width:${Math.min(100, (tot.heightM / tot.maxHeightM) * 100)}%` })),
            h('dl', { class: 'dl' },
                h('dt', {}, 'Altura autoportante'), h('dd', {}, `${fmt(tot.heightM, 2)} / ${fmt(tot.maxHeightM, 2)} m`),
                h('dt', {}, 'Superficie útil total'), h('dd', {}, m2(tot.netM2)),
                h('dt', {}, 'Bloques a comprar'), h('dd', {}, int(tot.blocks)),
                h('dt', {}, 'Pallets'), h('dd', {}, int(tot.pallets)),
                h('dt', {}, 'Mortero adhesivo'), h('dd', {}, `${int(tot.adhesiveBags)} bolsas`),
                h('dt', {}, 'Descarte de material'), h('dd', { title: 'Objetivo del sistema: < 4 %' }, pct(tot.scrapPct)),
                h('dt', {}, 'Bloques con corte'), h('dd', {}, pct(tot.cutBlocksPct)),
                h('dt', {}, 'Costo de referencia'), h('dd', {}, money(tot.cost, tot.currency))),
            h('p', { class: 'small muted' }, 'Los precios son de ejemplo y se editan en Cómputo.'),
        );
    }

    // ------------------------------------------------------------------ propiedades
    const field = (labelText, control) => h('div', { class: 'proprow' }, h('label', {}, labelText, control));
    const num = (value, min, max, onChange, step = 1) => h('input', { type: 'number', value, min, max, step, onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); } });
    const sel = (value, items, onChange) => h('select', { onchange: (e) => onChange(e.target.value) }, items.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text)));
    const modify = (label, fn) => store.commit(label, (d) => fn(d.levels[store.ui.level], d));

    function deleteSelection() {
        const sel_ = store.ui.selection;
        if (!sel_) return;
        const level = store.ui.level;
        store.setUi({ selection: null });
        store.commit('Eliminar', (d) => {
            const lv = d.levels[level];
            if (sel_.type === 'wall') {
                lv.walls = lv.walls.filter((w) => w.id !== sel_.id);
                lv.openings = lv.openings.filter((o) => o.wall !== sel_.id);
                lv.ubeams = lv.ubeams.filter((u) => u.wall !== sel_.id);
            } else if (sel_.type === 'opening') lv.openings = lv.openings.filter((o) => o.id !== sel_.id);
            else if (sel_.type === 'ubeam') lv.ubeams = lv.ubeams.filter((u) => u.id !== sel_.id);
            else if (sel_.type === 'timber') d.levels[0].timber = d.levels[0].timber.filter((t) => t.id !== sel_.id);
            else if (sel_.type === 'roof') d.roofs = d.roofs.filter((r) => r.id !== sel_.id);
            else if (sel_.type === 'gable') {
                const [rid, side] = String(sel_.id).split(':');
                const r = d.roofs.find((x) => x.id === rid);
                if (r && side === 'A') r.gableA = false;
                else if (r && side === 'B') r.gableB = false;
            } else if (sel_.type === 'slab') d.levels[1].slabs = d.levels[1].slabs.filter((x) => x.id !== sel_.id);
            else if (sel_.type === 'stair') d.levels[0].stairs = d.levels[0].stairs.filter((x) => x.id !== sel_.id);
        });
    }
    app.deleteSelection = deleteSelection;

    /** Botones para correr un muro 62,5 cm / 12,5 cm hacia cada lado (perpendicular a su eje). */
    function moveButtons(w) {
        const horizontal = w.y1 === w.y2;
        const neg = horizontal ? '▲' : '◀';
        const pos = horizontal ? '▼' : '▶';
        const negName = horizontal ? 'norte' : 'oeste';
        const posName = horizontal ? 'sur' : 'este';
        return [[-5, `${neg} 62,5`, negName], [-1, `${neg} 12,5`, negName], [1, `${pos} 12,5`, posName], [5, `${pos} 62,5`, posName]].map(([d, text, name]) =>
            h('button', { class: 'btn btn-outline btn-sm', type: 'button', title: `Mover ${fmt(Math.abs(d) * G, 1)} cm hacia el ${name}`, onclick: () => app.moveWallBy(w.id, d) }, text));
    }

    function renderProps() {
        clear(el.props);
        if (store.ui.level === 2) {
            renderRoofProps();
            return;
        }
        const s = store.ui.selection;
        const lv = store.level();
        const delBtn = h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: deleteSelection }, 'Eliminar (Supr)');

        if (s?.type === 'wall') {
            const w = lv.walls.find((x) => x.id === s.id);
            if (!w) return void (store.ui.selection = null);
            const len = wallLen(w) * G;
            const bearing = w.t >= cfg.loadBearingMin;
            const ops = lv.openings.filter((o) => o.wall === w.id);
            const beams = lv.ubeams.filter((u) => u.wall === w.id);
            add(el.props, 
                h('div', { class: 'kv-title' }, bearing ? 'Muro portante' : 'Tabique no portante'),
                h('dl', { class: 'dl' }, h('dt', {}, 'Longitud'), h('dd', {}, `${fmt(len / 100)} m`), h('dt', {}, 'Bloques a lo largo'), h('dd', {}, fmt(len / 62.5, 2)), h('dt', {}, 'Eje'), h('dd', {}, w.y1 === w.y2 ? 'horizontal' : 'vertical')),
                field('Espesor', sel(w.t, cfg.thicknesses.map((t) => [t, `${cm(t)} cm`]), (v) => modify('Cambiar espesor', (l) => { l.walls.find((x) => x.id === w.id).t = Number(v); }))),
                h('div', { class: 'kv-title' }, 'Agrandar / achicar la habitación'),
                h('p', { class: 'small muted' }, 'También podés arrastrar la manija azul del muro. Los muros que llegan a él se estiran solos.'),
                h('div', { class: 'nudge', role: 'group', 'aria-label': 'Mover el muro' }, moveButtons(w)),
                ops.length ? h('div', {}, h('div', { class: 'kv-title' }, 'Vanos'), ops.map((o) => h('button', { class: 'btn btn-outline btn-sm', type: 'button', style: 'margin:2px', onclick: () => store.setUi({ selection: { type: 'opening', id: o.id, wall: w.id } }) }, cfg.presets[o.preset]?.label ?? `${o.kind === 'door' ? 'Puerta' : 'Ventana'} ${cm(o.w * G)} cm`))) : null,
                beams.length ? h('div', {}, h('div', { class: 'kv-title' }, 'Vigas U'), beams.map((u) => h('button', { class: 'btn btn-outline btn-sm', type: 'button', style: 'margin:2px', onclick: () => store.setUi({ selection: { type: 'ubeam', id: u.id, wall: w.id } }) }, `Hilada ${u.course + 1} · ${cm(u.len * G)} cm`))) : null,
                h('div', { class: 'actions-row' }, delBtn),
            );
            return;
        }

        if (s?.type === 'opening') {
            const o = lv.openings.find((x) => x.id === s.id);
            if (!o) return void (store.ui.selection = null);
            const wall = lv.walls.find((w) => w.id === o.wall);
            const upd = (fn) => modify('Editar vano', (l) => fn(l.openings.find((x) => x.id === o.id)));
            const wallU = wall ? wallLen(wall) : 40;
            add(el.props, 
                h('div', { class: 'kv-title' }, o.kind === 'door' ? 'Puerta' : 'Ventana'),
                field('Tipo', sel(o.preset, Object.entries(cfg.presets).map(([k, p]) => [k, p.label]), (v) => { const p = cfg.presets[v]; upd((x) => Object.assign(x, { preset: v, w: p.w, sill: p.sill, h: p.h, kind: p.kind })); })),
                field('Ancho (× 12,5 cm)', num(o.w, 2, 40, (v) => upd((x) => { x.w = v; x.preset = ''; }))),
                o.kind === 'window' ? field('Antepecho (hiladas)', sel(o.sill, [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [n, `${n} (${fmt((n * 25) / 100)} m)`]), (v) => upd((x) => { x.sill = Number(v); x.h = cfg.openingTopCourse - Number(v); x.preset = ''; }))) : null,
                field('Posición (× 12,5 cm)', num(o.pos, 0, Math.max(0, wallU - o.w), (v) => upd((x) => { x.pos = v; }))),
                o.kind === 'door' ? h('div', { class: 'proprow' }, h('label', {}, 'Abre hacia el otro lado', h('input', { type: 'checkbox', checked: o.flip, onchange: (e) => upd((x) => { x.flip = e.target.checked; }) }))) : null,
                h('dl', { class: 'dl' }, h('dt', {}, 'Vano'), h('dd', {}, `${cm(o.w * G)} × ${cm(o.h * 25)} cm`), h('dt', {}, 'Dintel U'), h('dd', {}, `${cm(o.w * G + 50)} cm (apoyo 25 cm)`), h('dt', {}, 'Cara superior'), h('dd', {}, `hilada ${o.sill + o.h + 1}`)),
                h('div', { class: 'actions-row' }, delBtn, wall ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => store.setUi({ selection: { type: 'wall', id: wall.id } }) }, 'Ver muro') : null),
            );
            return;
        }

        if (s?.type === 'ubeam') {
            const u = lv.ubeams.find((x) => x.id === s.id);
            if (!u) return void (store.ui.selection = null);
            const wall = lv.walls.find((w) => w.id === u.wall);
            const upd = (fn) => modify('Editar viga U', (l) => fn(l.ubeams.find((x) => x.id === u.id)));
            add(el.props, 
                h('div', { class: 'kv-title' }, 'Viga de bloques U'),
                field('Hilada', sel(u.course, Array.from({ length: cfg.crownCourse }, (_, i) => [i, `${i + 1}`]), (v) => upd((x) => { x.course = Number(v); }))),
                field('Posición (× 12,5 cm)', num(u.pos, 0, Math.max(0, (wall ? wallLen(wall) : 40) - u.len), (v) => upd((x) => { x.pos = v; }))),
                field('Largo (× 12,5 cm)', num(u.len, 1, 200, (v) => upd((x) => { x.len = v; }))),
                h('p', { class: 'small muted' }, 'Se rellena con hormigón y armadura in situ.'),
                h('div', { class: 'actions-row' }, delBtn),
            );
            return;
        }

        if (s?.type === 'room') {
            const room = store.analysis?.levels?.[store.ui.level]?.rooms?.find((r) => r.id === s.id);
            if (!room) return void (store.ui.selection = null);
            add(el.props,
                h('div', { class: 'kv-title' }, h('span', { class: 'swatch', style: `background:${roomColor(room)}` }), room.name),
                h('dl', { class: 'dl' },
                    h('dt', {}, 'Superficie útil'), h('dd', {}, m2(room.netM2)),
                    h('dt', {}, 'Superficie a ejes'), h('dd', {}, m2(room.grossM2)),
                    h('dt', {}, 'Perímetro'), h('dd', {}, `${fmt(room.perimeterM, 2)} m`),
                    h('dt', {}, 'Medidas'), h('dd', {}, `${fmt((room.bbox.w * G) / 100, 2)} × ${fmt((room.bbox.h * G) / 100, 2)} m${room.rect ? '' : ' (en L / irregular)'}`)),
                h('p', { class: 'small muted' }, 'Arrastrá las esquinas azules para agrandar o achicar la habitación: se corren los dos muros de la esquina y los que llegan a ellos se estiran.'));
            return;
        }

        if (s?.type === 'roof') {
            const r = store.project.roofs.find((x) => x.id === s.id);
            if (!r) return void (store.ui.selection = null);
            const part = store.analysis?.roof?.parts?.find((p) => p.id === r.id);
            const upd = (fn) => store.commit('Editar techo', (d) => fn(d.roofs.find((x) => x.id === r.id)));
            const check = (label, key) => h('div', { class: 'proprow' }, h('label', {}, label, h('input', { type: 'checkbox', checked: r[key], onchange: (e) => upd((x) => { x[key] = e.target.checked; }) })));
            add(el.props,
                h('div', { class: 'kv-title' }, `Techo ${r.id} · ${r.type === 'gable' ? 'a dos aguas' : 'a un agua'}`),
                store.project.upper ? field('Apoya sobre', sel(r.level, [[0, 'Nivel 1'], [1, 'Nivel 2']], (v) => upd((x) => { x.level = Number(v); }))) : null,
                field('Ancho (× 12,5 cm)', num(r.w, 2, 900, (v) => upd((x) => { x.w = v; }))),
                field('Profundidad (× 12,5 cm)', num(r.h, 2, 900, (v) => upd((x) => { x.h = v; }))),
                field('Posición X (× 12,5 cm)', num(r.x, 0, 1000, (v) => upd((x) => { x.x = v; }))),
                field('Posición Y (× 12,5 cm)', num(r.y, 0, 1000, (v) => upd((x) => { x.y = v; }))),
                check('Hastial A (extremo inicial)', 'gableA'),
                check('Hastial B (extremo final)', 'gableB'),
                field('Espesor de hastiales', sel(r.gableT, [10, 15, 20].map((v) => [v, `${v} cm`]), (v) => upd((x) => { x.gableT = Number(v); }))),
                part ? h('dl', { class: 'dl' },
                    h('dt', {}, 'Cubierta'), h('dd', {}, m2(part.bom.coverM2)),
                    h('dt', {}, 'Altura sobre el muro'), h('dd', {}, `${fmt(part.geometry.riseCm / 100, 2)} m`),
                    h('dt', {}, 'Largo de cabio'), h('dd', {}, `${fmt(part.geometry.rafterLenCm / 100, 2)} m`),
                    h('dt', {}, 'Cabios'), h('dd', {}, `${int(part.bom.raftersCount)} de ${fmt(part.bom.raftersCommercialCm / 100, 2)} m`),
                    h('dt', {}, 'Bloques de hastiales'), h('dd', {}, int(part.geometry.gables.reduce((a, g) => a + g.blocks, 0)))) : null,
                h('p', { class: 'small muted' }, 'Tipo, pendiente, alero y cabios se cambian en la barra de arriba. Arrastrá las esquinas azules para cambiar el tamaño; clic en un hastial para editarlo.'),
                h('div', { class: 'actions-row' }, delBtn));
            return;
        }

        if (s?.type === 'gable') {
            const [rid, side] = String(s.id).split(':');
            const r = store.project.roofs.find((x) => x.id === rid);
            const gb = store.analysis?.roof?.parts?.find((p) => p.id === rid)?.geometry.gables.find((g) => g.id === s.id);
            if (!r || !gb) return void (store.ui.selection = null);
            const upd = (fn) => store.commit('Editar hastial', (d) => fn(d.roofs.find((x) => x.id === rid)));
            add(el.props,
                h('div', { class: 'kv-title' }, side === 'H' ? 'Muro alto del techo' : `Hastial ${side} del techo ${rid}`),
                field('Espesor', sel(r.gableT, [10, 15, 20].map((v) => [v, `${v} cm`]), (v) => upd((x) => { x.gableT = Number(v); }))),
                h('dl', { class: 'dl' }, h('dt', {}, 'Superficie'), h('dd', {}, m2(gb.areaM2)), h('dt', {}, 'Bloques (+10 %)'), h('dd', {}, int(gb.blocks))),
                h('p', { class: 'small muted' }, 'Son bloques 62,5 × 25 cm apilados en hiladas de 25 cm siguiendo la pendiente; el cómputo los estima por superficie.'),
                h('div', { class: 'actions-row' },
                    side === 'H' ? null : h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: deleteSelection }, 'Quitar hastial (Supr)'),
                    h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => store.setUi({ selection: { type: 'roof', id: rid } }) }, 'Ver techo')));
            return;
        }

        if (s?.type === 'slab') {
            const sl = store.project.levels[1].slabs.find((x) => x.id === s.id);
            if (!sl) return void (store.ui.selection = null);
            const upd = (fn) => store.commit('Editar losa', (d) => fn(d.levels[1].slabs.find((x) => x.id === sl.id)));
            const plan = store.analysis?.floors?.slabs?.find((x) => x.id === sl.id);
            add(el.props,
                h('div', { class: 'kv-title' }, 'Losa de piso (Nivel 2)'),
                field('Espesor', sel(sl.thickness, [10, 12, 15, 20].map((v) => [v, `${v} cm`]), (v) => upd((x) => { x.thickness = Number(v); }))),
                field('Ancho (× 12,5 cm)', num(sl.w, 2, 900, (v) => upd((x) => { x.w = v; }))),
                field('Profundidad (× 12,5 cm)', num(sl.h, 2, 900, (v) => upd((x) => { x.h = v; }))),
                field('Posición X (× 12,5 cm)', num(sl.x, 0, 1000, (v) => upd((x) => { x.x = v; }))),
                field('Posición Y (× 12,5 cm)', num(sl.y, 0, 1000, (v) => upd((x) => { x.y = v; }))),
                plan ? h('dl', { class: 'dl' }, h('dt', {}, 'Superficie'), h('dd', {}, m2(plan.areaM2)), h('dt', {}, 'Hormigón'), h('dd', {}, `${fmt((plan.areaM2 * sl.thickness) / 100, 2)} m³`)) : null,
                h('p', { class: 'small muted' }, 'La losa apoya sobre los muros de la Planta Baja; el hueco de las escaleras se descuenta solo.'),
                h('div', { class: 'actions-row' }, delBtn),
            );
            return;
        }

        if (s?.type === 'stair') {
            const st = store.project.levels[0].stairs.find((x) => x.id === s.id);
            if (!st) return void (store.ui.selection = null);
            const upd = (fn) => store.commit('Editar escalera', (d) => fn(d.levels[0].stairs.find((x) => x.id === st.id)));
            const plan = store.analysis?.floors?.stairs?.find((x) => x.id === st.id);
            add(el.props,
                h('div', { class: 'kv-title' }, 'Escalera'),
                field('Forma', sel(st.shape, [['straight', 'Recta'], ['L', 'En L con descanso'], ['U', 'En U con descanso']], (v) => upd((x) => { x.shape = v; }))),
                field('Sube hacia', sel(st.dir, [['N', 'Norte (arriba)'], ['E', 'Este (derecha)'], ['S', 'Sur (abajo)'], ['W', 'Oeste (izquierda)']], (v) => upd((x) => { x.dir = v; }))),
                st.shape !== 'straight' ? field('Gira a', sel(st.turn, [['right', 'la derecha'], ['left', 'la izquierda']], (v) => upd((x) => { x.turn = v; }))) : null,
                field('Ancho (× 12,5 cm)', num(st.w, 7, 16, (v) => upd((x) => { x.w = v; }))),
                field('Huella (cm)', num(st.tread, 25, 32, (v) => upd((x) => { x.tread = v; }))),
                field('Posición X (× 12,5 cm)', num(st.x, 0, 1000, (v) => upd((x) => { x.x = v; }))),
                field('Posición Y (× 12,5 cm)', num(st.y, 0, 1000, (v) => upd((x) => { x.y = v; }))),
                plan ? h('dl', { class: 'dl' },
                    h('dt', {}, 'Contrahuella'), h('dd', {}, `${fmt(plan.riseCm, 1)} cm`),
                    h('dt', {}, 'Peldaños'), h('dd', {}, int(plan.steps.length)),
                    h('dt', {}, 'Descansos'), h('dd', {}, int(plan.landings.length)),
                    h('dt', {}, 'Ocupa'), h('dd', {}, `${fmt(plan.bbox.w / 100)} × ${fmt(plan.bbox.h / 100)} m`)) : null,
                h('div', { class: 'actions-row' }, delBtn),
            );
            return;
        }

        if (s?.type === 'timber') {
            const t = store.project.levels[0].timber.find((x) => x.id === s.id);
            if (!t) return void (store.ui.selection = null);
            const upd = (fn) => store.commit('Editar madera', (d) => fn(d.levels[0].timber.find((x) => x.id === t.id)));
            const plan = store.analysis?.timber?.fields?.find((f) => f.id === t.id);
            const beam = store.analysis?.timber?.beams?.find((b) => b.id === t.id);
            add(el.props, 
                h('div', { class: 'kv-title' }, t.kind === 'beam' ? 'Viga de madera' : 'Entrepiso de madera'),
                field('Sección', sel(t.section, Object.entries(cfg.timberSections).map(([k, x]) => [k, x.label]), (v) => upd((x) => { x.section = v; }))),
                t.kind === 'joists' ? field('Dirección de tirantes', sel(t.dir, [['x', 'Horizontal (eje X)'], ['y', 'Vertical (eje Y)']], (v) => upd((x) => { x.dir = v; }))) : null,
                t.kind === 'joists' ? field('Separación', sel(t.spacing, [30, 40, 50, 60].map((v) => [v, `${v} cm`]), (v) => upd((x) => { x.spacing = Number(v); }))) : null,
                plan ? h('dl', { class: 'dl' }, h('dt', {}, 'Tirantes'), h('dd', {}, int(plan.count)), h('dt', {}, 'Luz libre'), h('dd', {}, `${fmt(plan.clearSpanCm / 100)} m`), h('dt', {}, 'Largo de tirante'), h('dd', {}, `${fmt(plan.lengthCm / 100)} m`), h('dt', {}, 'Entre ejes'), h('dd', {}, `${fmt(plan.spacingCm, 1)} cm`)) : null,
                beam ? h('dl', { class: 'dl' }, h('dt', {}, 'Luz libre'), h('dd', {}, `${fmt(beam.clearSpanCm / 100)} m`), h('dt', {}, 'Largo'), h('dd', {}, `${fmt(beam.lengthCm / 100)} m`)) : null,
                h('div', { class: 'actions-row' }, delBtn),
            );
            return;
        }

        add(el.props, 
            h('p', { class: 'empty-note' }, 'Nada seleccionado. Usá la herramienta Seleccionar (V) y hacé clic en un muro, vano o entrepiso.'),
            h('div', { class: 'kv-title' }, 'Ajustes del proyecto'),
            field('Espesor por defecto', sel(store.ui.thickness, cfg.thicknesses.map((t) => [t, `${cm(t)} cm`]), (v) => { store.setUi({ thickness: Number(v) }); store.patchProject({ settings: { ...store.project.settings, defaultT: Number(v) } }); })),
            field('Reserva por rotura (%)', num(store.project.settings?.reservePct ?? 3, 0, 30, (v) => { store.patchProject({ settings: { ...store.project.settings, reservePct: v } }); store.refresh(); })),
        );
    }

    /** Pestaña Techo sin selección: lista de techos y ayuda. */
    function renderRoofProps() {
        const roofs = store.project.roofs ?? [];
        add(el.props,
            roofs.length
                ? h('div', {}, h('div', { class: 'kv-title' }, 'Techos del proyecto'), roofs.map((r) => h('button', { class: 'btn btn-outline btn-sm', type: 'button', style: 'margin:2px', onclick: () => store.setUi({ selection: { type: 'roof', id: r.id } }) }, `${r.id} · ${r.type === 'gable' ? '2 aguas' : '1 agua'} · ${fmt((r.w * G) / 100, 1)}×${fmt((r.h * G) / 100, 1)} m`)))
                : h('p', { class: 'empty-note' }, 'Sin techos. Con la herramienta Techo (H) arrastrá un rectángulo sobre los muros, o hacé clic dentro de una habitación.'),
            h('p', { class: 'small muted' }, 'Cada techo es un rectángulo independiente: podés cubrir la planta alta y, aparte, la parte baja de la planta baja. Los precios de cubierta, cabios y correas se editan en Cómputo.'));
    }

    // ------------------------------------------------------------------ validación
    function renderIssues() {
        clear(el.issues);
        const issues = store.analysis?.issues ?? [];
        const errors = issues.filter((i) => i.severity === 'error').length;
        el.badge.textContent = String(issues.filter((i) => i.severity !== 'info').length);
        el.badge.classList.toggle('has-error', errors > 0);
        if (!issues.length) {
            add(el.issues, h('p', { class: 'empty-note' }, store.analysis ? 'Sin observaciones: el modelo cumple los controles de predimensionado.' : 'Calculando…'));
            return;
        }
        const ico = { error: '✕', warn: '!', info: 'i' };
        for (const i of issues) {
            add(el.issues, h('button', { type: 'button', class: `issue ${i.severity}`, title: 'Ir al elemento', onclick: () => app.focusIssue(i) }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico[i.severity]), h('span', {}, `${i.level === 1 ? '[PA] ' : i.level === 2 ? '[Techo] ' : ''}${i.message}`)));
        }
    }

    // ------------------------------------------------------------------ asoleamiento (se construye una sola vez)
    const solarUi = {};
    function buildSolar() {
        const sol = store.ui.solar;
        solarUi.rose = h('div', { class: 'rose', role: 'group', 'aria-label': 'Hacia dónde apunta el norte en el plano' },
            COMPASS.map((c) => (c ? h('button', { type: 'button', dataset: { deg: c[1] }, title: `El norte apunta hacia ${c[0]} en el plano`, onclick: () => { store.patchProject({ north: c[1] }); syncSolar(); } }, c[0]) : h('button', { type: 'button', class: 'center', tabindex: '-1', 'aria-hidden': 'true' }, '☀'))));
        solarUi.season = sel(sol.season, SEASONS, (v) => { store.setUi({ solar: { season: v } }); store.ensureSolar(); });
        solarUi.lat = h('input', { type: 'number', min: -66, max: 66, step: 0.1, value: store.project.lat, 'aria-label': 'Latitud', onchange: (e) => { const v = Math.max(-66, Math.min(66, Number(e.target.value) || 0)); store.patchProject({ lat: v }); store.ensureSolar(); syncSolar(); } });
        solarUi.city = sel('', [['', 'Ciudad…'], ...CITIES.map(([n, l]) => [l, n])], (v) => { if (v === '') return; store.patchProject({ lat: Number(v) }); store.ensureSolar(); syncSolar(); });
        solarUi.hour = h('input', { type: 'range', min: 6, max: 19, step: 0.25, value: sol.hour, 'aria-label': 'Hora solar', oninput: (e) => { store.setUi({ solar: { hour: Number(e.target.value) } }); syncSolar(); } });
        solarUi.out = h('output', {});
        solarUi.play = h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: togglePlay }, '▶');
        solarUi.show = h('input', { type: 'checkbox', checked: sol.show, onchange: (e) => { store.setUi({ solar: { show: e.target.checked } }); } });
        solarUi.info = h('p', { class: 'small muted' });
        solarUi.suggestBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: runSuggest }, 'Sugerir aberturas');
        solarUi.suggestions = h('div', { class: 'suggest' });
        add(el.solar, 
            h('div', { class: 'kv-title' }, 'Orientación del norte'), solarUi.rose,
            h('div', { class: 'solar-row' }, h('label', { class: 'field-inline' }, 'Época', solarUi.season)),
            h('div', { class: 'solar-row' }, h('label', { class: 'field-inline' }, 'Latitud', solarUi.lat), solarUi.city),
            h('div', { class: 'solar-row' }, solarUi.play, solarUi.hour, solarUi.out),
            h('div', { class: 'solar-row' }, h('label', { class: 'field-inline' }, solarUi.show, 'Mostrar sombras y sol')),
            solarUi.info,
            solarUi.suggestBtn,
            solarUi.suggestions,
        );
        syncSolar();
    }

    let timer = null;
    function togglePlay() {
        if (timer) {
            clearInterval(timer);
            timer = null;
            solarUi.play.textContent = '▶';
            return;
        }
        solarUi.play.textContent = '⏸';
        timer = setInterval(() => {
            let hr = store.ui.solar.hour + 0.15;
            if (hr > 19) hr = 6;
            store.setUi({ solar: { hour: hr } });
            solarUi.hour.value = hr;
            syncSolar();
        }, 60);
    }

    function syncSolar() {
        const sol = store.ui.solar;
        for (const b of solarUi.rose.querySelectorAll('button[data-deg]')) b.setAttribute('aria-pressed', String(Number(b.dataset.deg) === store.project.north));
        const hh = Math.floor(sol.hour);
        const mm = String(Math.round((sol.hour - hh) * 60)).padStart(2, '0');
        solarUi.out.textContent = `${String(hh).padStart(2, '0')}:${mm}`;
        solarUi.lat.value = store.project.lat;
        const s = store.sun();
        solarUi.info.textContent = s ? `${sol.label ?? ''} · altura solar ${fmt(s.alt, 1)}° · acimut ${fmt(s.az, 0)}° (desde el norte). Hora solar aparente.` : 'Cargando trayectoria solar…';
    }
    app.syncSolar = syncSolar;

    async function runSuggest() {
        solarUi.suggestBtn.disabled = true;
        clear(solarUi.suggestions);
        try {
            const { suggestions } = await suggest(store.project);
            renderSuggestions(suggestions);
        } catch (e) {
            add(solarUi.suggestions, h('p', { class: 'empty-note' }, `No se pudo calcular: ${e.message}`));
        } finally {
            solarUi.suggestBtn.disabled = false;
        }
    }

    function renderSuggestions(list) {
        clear(solarUi.suggestions);
        if (!list.length) {
            add(solarUi.suggestions, h('p', { class: 'empty-note' }, 'No hay sugerencias: dibujá ambientes cerrados con muros exteriores primero.'));
            return;
        }
        const applicable = list.filter((s) => s.apply);
        const checks = new Map();
        const typeLabel = { solar: 'Sol de invierno', cross: 'Ventilación cruzada', shade: 'Protección solar', info: 'Aviso' };
        for (const s of list) {
            const cb = s.apply ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'Aplicar sugerencia' }) : null;
            if (cb) checks.set(s.id, cb);
            add(solarUi.suggestions, h('label', { class: 'suggest-item', style: 'flex-direction:row;font-weight:500' }, cb, h('span', {}, h('span', { class: 'tag' }, `${s.level === 1 ? 'PA · ' : ''}${typeLabel[s.type] ?? s.type}`), s.reason, s.apply ? ` (${cm(s.w * G)} cm)` : '')));
        }
        if (applicable.length) {
            add(solarUi.suggestions, h('div', { class: 'actions-row' },
                h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => applySuggestions(applicable.filter((s) => checks.get(s.id)?.checked)) }, 'Aplicar seleccionadas'),
                h('span', { class: 'small muted' }, 'Las jambas y apoyos de dintel U quedan a ≥ 25 cm.')));
        }
    }

    function applySuggestions(items) {
        if (!items.length) return;
        store.commit('Aplicar sugerencias bioclimáticas', (d) => {
            for (const s of items) {
                const p = cfg.presets[s.preset];
                d.levels[s.level].openings.push({ id: nextId(d, 'o'), wall: s.wall, pos: s.pos, w: s.w, sill: p.sill, h: p.h, kind: 'window', preset: s.preset, flip: false });
            }
        });
        clear(solarUi.suggestions);
        add(solarUi.suggestions, h('p', { class: 'small' }, `${items.length} ventana(s) aplicada(s). Podés deshacer con Ctrl+Z.`));
    }

    buildSolar();

    return {
        renderAll() {
            renderTelemetry();
            renderProps();
            renderIssues();
        },
        renderProps,
        syncSolar,
    };
}
