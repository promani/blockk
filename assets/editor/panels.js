import { h, add, clear, $ } from '../lib/dom.js';
import { fmt, int, m2, pct, cm } from '../lib/format.js';
import { suggest } from '../lib/api.js';
import { nextId } from '../lib/storage.js';
import { roomColor } from './renderer.js';
import { anchorLines } from './snap.js';
import { sideLabel } from '../lib/orient.js';
import { collinearChain } from './wallmove.js';
import { TYPE_CHOICES, openingTitle, typeOf, applyType, modeChoices, defaultMode, turnOptions, turnValue, applyTurn, commercialFor, commercialOf } from './openings.js';
import { roomNamesList, roomAnchor, roomTypeItems, nameForType, setLabelType } from './names.js';
import { ZONE_KINDS, TREE_SIZES } from './site.js';
import { footprint, furnitureGroups, turnFurniture } from './furniture.js';
import { contextOf, CONTEXT_TITLE, roomWalls, facing, openingM2, issueMatches } from './context.js';

const G = 12.5;
/** [nombre, latitud, longitud, huso horario (UTC)] */
const CITIES = [['Buenos Aires', -34.6, -58.4, -3], ['Córdoba', -31.4, -64.2, -3], ['Rosario', -32.9, -60.7, -3], ['Mendoza', -32.9, -68.8, -3], ['Mar del Plata', -38.0, -57.6, -3], ['Neuquén', -38.9, -68.1, -3], ['Tucumán', -26.8, -65.2, -3], ['Salta', -24.8, -65.4, -3], ['Bariloche', -41.1, -71.3, -3], ['Ushuaia', -54.8, -68.3, -3], ['Montevideo', -34.9, -56.2, -3], ['Santiago de Chile', -33.4, -70.7, -4], ['Madrid', 40.4, -3.7, 1], ['Ciudad de México', 19.4, -99.1, -6]];
const SEASONS = [['winter', 'Invierno'], ['summer', 'Verano'], ['equinox', 'Equinoccio']];

const wallLen = (w) => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);

export function mountPanels(app) {
    const { store } = app;
    const cfg = store.config;
    const el = { tele: $('#telemetry'), props: $('#props'), solar: h('div', { class: 'solar-box' }), issues: $('#issues'), badge: $('#issues-badge') };

    // ------------------------------------------------------------------ telemetría
    const kpi = (label, value, title) => h('div', { class: 'kpi-mini', title }, h('b', {}, value), h('span', {}, label));
    const setTitle = (sel, base, ctx) => {
        const t = document.querySelector(sel);
        if (t?.firstChild) t.firstChild.textContent = CONTEXT_TITLE[ctx.kind] ? `${base} · ${CONTEXT_TITLE[ctx.kind]} ` : `${base} `;
    };

    /** Resumen según lo que el usuario está haciendo (herramienta o elemento elegido). */
    function renderTelemetry() {
        const a = store.analysis;
        clear(el.tele);
        const ctx = contextOf(store);
        setTitle('#card-telemetry > summary', 'Resumen', ctx);
        if (!a) {
            add(el.tele, h('p', { class: 'empty-note' }, 'Calculando…'));
            return;
        }
        if (ctx.kind === 'openings') return renderOpeningsSummary(a);
        if (ctx.kind === 'wall') return renderWallSummary(a, ctx.id);
        if (ctx.kind === 'room') return renderRoomSummary(a, ctx.id);
        if (ctx.kind === 'floor') return renderFloorSummary(a);
        return renderGeneralSummary(a);
    }

    /** Luz natural por habitación: m² de ventanas / m² útiles (referencia ≥ 1/8 del piso). */
    const LIGHT_REF = 12.5;
    function roomLight(li, room) {
        const lv = store.project.levels[li];
        const walls = new Set(roomWalls(room, lv.walls).map((w) => w.id));
        const wins = lv.openings.filter((o) => o.kind === 'window' && walls.has(o.wall));
        const area = wins.reduce((acc, o) => acc + openingM2(o), 0);
        return { wins, area, pct: room.netM2 > 0 ? (100 * area) / room.netM2 : 0 };
    }
    const lightTag = (pctV) => h('span', { class: `light ${pctV >= LIGHT_REF ? 'ok' : pctV > 0 ? 'low' : 'none'}`, title: `Referencia: ventanas ≥ ${fmt(LIGHT_REF, 1)} % del piso` }, `${fmt(pctV, 0)} %`);

    function renderOpeningsSummary(a) {
        const li = Math.min(store.ui.level, 1);
        const lv = store.project.levels[li];
        const wins = lv.openings.filter((o) => o.kind === 'window');
        const doors = lv.openings.filter((o) => o.kind === 'door');
        const glass = wins.reduce((acc, o) => acc + openingM2(o), 0);
        const rooms = a.levels[li]?.rooms ?? [];
        const floor = rooms.reduce((acc, r) => acc + r.netM2, 0);
        const byFace = { N: 0, E: 0, S: 0, O: 0 };
        for (const o of wins) {
            const f = facing(a.levels[li]?.walls?.[o.wall]?.ext, store.project.north);
            if (f) byFace[f] += openingM2(o);
        }
        const sunny = store.project.lat < 0 ? 'N' : 'S'; // fachada con sol de invierno
        el.sugBox = h('div', { class: 'suggest' });
        add(el.tele,
            h('div', { class: 'kpi-grid' },
                kpi('ventanas', int(wins.length)),
                kpi('puertas', int(doors.length)),
                kpi('m² de vidrio', fmt(glass, 1)),
                kpi('luz / piso', floor > 0 ? `${fmt((100 * glass) / floor, 0)} %` : '—', `Ventanas / superficie útil del nivel. Referencia ≥ ${fmt(LIGHT_REF, 1)} %`)),
            rooms.length ? h('div', {}, h('div', { class: 'kv-title' }, 'Luz natural por habitación'),
                h('dl', { class: 'dl' }, rooms.flatMap((r) => {
                    const L = roomLight(li, r);
                    return [h('dt', {}, h('span', { class: 'swatch', style: `background:${roomColor(r)}` }), r.name), h('dd', {}, `${int(L.wins.length)} vent. · `, lightTag(L.pct))];
                }))) : null,
            h('div', { class: 'kv-title' }, 'Vidrio por orientación'),
            h('div', { class: 'faces' }, Object.entries(byFace).map(([k, v]) => h('div', { class: `face${k === sunny ? ' sunny' : ''}`, title: k === sunny ? 'Recibe sol en invierno' : '' }, h('b', {}, k), h('span', {}, `${fmt(v, 1)} m²`)))),
            h('div', { class: 'actions-row' }, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => runSuggest(el.sugBox) }, 'Sugerir ventanas según el sol')),
            el.sugBox);
    }

    /** Piezas de un muro: las de sus corridas cuyo centro cae dentro del muro. */
    function wallBlocks(a, li, w) {
        const horizontal = w.y1 === w.y2;
        const axis = horizontal ? 'x' : 'y';
        const line = (horizontal ? w.y1 : w.x1) * G;
        const lo = (horizontal ? w.x1 : w.y1) * G - w.t / 2;
        const hi = (horizontal ? w.x2 : w.y2) * G + w.t / 2;
        let n = 0;
        let cut = 0;
        let u = 0;
        for (const course of a.levels[li]?.courses ?? []) {
            for (const r of course) {
                if (r.axis !== axis || Math.abs(r.line - line) > 0.01) continue;
                for (const [p0, p1, k] of r.pieces) {
                    const m = (p0 + p1) / 2;
                    if (m < lo || m > hi) continue;
                    n++;
                    if (k === 1 || k === 3) cut++;
                    if (k >= 2) u++;
                }
            }
        }
        return { n, cut, u };
    }

    function renderWallSummary(a, id) {
        const li = Math.min(store.ui.level, 1);
        const w = store.project.levels[li].walls.find((x) => x.id === id);
        if (!w) return renderGeneralSummary(a);
        const b = wallBlocks(a, li, w);
        const lenM = (wallLen(w) * G) / 100;
        const hM = ((w.h ?? 12) * 25) / 100;
        const ops = store.project.levels[li].openings.filter((o) => o.wall === id);
        const f = facing(a.levels[li]?.walls?.[id]?.ext, store.project.north);
        add(el.tele,
            h('div', { class: 'kpi-grid' },
                kpi('piezas', int(b.n), 'Piezas de bloque de este muro (enteras y cortadas)'),
                kpi('con corte', int(b.cut)),
                kpi('bloques U', int(b.u)),
                kpi('m² de muro', fmt(lenM * hM - ops.reduce((acc, o) => acc + openingM2(o), 0), 1))),
            h('dl', { class: 'dl' },
                h('dt', {}, 'Medidas'), h('dd', {}, `${fmt(lenM, 2)} × ${fmt(hM, 2)} m`),
                h('dt', {}, 'Fachada'), h('dd', {}, f ? `exterior, mira al ${f}` : 'interior'),
                h('dt', {}, 'Vanos'), h('dd', {}, int(ops.length))));
    }

    function renderRoomSummary(a, id) {
        const li = Math.min(store.ui.level, 1);
        const room = a.levels[li]?.rooms?.find((r) => r.id === id);
        if (!room) return renderGeneralSummary(a);
        const L = roomLight(li, room);
        add(el.tele,
            h('div', { class: 'kpi-grid' },
                kpi('m² útiles', fmt(room.netM2, 1)),
                kpi('perímetro (m)', fmt(room.perimeterM, 1)),
                kpi('ventanas', int(L.wins.length)),
                h('div', { class: 'kpi-mini', title: `Ventanas / piso. Referencia ≥ ${fmt(LIGHT_REF, 1)} %` }, h('b', {}, lightTag(L.pct)), h('span', {}, 'luz natural'))));
    }

    function renderFloorSummary(a) {
        const t = a.telemetry;
        const fields = a.timber?.fields ?? [];
        const stairs = a.floors?.stairs ?? [];
        add(el.tele,
            h('div', { class: 'kpi-grid' },
                kpi('m² de losa', fmt(t.slabM2 ?? 0, 1)),
                kpi('m² de madera', fmt(fields.reduce((acc, f) => acc + (f.deckAreaM2 ?? 0), 0), 1)),
                kpi('tirantes', int(fields.reduce((acc, f) => acc + f.count, 0))),
                kpi('escaleras', int(stairs.length))),
            stairs.length ? h('dl', { class: 'dl' }, stairs.flatMap((st) => [h('dt', {}, `Escalera ${st.shape === 'straight' ? 'recta' : `en ${st.shape}`}`), h('dd', {}, `${int(st.steps.length)} peldaños de ${fmt(st.riseCm, 1)} cm`)])) : null);
    }

    function renderGeneralSummary(a) {
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
                        h('dt', {}, 'Hastiales de bloque'), h('dd', { title: 'Sus bloques están sumados en «Bloques a comprar».' }, m2(roofBom.gableMasonryM2)))
                    : h('p', { class: 'empty-note' }, 'Sin techos.'))
            : null;
        const full = tot.heightM >= tot.maxHeightM;
        add(el.tele,
            h('div', { class: 'kpi-grid' },
                kpi('m² útiles', fmt(tot.netM2, 1), 'Superficie útil de todos los niveles'),
                kpi('bloques', int(tot.blocks), 'Bloques a comprar (con reserva), incluidos hastiales'),
                kpi('pallets', int(tot.pallets)),
                kpi(`${tot.currency} (ref.)`, fmt(tot.cost, 0), 'Costo de referencia con precios de ejemplo (se editan en Cómputo)')),
            roofBlock,
            h('details', { class: 'more' },
                h('summary', {}, 'Más datos'),
                h('div', { class: 'kv-title' }, cfg.levelNames[Math.min(store.ui.level, 1)]),
                h('dl', { class: 'dl' },
                    h('dt', {}, 'Superficie útil'), h('dd', {}, m2(lv.netM2)),
                    h('dt', {}, 'Superficie a ejes'), h('dd', {}, m2(lv.grossM2)),
                    h('dt', {}, 'Muros (longitud)'), h('dd', {}, `${fmt(lv.wallLengthM, 2)} m`),
                    h('dt', {}, 'Habitaciones'), h('dd', {}, int(lv.rooms)),
                    h('dt', {}, 'Bloques del nivel'), h('dd', {}, int(lv.blocks))),
                t.slabM2 > 0 || t.stairs > 0 ? h('dl', { class: 'dl' }, t.slabM2 > 0 ? [h('dt', {}, 'Losa de piso'), h('dd', {}, m2(t.slabM2))] : null, t.stairs > 0 ? [h('dt', {}, 'Escaleras'), h('dd', {}, int(t.stairs))] : null) : null,
                t.byType?.some((x) => x.type) ? [
                    h('div', { class: 'kv-title' }, 'Superficie útil por tipo de ambiente'),
                    h('dl', { class: 'dl' },
                        t.byType.map((x) => [h('dt', {}, `${x.label}${x.rooms > 1 ? ` (${x.rooms})` : ''}`), h('dd', {}, m2(x.m2))]),
                        t.habitableM2 < tot.netM2 ? [h('dt', { title: 'Sin garajes ni galerías' }, 'Superficie habitable'), h('dd', {}, m2(t.habitableM2))] : null),
                ] : null,
                h('div', { class: 'kv-title' }, 'Obra completa'),
                h('div', { class: `meter${full ? ' full' : ''}`, title: 'Altura autoportante' }, h('i', { style: `width:${Math.min(100, (tot.heightM / tot.maxHeightM) * 100)}%` })),
                h('dl', { class: 'dl' },
                    h('dt', {}, 'Altura autoportante'), h('dd', {}, `${fmt(tot.heightM, 2)} / ${fmt(tot.maxHeightM, 2)} m`),
                    h('dt', {}, 'Mortero adhesivo'), h('dd', {}, `${int(tot.adhesiveBags)} bolsas`),
                    h('dt', {}, 'Descarte de material'), h('dd', { title: 'Objetivo del sistema: < 4 %' }, pct(tot.scrapPct)),
                    h('dt', {}, 'Bloques con corte'), h('dd', {}, pct(tot.cutBlocksPct)))),
        );
    }

    // ------------------------------------------------------------------ propiedades
    const field = (labelText, control) => h('div', { class: 'proprow' }, h('label', {}, labelText, control));
    // El cambio se aplica después del evento: el panel se redibuja y el campo con foco no se borra en medio de su propio «change».
    const num = (value, min, max, onChange, step = 1) => h('input', { type: 'number', value, min, max, step, onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== Number(value)) setTimeout(() => onChange(Math.min(max, Math.max(min, v)))); } });
    const sel = (value, items, onChange) => h('select', { onchange: (e) => onChange(e.target.value) }, items.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text)));
    /** Nombre del techo para la interfaz: por su orden en el proyecto, no por su id interno. */
    const roofName = (id) => `Techo ${(store.project.roofs ?? []).findIndex((x) => x.id === id) + 1}`;
    const modify = (label, fn) => store.commit(label, (d) => fn(d.levels[store.ui.level], d));
    /** Aberturas que la persona pasó a «A medida» aunque coincidan con una medida de catálogo. */
    const customOpenings = new Set();

    function deleteSelection() {
        if (app.deleteMulti?.()) return; // varios elegidos con un rectángulo: se borran todos juntos
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
            else if (sel_.type === 'tree') d.trees = (d.trees ?? []).filter((x) => x.id !== sel_.id);
            else if (sel_.type === 'zone') d.zones = (d.zones ?? []).filter((x) => x.id !== sel_.id);
            else if (sel_.type === 'column') lv.columns = (lv.columns ?? []).filter((x) => x.id !== sel_.id);
            else if (sel_.type === 'furniture') lv.furniture = (lv.furniture ?? []).filter((x) => x.id !== sel_.id);
            else if (sel_.type === 'label') lv.labels = (lv.labels ?? []).filter((x) => x.id !== sel_.id);
        });
    }
    app.deleteSelection = deleteSelection;

    /**
     * Brújula para orientar el terreno: se arrastra la aguja hacia donde queda el norte real (de a 5°, con Mayús de a
     * 1°) o se escribe el ángulo. 0° = arriba del plano, en sentido horario. Mientras se arrastra sólo se redibuja; al
     * soltar se guarda en el proyecto.
     */
    function northDial() {
        const R = 44;
        const NS = 'http://www.w3.org/2000/svg';
        const svg = (tag, attrs) => {
            const el = document.createElementNS(NS, tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
            return el;
        };
        const dial = svg('svg', { viewBox: '-56 -56 112 112', class: 'north-dial', role: 'slider', tabindex: '0', 'aria-label': 'Hacia dónde queda el norte', 'aria-valuemin': '0', 'aria-valuemax': '359' });
        dial.append(svg('circle', { r: R, class: 'nd-ring' }));
        for (let d = 0; d < 360; d += 15) {
            const a = (d * Math.PI) / 180;
            const r0 = d % 90 === 0 ? R - 9 : d % 45 === 0 ? R - 6 : R - 3;
            dial.append(svg('line', { x1: Math.sin(a) * r0, y1: -Math.cos(a) * r0, x2: Math.sin(a) * R, y2: -Math.cos(a) * R, class: 'nd-tick' }));
        }
        const needle = svg('g', { class: 'nd-needle' });
        needle.append(svg('path', { d: `M0 ${-R + 12} L7 2 L0 -3 L-7 2 Z`, class: 'nd-n' }), svg('path', { d: `M0 ${R - 16} L6 2 L0 -3 L-6 2 Z`, class: 'nd-s' }));
        const label = svg('text', { class: 'nd-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
        label.textContent = 'N';
        dial.append(needle, label, svg('circle', { r: 3, class: 'nd-hub' }));
        const input = h('input', { type: 'number', min: 0, max: 359, step: 1, class: 'w-narrow', 'aria-label': 'Ángulo del norte en grados' });
        const hint = h('span', { class: 'muted small' });
        const DIRS8 = ['arriba', 'arriba a la derecha', 'a la derecha', 'abajo a la derecha', 'abajo', 'abajo a la izquierda', 'a la izquierda', 'arriba a la izquierda'];
        const show = (v) => {
            needle.setAttribute('transform', `rotate(${v})`);
            const a = (v * Math.PI) / 180;
            label.setAttribute('x', String(Math.sin(a) * (R + 8) * 0.78));
            label.setAttribute('y', String(-Math.cos(a) * (R + 8) * 0.78));
            dial.setAttribute('aria-valuenow', String(v));
            input.value = String(v);
            hint.textContent = `El norte queda ${DIRS8[Math.round(v / 45) % 8]} del plano.`;
        };
        const commit = (v) => {
            store.patchProject({ north: ((Math.round(v) % 360) + 360) % 360 });
            app.syncSolar?.();
        };
        const angleAt = (e, fine) => {
            const r = dial.getBoundingClientRect();
            const a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
            const step = fine ? 1 : 5;
            return ((Math.round(a / step) * step) % 360 + 360) % 360;
        };
        let dragging = false;
        dial.addEventListener('pointerdown', (e) => {
            dragging = true;
            dial.setPointerCapture(e.pointerId);
            const v = angleAt(e, e.shiftKey);
            store.project.north = v;
            show(v);
            app.render();
        });
        dial.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const v = angleAt(e, e.shiftKey);
            if (v === store.project.north) return;
            store.project.north = v;
            show(v);
            app.render();
        });
        const end = () => {
            if (!dragging) return;
            dragging = false;
            commit(store.project.north);
        };
        dial.addEventListener('pointerup', end);
        dial.addEventListener('pointercancel', end);
        dial.addEventListener('keydown', (e) => {
            const d = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
            if (!d) return;
            e.preventDefault();
            commit(store.project.north + (e.shiftKey ? Math.sign(d) : d));
        });
        input.addEventListener('change', () => commit(Number(input.value) || 0));
        show(store.project.north ?? 0);
        return h('div', { class: 'north-row' }, dial, h('div', { class: 'north-info' }, h('label', { class: 'field-inline' }, input, '°'), hint,
            h('span', { class: 'muted small' }, 'Arrastrá la aguja hacia donde queda el norte real.')));
    }

    /** Botones para correr un muro un bloque hacia cada lado (perpendicular a su eje). */
    function moveButtons(w) {
        const horizontal = w.y1 === w.y2;
        const neg = horizontal ? '▲' : '◀';
        const pos = horizontal ? '▼' : '▶';
        const negName = horizontal ? 'arriba' : 'la izquierda';
        const posName = horizontal ? 'abajo' : 'la derecha';
        const bu = cfg.blockUnits;
        const bl = fmt(cfg.blockL, 1);
        return [[-bu, `${neg} ${bl} cm`, negName], [bu, `${pos} ${bl} cm`, posName]].map(([d, text, name]) =>
            h('button', { class: 'btn btn-outline btn-sm', type: 'button', title: `Mover ${fmt(Math.abs(d) * G, 1)} cm hacia ${name}`, onclick: () => app.moveWallBy(w.id, d) }, text));
    }

    /**
     * Sugerencias para agrandar/achicar una habitación hasta anclajes típicos: el muro de abajo (en el Nivel 2) y la pared
     * paralela más cercana hacia afuera. Cada una corre el muro de ese lado con un clic.
     */
    function roomSuggestions(room) {
        const lv = store.level();
        const b = room.bbox;
        const sides = [
            ['N', `▲ ${sideLabel('N', store.project.north, false)}`, 'x', b.y, -1, b.x, b.x + b.w],
            ['S', `▼ ${sideLabel('S', store.project.north, false)}`, 'x', b.y + b.h, 1, b.x, b.x + b.w],
            ['O', `◀ ${sideLabel('W', store.project.north, false)}`, 'y', b.x, -1, b.y, b.y + b.h],
            ['E', `▶ ${sideLabel('E', store.project.north, false)}`, 'y', b.x + b.w, 1, b.y, b.y + b.h],
        ];
        const out = [];
        for (const [, name, axis, v, outward, lo, hi] of sides) {
            const wall = lv.walls.find((w) => (axis === 'x' ? w.y1 === w.y2 && w.y1 === v && w.x1 < hi && w.x2 > lo : w.x1 === w.x2 && w.x1 === v && w.y1 < hi && w.y2 > lo));
            if (!wall) continue;
            const chain = new Set(collinearChain(lv.walls, wall).map((w) => w.id));
            const anchors = anchorLines(store, axis, { exclude: chain }).filter((a) => a.v !== v && Math.abs(a.v - v) <= 32 && a.from < hi + 8 && a.to > lo - 8);
            const pick = (list) => list.sort((p, q) => Math.abs(p.v - v) - Math.abs(q.v - v))[0];
            const below = pick(anchors.filter((a) => a.kind === 'abajo'));
            const outer = pick(anchors.filter((a) => a.kind !== 'abajo' && Math.sign(a.v - v) === outward));
            for (const a of [below, outer]) {
                if (!a || out.some((o) => o.wall === wall.id && o.v === a.v)) continue;
                const d = a.v - v;
                const what = a.kind === 'abajo' ? 'hasta el muro de abajo' : a.kind === 'arriba' ? 'hasta el muro de arriba' : 'hasta la pared vecina';
                out.push({ wall: wall.id, v: a.v, text: `${name} ${what} (${d * outward > 0 ? '+' : '−'}${fmt((Math.abs(d) * G) / 100, 2)} m)`, delta: d });
            }
        }

        return out.slice(0, 6);
    }

    function renderProps() {
        clear(el.props);
        // Título del panel: lo elegido o, si no hay nada, las configuraciones generales del proyecto.
        const title = document.querySelector('#card-props > summary');
        if (title) title.textContent = store.ui.selection ? 'Selección' : store.ui.level === 2 ? 'Techos' : 'Configuraciones generales';
        // Mientras se dibuja con una herramienta, las configuraciones generales se pliegan y el Resumen queda a la vista.
        const card = document.getElementById('card-props');
        if (card && !store.ui.selection && store.ui.level !== 2) {
            const drawing = store.ui.tool !== 'select';
            if (card.dataset.auto !== String(drawing)) {
                card.open = !drawing;
                card.dataset.auto = String(drawing);
            }
        } else if (card && !card.open) {
            card.open = true;
            card.dataset.auto = '';
        }
        const s = store.ui.selection;
        // En la pestaña Techo: el techo o hastial elegido (con «Eliminar», como cualquier pieza) o la lista de techos.
        if (store.ui.level === 2 && s?.type !== 'roof' && s?.type !== 'gable') {
            renderRoofProps();
            return;
        }
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
                h('dl', { class: 'dl' }, h('dt', {}, 'Longitud'), h('dd', {}, `${fmt(len / 100)} m`), h('dt', {}, 'Bloques a lo largo'), h('dd', {}, fmt(len / cfg.blockL, 2)), h('dt', {}, 'Eje'), h('dd', {}, w.y1 === w.y2 ? 'horizontal' : 'vertical')),
                field('Espesor', sel(w.t, cfg.thicknesses.map((t) => [t, `${cm(t)} cm`]), (v) => modify('Cambiar espesor', (l) => { l.walls.find((x) => x.id === w.id).t = Number(v); }))),
                (() => {
                    // Alto en hiladas de 25 cm: más bajo que el nivel (medianeras, parapetos) o, sin nada arriba, hasta 4,00 m.
                    const maxH = store.ui.level === 0 && !store.project.upper ? 16 : 12;
                    const hNow = w.h ?? 12;
                    const opts = [];
                    for (let n = maxH; n >= 2; n--) opts.push([n, `${fmt((n * 25) / 100)} m${n === 12 ? ' (nivel completo)' : ''} · ${n} hiladas`]);
                    return field('Alto', sel(hNow, opts, (v) => modify('Cambiar alto', (l) => { l.walls.find((x) => x.id === w.id).h = Number(v); })));
                })(),
                h('div', { class: 'proprow' }, h('label', { title: 'Última hilada de bloques U rellenos con hormigón y hierro (encadenado). Sacala en paredes que son sólo mampostería.' },
                    'Corona de bloques U (encadenado)',
                    h('input', { type: 'checkbox', checked: w.crown ?? w.t >= cfg.loadBearingMin, onchange: (e) => modify('Corona U', (l) => { l.walls.find((x) => x.id === w.id).crown = e.target.checked; }) }))),
                (() => {
                    // Habitaciones que forma este muro (para elegirlas y estirarlas desde las esquinas).
                    const horizontal = w.y1 === w.y2;
                    const line = horizontal ? w.y1 : w.x1;
                    const rooms = (store.analysis?.levels?.[store.ui.level]?.rooms ?? []).filter((r) => r.fill?.some(([x, y, fw, fh]) => (horizontal
                        ? (y === line || y + fh === line) && x < w.x2 && x + fw > w.x1
                        : (x === line || x + fw === line) && y < w.y2 && y + fh > w.y1)));
                    return rooms.length ? h('div', { class: 'actions-row' }, rooms.map((r) => h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => store.setUi({ selection: { type: 'room', id: r.id } }) }, h('span', { class: 'swatch', style: `background:${roomColor(r)}` }), `Elegir ${r.name}`))) : null;
                })(),
                h('div', { class: 'kv-title' }, 'Agrandar / achicar la habitación'),
                h('div', { class: 'nudge', role: 'group', 'aria-label': 'Mover el muro' }, moveButtons(w)),
                ops.length ? h('div', {}, h('div', { class: 'kv-title' }, 'Vanos'), ops.map((o) => h('button', { class: 'btn btn-outline btn-sm', type: 'button', style: 'margin:2px', onclick: () => store.setUi({ selection: { type: 'opening', id: o.id, wall: w.id } }) }, `${openingTitle(o)} ${cm(o.w * G)} cm`))) : null,
                beams.length ? h('div', {}, h('div', { class: 'kv-title' }, 'Vigas U'), beams.map((u) => h('button', { class: 'btn btn-outline btn-sm', type: 'button', style: 'margin:2px', onclick: () => store.setUi({ selection: { type: 'ubeam', id: u.id, wall: w.id } }) }, `Hilada ${u.course + 1} · ${cm(u.len * G)} cm`))) : null,
                h('div', { class: 'actions-row' }, delBtn),
            );
            return;
        }

        if (s?.type === 'opening') {
            const o = lv.openings.find((x) => x.id === s.id);
            if (!o) return void (store.ui.selection = null);
            const wall = lv.walls.find((w) => w.id === o.wall);
            const upd = (fn) => modify('Editar abertura', (l) => fn(l.openings.find((x) => x.id === o.id)));
            const top = cfg.openingTopCourse;
            const mode = o.mode ?? defaultMode(o.kind);
            const arch = typeOf(o) === 'arch';
            const turns = (mode === 'swing' && o.kind === 'door') || mode === 'slide';
            // Medida de catálogo (se deduce del tipo, el ancho y el antepecho) o a medida, con los campos libres.
            const match = customOpenings.has(o.id) || arch ? null : commercialOf(cfg, o);
            add(el.props,
                h('div', { class: 'kv-title' }, openingTitle(o)),
                field('Tipo', sel(typeOf(o), TYPE_CHOICES, (v) => upd((x) => applyType(x, v, top)))),
                (() => {
                    const list = arch ? [] : commercialFor(cfg, o.kind);
                    return list.length ? field('Medida', sel(match?.id ?? '', [...list.map((c) => [c.id, c.label]), ['', 'A medida']], (v) => {
                        const c = list.find((x) => x.id === v);
                        if (!c) {
                            customOpenings.add(o.id);
                            renderProps();
                            return;
                        }
                        customOpenings.delete(o.id);
                        upd((x) => Object.assign(x, { w: c.w, sill: c.sill, h: top - c.sill, mode: c.mode, preset: '' }));
                    })) : null;
                })(),
                match ? null : field('Ancho (cm)', num(o.w * G, 25, 500, (v) => upd((x) => { x.w = Math.max(2, Math.round(v / G)); x.preset = ''; }), G)),
                !match && o.kind === 'window'
                    ? field('Antepecho (cm del suelo)', sel(o.sill, [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [n, `${n * 25}`]), (v) => upd((x) => { x.sill = Number(v); x.h = top - Number(v); x.preset = ''; })))
                    : null,
                field('Alto (cm)', h('input', { type: 'text', value: cm(o.h * 25), disabled: true, title: o.kind === 'window' ? 'Llega hasta los 2,00 m: se baja o sube con el antepecho.' : 'Alto fijo de 2,00 m.' })),
                arch ? null : field('Apertura', sel(mode, modeChoices(o), (v) => upd((x) => { x.mode = v; }))),
                turns ? field(mode === 'slide' ? 'Recorrido' : 'Giro', sel(turnValue(o), turnOptions(wall ? wall.y1 === wall.y2 : true, mode), (v) => upd((x) => applyTurn(x, v)))) : null,
                h('div', { class: 'actions-row' }, delBtn, wall ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => store.setUi({ selection: { type: 'wall', id: wall.id } }) }, 'Ver muro') : null),
                h('p', { class: 'muted small' }, 'Para moverla, arrastrala por el muro.'),
            );
            return;
        }

        if (s?.type === 'zone') {
            const z = (store.project.zones ?? []).find((x) => x.id === s.id);
            if (!z) return void (store.ui.selection = null);
            const upd = (fn) => store.commit('Editar zona', (d) => fn(d.zones.find((x) => x.id === z.id)));
            add(el.props,
                h('div', { class: 'kv-title' }, ZONE_KINDS[z.kind]?.label ?? 'Zona'),
                field('Tipo', sel(z.kind, Object.entries(ZONE_KINDS).map(([k, x]) => [k, x.label]), (v) => upd((x) => { x.kind = v; }))),
                field('Nombre', h('input', { type: 'text', maxlength: 40, value: z.name, placeholder: ZONE_KINDS[z.kind]?.label, onchange: (e) => upd((x) => { x.name = e.target.value.trim(); }) })),
                field('Ancho (cm)', num(z.w * G, 25, 90000, (v) => upd((x) => { x.w = Math.max(2, Math.round(v / G)); }), G)),
                field('Largo (cm)', num(z.h * G, 25, 90000, (v) => upd((x) => { x.h = Math.max(2, Math.round(v / G)); }), G)),
                h('dl', { class: 'dl' }, h('dt', {}, 'Superficie'), h('dd', {}, m2((z.w * G * z.h * G) / 10000))),
                h('div', { class: 'actions-row' }, delBtn),
                h('p', { class: 'muted small' }, 'No es parte de la casa ni entra al cómputo. Para moverla, arrastrala; para agrandarla o achicarla, arrastrá los puntos azules de sus lados.'),
            );
            return;
        }

        if (s?.type === 'tree') {
            const t = (store.project.trees ?? []).find((x) => x.id === s.id);
            if (!t) return void (store.ui.selection = null);
            add(el.props,
                h('div', { class: 'kv-title' }, 'Árbol'),
                field('Tamaño', sel(t.size, Object.entries(TREE_SIZES).map(([k, x]) => [k, x.label]), (v) => store.commit('Editar árbol', (d) => { d.trees.find((x) => x.id === t.id).size = v; }))),
                h('dl', { class: 'dl' }, h('dt', {}, 'Altura'), h('dd', {}, `${fmt(TREE_SIZES[t.size].h / 100)} m`), h('dt', {}, 'Copa'), h('dd', {}, `${fmt((TREE_SIZES[t.size].r * 2) / 100)} m de diámetro`)),
                h('div', { class: 'actions-row' }, delBtn),
                h('p', { class: 'muted small' }, 'No entra al cómputo. Para moverlo, arrastralo.'),
            );
            return;
        }

        if (s?.type === 'furniture') {
            const m = (lv.furniture ?? []).find((x) => x.id === s.id);
            const size = m && footprint(cfg, m);
            if (!size) return void (store.ui.selection = null);
            const upd = (fn) => modify('Editar mueble', (l) => fn(l.furniture.find((x) => x.id === m.id)));
            add(el.props,
                h('div', { class: 'kv-title' }, 'Mueble'),
                field('Mueble', h('select', { onchange: (e) => upd((x) => { x.kind = e.target.value; }) },
                    furnitureGroups(cfg).map(([group, items]) => h('optgroup', { label: group }, items.map(([id, def]) => h('option', { value: id, selected: id === m.kind }, def.name)))))),
                h('dl', { class: 'dl' }, h('dt', {}, 'Ocupa'), h('dd', {}, `${cm(size.w)} × ${cm(size.d)} cm`), h('dt', {}, 'Alto'), h('dd', {}, `${cm(size.def.h)} cm`)),
                h('div', { class: 'actions-row' },
                    h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => upd((x) => Object.assign(x, turnFurniture(cfg, x))) }, 'Girar 90°'),
                    delBtn),
                h('p', { class: 'muted small' }, 'Es un gabarito para ver si el ambiente alcanza: no entra al cómputo. Para moverlo, arrastralo.'),
            );
            return;
        }

        if (s?.type === 'column') {
            const c = (lv.columns ?? []).find((x) => x.id === s.id);
            if (!c) return void (store.ui.selection = null);
            const upd = (fn) => modify('Editar pilar', (l) => fn(l.columns.find((x) => x.id === c.id)));
            add(el.props,
                h('div', { class: 'kv-title' }, 'Pilar de hormigón armado'),
                field('Lado', sel(c.size, cfg.columnSizes.map((v) => [v, `${v} × ${v} cm`]), (v) => upd((x) => { x.size = Number(v); }))),
                h('dl', { class: 'dl' }, h('dt', {}, 'Altura'), h('dd', {}, `${fmt(cfg.levelHeight / 100)} m`)),
                h('div', { class: 'actions-row' }, delBtn),
                h('p', { class: 'muted small' }, 'Para moverlo, arrastralo.'),
            );
            return;
        }

        if (s?.type === 'label') {
            const lb = (lv.labels ?? []).find((x) => x.id === s.id);
            if (!lb) return void (store.ui.selection = null);
            add(el.props,
                h('div', { class: 'kv-title' }, 'Nombre de ambiente'),
                field('Tipo', sel(lb.type ?? '', roomTypeItems(cfg, (store.analysis?.levels?.[store.ui.level]?.rooms ?? []).find((r) => r.id === (store.analysis?.levels?.[store.ui.level]?.labels ?? []).find((x) => x.id === lb.id)?.room)?.type), (v) => modify('Tipo de ambiente', (l) => setLabelType(cfg, l.labels.find((x) => x.id === lb.id), v)))),
                field('Nombre', h('input', { type: 'text', list: 'room-names', maxlength: 40, value: lb.name, onchange: (e) => modify('Renombrar ambiente', (l) => { l.labels.find((x) => x.id === lb.id).name = e.target.value.trim(); }) })),
                roomNamesList(),
                h('div', { class: 'actions-row' }, delBtn),
                h('p', { class: 'muted small' }, 'Para moverlo, arrastralo.'),
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
                h('div', { class: 'actions-row' }, delBtn),
            );
            return;
        }

        if (s?.type === 'room') {
            const room = store.analysis?.levels?.[store.ui.level]?.rooms?.find((r) => r.id === s.id);
            if (!room) return void (store.ui.selection = null);
            add(el.props,
                h('div', { class: 'kv-title' }, h('span', { class: 'swatch', style: `background:${roomColor(room)}` }), room.name),
                (() => {
                    const named = (store.analysis?.levels?.[store.ui.level]?.labels ?? []).filter((x) => x.room === room.id);
                    const setName = (name) => store.commit('Nombrar ambiente', (d) => {
                        const l = d.levels[store.ui.level];
                        l.labels ??= [];
                        const cur = named[0] && l.labels.find((x) => x.id === named[0].id);
                        if (cur && name === '' && named.length === 1) l.labels = l.labels.filter((x) => x.id !== cur.id);
                        else if (cur) cur.name = name;
                        else if (name !== '') l.labels.push({ id: nextId(d, 'n'), ...roomAnchor(room), name });
                    });
                    // El tipo se elige acá o se deduce del nombre; con sólo elegirlo, el ambiente queda nombrado.
                    const setType = (type) => store.commit('Tipo de ambiente', (d) => {
                        const l = d.levels[store.ui.level];
                        l.labels ??= [];
                        const cur = named[0] && l.labels.find((x) => x.id === named[0].id);
                        if (cur) setLabelType(cfg, cur, type);
                        else if (type) l.labels.push({ id: nextId(d, 'n'), ...roomAnchor(room), name: nameForType(cfg, type, ''), type });
                    });
                    return h('div', {},
                        field('Tipo', sel(named[0]?.type ?? '', roomTypeItems(cfg, named[0]?.type ? null : room.type), setType)),
                        field('Nombre', h('input', { type: 'text', list: 'room-names', maxlength: 40, value: named[0]?.name ?? '', placeholder: 'Ej.: Dormitorio', onchange: (e) => setName(e.target.value.trim()) })),
                        roomNamesList(),
                        named.length > 1 ? h('p', { class: 'muted small' }, 'Este espacio tiene varios nombres: elegí cada uno en la planta.') : null);
                })(),
                h('dl', { class: 'dl' },
                    h('dt', {}, 'Superficie útil'), h('dd', {}, m2(room.netM2)),
                    h('dt', {}, 'Superficie a ejes'), h('dd', {}, m2(room.grossM2)),
                    h('dt', {}, 'Perímetro'), h('dd', {}, `${fmt(room.perimeterM, 2)} m`),
                    h('dt', {}, 'Medidas'), h('dd', {}, `${fmt((room.bbox.w * G) / 100, 2)} × ${fmt((room.bbox.h * G) / 100, 2)} m${room.rect ? '' : ' (en L / irregular)'}`)),
                // Medida exacta a ejes: corre el muro derecho (ancho) o el de abajo (fondo), como al arrastrar su manija.
                room.rect ? field('Ancho (m, a ejes)', num((room.bbox.w * G) / 100, 0.5, 100, (v) => app.setRoomSize(room.id, 'w', Math.round((v * 100) / G)), 0.125)) : null,
                room.rect ? field('Fondo (m, a ejes)', num((room.bbox.h * G) / 100, 0.5, 100, (v) => app.setRoomSize(room.id, 'h', Math.round((v * 100) / G)), 0.125)) : null,
                (() => {
                    const sug = roomSuggestions(room);
                    return sug.length
                        ? h('div', {}, h('div', { class: 'kv-title' }, 'Sugerencias'), h('div', { class: 'suggest-list' }, sug.map((x) => h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => app.moveWallBy(x.wall, x.delta) }, x.text))))
                        : null;
                })());
            return;
        }

        if (s?.type === 'roof') {
            const r = store.project.roofs.find((x) => x.id === s.id);
            if (!r) return void (store.ui.selection = null);
            const part = store.analysis?.roof?.parts?.find((p) => p.id === r.id);
            const upd = (fn) => store.commit('Editar techo', (d) => fn(d.roofs.find((x) => x.id === r.id)));
            const check = (label, key) => h('div', { class: 'proprow' }, h('label', {}, label, h('input', { type: 'checkbox', checked: r[key], onchange: (e) => upd((x) => { x[key] = e.target.checked; }) })));
            add(el.props,
                h('div', { class: 'kv-title' }, `${roofName(r.id)} · ${r.type === 'gable' ? 'a dos aguas' : 'a un agua'}`),
                store.project.upper ? field('Apoya sobre', sel(r.level, [[0, 'Nivel 1'], [1, 'Nivel 2']], (v) => upd((x) => { x.level = Number(v); }))) : null,
                field('Ancho (× 12,5 cm)', num(r.w, 2, 900, (v) => upd((x) => { x.w = v; }))),
                field('Profundidad (× 12,5 cm)', num(r.h, 2, 900, (v) => upd((x) => { x.h = v; }))),
                check('Hastial A (extremo inicial)', 'gableA'),
                check('Hastial B (extremo final)', 'gableB'),
                field('Espesor de hastiales', sel(r.gableT, [10, 15, 20].map((v) => [v, `${v} cm`]), (v) => upd((x) => { x.gableT = Number(v); }))),
                part ? h('dl', { class: 'dl' },
                    h('dt', {}, 'Cubierta'), h('dd', {}, m2(part.bom.coverM2)),
                    h('dt', {}, 'Altura sobre el muro'), h('dd', {}, `${fmt(part.geometry.riseCm / 100, 2)} m`),
                    h('dt', {}, 'Largo de cabio'), h('dd', {}, `${fmt(part.geometry.rafterLenCm / 100, 2)} m`),
                    h('dt', {}, 'Cabios'), h('dd', {}, `${int(part.bom.raftersCount)} de ${fmt(part.bom.raftersCommercialCm / 100, 2)} m`),
                    h('dt', {}, 'Bloques de hastiales'), h('dd', {}, int(part.geometry.gables.reduce((a, g) => a + g.blocks, 0)))) : null,
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
                h('div', { class: 'kv-title' }, side === 'H' ? 'Muro alto del techo' : `Hastial ${side} del ${roofName(rid).toLowerCase()}`),
                field('Espesor', sel(r.gableT, [10, 15, 20].map((v) => [v, `${v} cm`]), (v) => upd((x) => { x.gableT = Number(v); }))),
                h('dl', { class: 'dl' }, h('dt', {}, 'Superficie'), h('dd', {}, m2(gb.areaM2)), h('dt', {}, 'Hiladas'), h('dd', {}, int(gb.courses?.length ?? 0)), h('dt', {}, 'Piezas'), h('dd', {}, `${int(gb.fullBlocks)} enteras + ${int(gb.cutPieces)} cortadas`)),
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
                plan ? h('dl', { class: 'dl' }, h('dt', {}, 'Superficie'), h('dd', {}, m2(plan.areaM2)), h('dt', {}, 'Hormigón'), h('dd', {}, `${fmt((plan.areaM2 * sl.thickness) / 100, 2)} m³`)) : null,
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
                field('Sube hacia', sel(st.dir, ['N', 'E', 'S', 'W'].map((d) => [d, sideLabel(d, store.project.north)]), (v) => upd((x) => { x.dir = v; }))),
                st.shape !== 'straight' ? field('Gira a', sel(st.turn, [['right', 'la derecha'], ['left', 'la izquierda']], (v) => upd((x) => { x.turn = v; }))) : null,
                field('Ancho (× 12,5 cm)', num(st.w, 7, 16, (v) => upd((x) => { x.w = v; }))),
                field('Huella (cm)', num(st.tread, 25, 32, (v) => upd((x) => { x.tread = v; }))),
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
            h('div', { class: 'kv-title' }, 'Terreno'),
            h('div', { class: 'lot-row' },
                h('label', {}, 'Ancho (m)', num(store.project.lot.w, 6, 100, (v) => store.commit('Tamaño del terreno', (d) => { d.lot = { ...d.lot, w: v }; }))),
                h('label', {}, 'Fondo (m)', num(store.project.lot.d, 6, 100, (v) => store.commit('Tamaño del terreno', (d) => { d.lot = { ...d.lot, d: v }; })))),
            field('Frente (calle)', sel(store.project.lot.front ?? 'S', ['S', 'N', 'W', 'E'].map((d) => [d, sideLabel(d, store.project.north)]), (v) => store.commit('Frente del terreno', (d) => { d.lot = { ...d.lot, front: v }; }))),
            h('div', { class: 'check-row' },
                h('label', { class: 'field-inline' }, h('input', { type: 'checkbox', checked: store.ui.showLot !== false, onchange: (e) => store.setUi({ showLot: e.target.checked }) }), 'Mostrar terreno'),
                h('label', { class: 'field-inline' }, h('input', { type: 'checkbox', checked: store.ui.showGrid !== false, onchange: (e) => store.setUi({ showGrid: e.target.checked }) }), 'Mostrar cuadrícula')),
            // Muebles y árboles se pueden apagar: no se dibujan, no se eligen y su herramienta sale de la barra.
            h('div', { class: 'check-row' },
                h('label', { class: 'field-inline' }, h('input', { type: 'checkbox', id: 'opt-furniture', checked: store.ui.showFurniture !== false, onchange: (e) => store.setUi({ showFurniture: e.target.checked }) }), 'Muebles'),
                h('label', { class: 'field-inline' }, h('input', { type: 'checkbox', id: 'opt-trees', checked: store.ui.showTrees !== false, onchange: (e) => store.setUi({ showTrees: e.target.checked }) }), 'Árboles'),
                h('label', { class: 'field-inline', title: 'Oculta los faldones (la cubierta y los cabios) para ver los hastiales y la planta alta' }, h('input', { type: 'checkbox', id: 'opt-roof', checked: store.ui.showRoof !== false, onchange: (e) => store.setUi({ showRoof: e.target.checked }) }), 'Techos')),
            app.backdrop?.panel(),
            h('div', { class: 'kv-title' }, 'Norte'),
            northDial(),
            h('div', { class: 'kv-title' }, 'Sol y orientación'),
            el.solar,
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
                ? h('div', {}, h('div', { class: 'kv-title' }, 'Techos del proyecto'), roofs.map((r) => h('div', { class: 'roof-row' },
                    h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => store.setUi({ selection: { type: 'roof', id: r.id } }) }, `${roofName(r.id)} · ${r.type === 'gable' ? '2 aguas' : '1 agua'} · ${fmt((r.w * G) / 100, 1)}×${fmt((r.h * G) / 100, 1)} m · Nivel ${r.level + 1}`),
                    h('button', { class: 'btn btn-danger btn-sm', type: 'button', title: `Quitar el ${roofName(r.id).toLowerCase()}`, 'aria-label': `Quitar el ${roofName(r.id).toLowerCase()}`, onclick: () => store.commit('Quitar techo', (d) => { d.roofs = d.roofs.filter((x) => x.id !== r.id); }) }, '✕'))),
                    roofs.length > 1 ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => store.commit('Quitar todos los techos', (d) => { d.roofs = []; }) }, 'Quitar todos') : null)
                : h('p', { class: 'empty-note' }, 'Sin techos.'));
    }

    // ------------------------------------------------------------------ validación
    let showAllIssues = false;
    let lastCtxKey = '';
    /** Revisión: primero lo que corresponde a lo que el usuario está haciendo; el resto queda a un clic. */
    function renderIssues() {
        clear(el.issues);
        const ctx = contextOf(store);
        const ctxKey = `${ctx.kind}:${ctx.id ?? ''}`;
        if (ctxKey !== lastCtxKey) showAllIssues = false;
        lastCtxKey = ctxKey;
        setTitle('#card-issues > summary', 'Revisión', ctx);
        const every = store.analysis?.issues ?? [];
        const issues = showAllIssues || ctx.kind === 'general' ? every : every.filter((i) => issueMatches(i, ctx, store));
        const hidden = every.filter((i) => i.severity !== 'info').length - issues.filter((i) => i.severity !== 'info').length;
        const more = () => (hidden > 0 ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => { showAllIssues = true; renderIssues(); } }, `Ver ${hidden} más del proyecto`) : null);
        const errors = issues.filter((i) => i.severity === 'error').length;
        el.badge.textContent = String(issues.filter((i) => i.severity !== 'info').length);
        el.badge.classList.toggle('has-error', errors > 0);
        if (!issues.length) {
            add(el.issues, h('p', { class: 'empty-note' }, store.analysis ? 'Nada para corregir.' : 'Calculando…'), more());
            return;
        }
        const ico = { error: '✕', warn: '!', info: 'i' };
        const item = (i) => h('button', { type: 'button', class: `issue ${i.severity}`, title: 'Ir al elemento', onclick: () => app.focusIssue(i) }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico[i.severity]), h('span', {}, `${i.level === 1 ? '[Nivel 2] ' : i.level === 2 ? '[Techo] ' : ''}${i.message}`));
        // Primero lo que hay que corregir; las notas informativas quedan plegadas para no distraer.
        const main = issues.filter((i) => i.severity !== 'info');
        const notes = issues.filter((i) => i.severity === 'info');
        if (!main.length) add(el.issues, h('p', { class: 'empty-note' }, 'Nada para corregir.'));
        for (const i of main) add(el.issues, item(i));
        if (notes.length) add(el.issues, h('details', { class: 'more' }, h('summary', {}, `${notes.length} nota${notes.length > 1 ? 's' : ''} técnica${notes.length > 1 ? 's' : ''}`), notes.map(item)));
        add(el.issues, more());
    }

    // ------------------------------------------------------------------ asoleamiento (se construye una sola vez)
    const solarUi = {};
    function buildSolar() {
        const sol = store.ui.solar;
        solarUi.season = sel(sol.season, SEASONS, (v) => { store.setUi({ solar: { season: v } }); store.ensureSolar(); });
        const place = (patch) => { store.patchProject(patch); store.ensureSolar(); syncSolar(); };
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
        solarUi.lat = h('input', { type: 'number', min: -66, max: 66, step: 0.1, value: store.project.lat, class: 'w-narrow', 'aria-label': 'Latitud', onchange: (e) => place({ lat: clamp(e.target.value, -66, 66) }) });
        solarUi.lon = h('input', { type: 'number', min: -180, max: 180, step: 0.1, value: store.project.lon ?? -58.4, class: 'w-narrow', 'aria-label': 'Longitud', onchange: (e) => place({ lon: clamp(e.target.value, -180, 180) }) });
        solarUi.tz = h('input', { type: 'number', min: -12, max: 14, step: 0.5, value: store.project.tz ?? -3, class: 'w-narrow', 'aria-label': 'Huso horario (UTC)', onchange: (e) => place({ tz: clamp(e.target.value, -12, 14) }) });
        solarUi.city = sel('', [['', 'Ciudad…'], ...CITIES.map(([n], i) => [i, n])], (v) => { if (v === '') return; const [, lat, lon, tz] = CITIES[Number(v)]; place({ lat, lon, tz }); });
        solarUi.hour = h('input', { type: 'range', min: 5, max: 21, step: 0.25, value: sol.hour, 'aria-label': 'Hora oficial', oninput: (e) => { store.setUi({ solar: { hour: Number(e.target.value) } }); syncSolar(); } });
        solarUi.out = h('output', {});
        solarUi.play = h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: togglePlay }, '▶');
        solarUi.show = h('input', { type: 'checkbox', checked: sol.show, onchange: (e) => { store.setUi({ solar: { show: e.target.checked } }); } });
        solarUi.info = h('p', { class: 'small muted' });
        add(el.solar,
            h('div', { class: 'solar-row' }, h('label', { class: 'field-inline' }, 'Época', solarUi.season)),
            h('div', { class: 'solar-row' }, solarUi.city),
            h('div', { class: 'solar-row' }, h('label', { class: 'field-inline' }, 'Lat.', solarUi.lat), h('label', { class: 'field-inline' }, 'Long.', solarUi.lon), h('label', { class: 'field-inline' }, 'UTC', solarUi.tz)),
            h('div', { class: 'solar-row' }, solarUi.play, solarUi.hour, solarUi.out),
            h('div', { class: 'solar-row' }, h('label', { class: 'field-inline' }, solarUi.show, 'Mostrar sombras y sol')),
            solarUi.info,
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
            if (hr > 21) hr = 5;
            store.setUi({ solar: { hour: hr } });
            solarUi.hour.value = hr;
            syncSolar();
        }, 60);
    }

    function syncSolar() {
        const sol = store.ui.solar;
        const hh = Math.floor(sol.hour);
        const mm = String(Math.round((sol.hour - hh) * 60)).padStart(2, '0');
        solarUi.out.textContent = `${String(hh).padStart(2, '0')}:${mm}`;
        solarUi.lat.value = store.project.lat;
        solarUi.lon.value = store.project.lon ?? -58.4;
        solarUi.tz.value = store.project.tz ?? -3;
        const s = store.sun();
        const hm = (x) => `${Math.floor(x)}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`;
        const where = (az) => ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'][Math.round(az / 45) % 8];
        solarUi.info.textContent = !s ? 'Cargando trayectoria solar…'
            : s.alt <= 0 ? `${sol.label ?? ''} · el sol está bajo el horizonte a esa hora.`
                : `${sol.label ?? ''} · sol al ${where(s.az)} (acimut ${fmt(s.az, 0)}°), a ${fmt(s.alt, 1)}° de altura. Hora oficial; el mediodía solar es a las ${hm(sol.noon ?? 12)}.`;
    }
    app.syncSolar = syncSolar;

    /** Sugerencias de ventanas según el sol (se muestran en el Resumen de ventanas). */
    async function runSuggest(box) {
        if (!box) return;
        clear(box);
        add(box, h('p', { class: 'empty-note' }, 'Calculando…'));
        try {
            const { suggestions } = await suggest(store.project);
            renderSuggestions(box, suggestions);
        } catch (e) {
            clear(box);
            add(box, h('p', { class: 'empty-note' }, `No se pudo calcular: ${e.message}`));
        }
    }

    function renderSuggestions(box, list) {
        clear(box);
        if (!list.length) {
            add(box, h('p', { class: 'empty-note' }, 'Sin sugerencias: primero cerrá habitaciones con muros exteriores.'));
            return;
        }
        const applicable = list.filter((x) => x.apply);
        const checks = new Map();
        const typeLabel = { solar: 'Sol de invierno', cross: 'Ventilación cruzada', shade: 'Protección solar', info: 'Aviso' };
        for (const x of list) {
            const cb = x.apply ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'Aplicar sugerencia' }) : null;
            if (cb) checks.set(x.id, cb);
            add(box, h('label', { class: 'suggest-item', style: 'flex-direction:row;font-weight:500' }, cb, h('span', {}, h('span', { class: 'tag' }, `${x.level === 1 ? 'Nivel 2 · ' : ''}${typeLabel[x.type] ?? x.type}`), x.reason, x.apply ? ` (${cm(x.w * G)} cm)` : '')));
        }
        if (applicable.length) {
            add(box, h('div', { class: 'actions-row' },
                h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => applySuggestions(applicable.filter((x) => checks.get(x.id)?.checked)) }, 'Aplicar seleccionadas')));
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
        app.toast(`${items.length} ventana(s) agregada(s). Ctrl+Z deshace.`);
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
        /** Pide sugerencias de ventanas en el Resumen (contexto Ventanas). */
        openSuggest() {
            renderTelemetry();
            runSuggest(el.sugBox);
        },
        /** Resumen y Revisión según la herramienta o el elemento elegido. */
        renderContext() {
            renderTelemetry();
            renderIssues();
        },
        openIssues() {
            const card = document.getElementById('card-issues');
            card.open = true;
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
    };
}
