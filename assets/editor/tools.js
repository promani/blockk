/**
 * Herramientas del editor. Cada una implementa (opcionalmente): move / down / up / key / draw / options / reset.
 * Las herramientas sólo arman intenciones (agregar un muro, un vano…); el servidor normaliza, valida y calcula.
 */
import { h } from '../lib/dom.js';
import { fmt } from '../lib/format.js';
import { pickAt, pickWall, alongPosition, G } from './pick.js';
import { outlineRect, ghostBox, label, nodeMarker } from './overlay.js';
import { nextId } from '../lib/storage.js';
import { ICONS } from './icons.js';

const DRAG_PX = 6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wallLen = (w) => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);

export function createTools(app) {
    const { store } = app;
    const cfg = store.config;
    const base = () => store.ui.level * cfg.levelHeight;
    const lot = () => ({ w: store.project.lot.w * 8, d: store.project.lot.d * 8 });
    const inLot = (gx, gy) => gx >= 0 && gy >= 0 && gx <= lot().w && gy <= lot().d;

    const selectT = (label_, value, items, onChange) =>
        h('label', { class: 'field-inline' }, label_,
            h('select', { onchange: (e) => onChange(e.target.value) }, items.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text))));

    const thicknessOption = () =>
        selectT('Espesor', store.ui.thickness, cfg.thicknesses.map((t) => [t, `${fmt(t, t % 1 ? 1 : 0)} cm ${t >= cfg.loadBearingMin ? '· portante' : '· tabique'}`]), (v) => {
            store.setUi({ thickness: Number(v) });
        });

    const newWall = (draft, x1, y1, x2, y2, t) => {
        draft.levels[store.ui.level].walls.push({ id: nextId(draft, 'w'), x1, y1, x2, y2, t });
    };

    /** Fuerza el segmento a ortogonal (eje dominante) y limita al lote. */
    const ortho = (a, p) => {
        const dx = p.gx - a.gx;
        const dy = p.gy - a.gy;
        return Math.abs(dx) >= Math.abs(dy) ? { gx: p.gx, gy: a.gy } : { gx: a.gx, gy: p.gy };
    };

    const dimLabel = (ctx, cam, x0, y0, x1, y1, z, text) => {
        const [sx, sy] = cam.project((x0 + x1) / 2, (y0 + y1) / 2, z);
        label(ctx, text, sx, sy - 16);
    };

    const T = {};

    // ---------------- seleccionar ----------------
    T.select = {
        hotkey: 'v',
        label: 'Seleccionar',
        hint: 'Clic en un muro, vano o entrepiso para ver sus propiedades. Supr elimina lo seleccionado.',
        move(p) {
            const hit = pickAt(app, p.sx, p.sy);
            if (JSON.stringify(hit) !== JSON.stringify(app.hover)) {
                app.hover = hit;
                app.render();
            }
        },
        down(p) {
            app.hover = pickAt(app, p.sx, p.sy);
            store.setUi({ selection: app.hover });
        },
    };

    // ---------------- sala ----------------
    let room = null;
    T.room = {
        hotkey: 'r',
        label: 'Crear sala',
        hint: 'Arrastrá en diagonal: se crean las 4 paredes ortogonales con medidas múltiplo del módulo de 62,5 cm.',
        options: () => h('span', { class: 'row' }, thicknessOption()),
        reset() { room = null; },
        down(p) {
            room = { a: { gx: p.gx, gy: p.gy }, rect: null };
        },
        move(p) {
            if (!room) return;
            const dx = p.gx - room.a.gx;
            const dy = p.gy - room.a.gy;
            const sx = dx < 0 ? -1 : 1;
            const sy = dy < 0 ? -1 : 1;
            const w = Math.max(10, Math.round(Math.abs(dx) / 5) * 5);
            const hh = Math.max(10, Math.round(Math.abs(dy) / 5) * 5);
            const x = sx > 0 ? room.a.gx : room.a.gx - w;
            const y = sy > 0 ? room.a.gy : room.a.gy - hh;
            const moved = Math.abs(dx) + Math.abs(dy) >= 3;
            room.rect = moved && inLot(x, y) && inLot(x + w, y + hh) ? { x, y, w, h: hh } : null;
            room.moved = moved;
            app.render();
        },
        up() {
            const r = room?.rect;
            room = null;
            if (!r) return;
            store.commit('Crear sala', (d) => {
                const t = store.ui.thickness;
                newWall(d, r.x, r.y, r.x + r.w, r.y, t);
                newWall(d, r.x + r.w, r.y, r.x + r.w, r.y + r.h, t);
                newWall(d, r.x + r.w, r.y + r.h, r.x, r.y + r.h, t);
                newWall(d, r.x, r.y + r.h, r.x, r.y, t);
            });
        },
        keyDown(e) {
            if (e.key === 'Escape' && room) {
                room = null;
                app.render();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            const z = base();
            if (room?.rect) {
                const { x, y, w, h: hh } = room.rect;
                outlineRect(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, { stroke: '#3f6212', fill: 'rgba(139,197,63,.28)', width: 2.5 });
                const area = ((w * G) / 100) * ((hh * G) / 100);
                dimLabel(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, `${fmt((w * G) / 100)} × ${fmt((hh * G) / 100)} m · ${w / 5} × ${hh / 5} módulos · ${fmt(area)} m²`);
            } else if (app.pointer && inLot(app.pointer.gx, app.pointer.gy)) {
                nodeMarker(ctx, cam, app.pointer.gx * G, app.pointer.gy * G, z);
            }
        },
    };

    // ---------------- muro / bloque (comparten el gesto) ----------------
    const segmentTool = (opts) => {
        let start = null;
        let end = null;
        let pressed = false;
        let dragged = false;
        let downAt = null;
        let axis = 'x';

        const compute = (p) => {
            if (!start) return null;
            const e = ortho(start, p);
            if (opts.module) {
                const len = Math.max(0, Math.abs(e.gx - start.gx) + Math.abs(e.gy - start.gy));
                const sign = Math.sign(e.gx - start.gx + (e.gy - start.gy)) || 1;
                const q = Math.max(5, Math.round(len / 5) * 5) * sign;
                return e.gy === start.gy ? { gx: start.gx + q, gy: start.gy } : { gx: start.gx, gy: start.gy + q };
            }
            return e;
        };
        const commitSeg = (a, b) => {
            if (!b || (a.gx === b.gx && a.gy === b.gy)) return false;
            if (!inLot(a.gx, a.gy) || !inLot(b.gx, b.gy)) {
                app.toast('El muro debe quedar dentro del lote.', 'error');
                return false;
            }
            if (Math.abs(b.gx - a.gx) + Math.abs(b.gy - a.gy) < 2) {
                app.toast('Muro demasiado corto (mínimo 25 cm).', 'error');
                return false;
            }
            store.commit(opts.commitLabel, (d) => newWall(d, a.gx, a.gy, b.gx, b.gy, store.ui.thickness));
            return true;
        };
        return {
            hotkey: opts.key,
            label: opts.label,
            hint: opts.hint,
            options: () => h('span', { class: 'row' }, thicknessOption(), opts.module ? h('button', { class: 'btn btn-outline btn-sm', onclick: () => { axis = axis === 'x' ? 'y' : 'x'; app.refreshOptions(); } }, `Orientación: ${axis === 'x' ? '↔ horizontal' : '↕ vertical'} (X)`) : null),
            reset() { start = null; end = null; pressed = false; },
            down(p, e) {
                if (start && !pressed) {
                    const b = compute(p);
                    if (commitSeg(start, b)) start = { ...b };
                    if (e.detail >= 2) start = null; // doble clic corta la cadena
                    app.render();
                    return;
                }
                start = { gx: p.gx, gy: p.gy };
                end = null;
                pressed = true;
                dragged = false;
                downAt = { x: p.sx, y: p.sy };
            },
            move(p) {
                if (!start) return;
                if (pressed && Math.hypot(p.sx - downAt.x, p.sy - downAt.y) > DRAG_PX) dragged = true;
                end = compute(p);
                app.render();
            },
            up(p) {
                if (!pressed) return;
                pressed = false;
                if (opts.module && !dragged) {
                    // clic simple: un bloque en la orientación elegida
                    const a = start;
                    const b = axis === 'x' ? { gx: a.gx + 5, gy: a.gy } : { gx: a.gx, gy: a.gy + 5 };
                    commitSeg(a, b);
                    start = null;
                    end = null;
                    return;
                }
                if (dragged) {
                    commitSeg(start, compute(p));
                    start = null;
                    end = null;
                }
            },
            keyDown(e) {
                if (e.key === 'Escape' && start) {
                    start = null;
                    end = null;
                    pressed = false;
                    app.render();
                    return true;
                }
                if (opts.module && (e.key === 'x' || e.key === 'X')) {
                    axis = axis === 'x' ? 'y' : 'x';
                    app.refreshOptions();
                    return true;
                }
                return false;
            },
            contextmenu() {
                start = null;
                end = null;
                pressed = false;
                app.render();
            },
            draw(ctx, cam) {
                const z = base();
                const t = store.ui.thickness;
                if (start && end) {
                    const x0 = Math.min(start.gx, end.gx) * G;
                    const x1 = Math.max(start.gx, end.gx) * G;
                    const y0 = Math.min(start.gy, end.gy) * G;
                    const y1 = Math.max(start.gy, end.gy) * G;
                    const horizontal = start.gy === end.gy;
                    const box = { x0: horizontal ? x0 : x0 - t / 2, x1: horizontal ? x1 : x1 + t / 2, y0: horizontal ? y0 - t / 2 : y0, y1: horizontal ? y1 + t / 2 : y1, z0: z, z1: z + cfg.levelHeight };
                    ghostBox(ctx, cam, box, { fill: 'rgba(139,197,63,.35)', stroke: '#3f6212' });
                    const len = Math.abs(end.gx - start.gx) + Math.abs(end.gy - start.gy);
                    const modular = len % 5 === 0;
                    dimLabel(ctx, cam, x0, y0, x1, y1, z + cfg.levelHeight, `${fmt((len * G) / 100)} m · ${fmt((len * G) / 62.5, 1)} bloques${modular ? '' : ' · no modular (+cortes)'}`);
                } else if (opts.module && app.pointer && !start) {
                    const a = { gx: app.pointer.gx, gy: app.pointer.gy };
                    const b = axis === 'x' ? { gx: a.gx + 5, gy: a.gy } : { gx: a.gx, gy: a.gy + 5 };
                    const horizontal = axis === 'x';
                    ghostBox(ctx, cam, { x0: a.gx * G - (horizontal ? 0 : t / 2), x1: b.gx * G + (horizontal ? 0 : t / 2), y0: a.gy * G - (horizontal ? t / 2 : 0), y1: b.gy * G + (horizontal ? t / 2 : 0), z0: z, z1: z + 25 }, { fill: 'rgba(139,197,63,.4)' });
                } else if (app.pointer && inLot(app.pointer.gx, app.pointer.gy)) {
                    nodeMarker(ctx, cam, app.pointer.gx * G, app.pointer.gy * G, z);
                }
                if (start) nodeMarker(ctx, cam, start.gx * G, start.gy * G, z, '#3f6212');
            },
        };
    };
    T.wall = segmentTool({ key: 'w', label: 'Muro a 90°', hint: 'Clic y arrastre (o clic-clic): muros ortogonales. Doble clic, Esc o clic derecho terminan la cadena.', commitLabel: 'Agregar muro' });
    T.block = segmentTool({ key: 'b', label: 'Bloque individual', hint: 'Clic: un bloque de 62,5 cm. Arrastre: hilera de bloques enteros (múltiplos de 62,5 cm). X gira la orientación.', module: true, commitLabel: 'Agregar bloques' });

    // ---------------- puertas y ventanas ----------------
    const openingTool = (kind) => {
        let preset = kind === 'door' ? 'P87' : 'V125';
        let ghost = null;
        const spec = () => cfg.presets[preset];
        const compute = (p) => {
            const wall = pickWall(app, p.sx, p.sy);
            if (!wall) return null;
            const info = store.analysis?.levels?.[store.ui.level]?.walls?.[wall.id];
            if (!info) return null;
            const s = spec();
            const desired = Math.round(alongPosition(app, wall, p.sx, p.sy) - s.w / 2);
            let best = null;
            for (const [from, to] of info.slots) {
                if (to - from < s.w) continue;
                const pos = clamp(desired, from, to - s.w);
                const dist = Math.abs(pos - desired);
                if (!best || dist < best.dist) best = { pos, dist };
            }
            return best
                ? { wall, pos: best.pos, ok: true, w: s.w }
                : { wall, pos: clamp(desired, 0, Math.max(0, wallLen(wall) - s.w)), ok: false, w: s.w, reason: `No hay lugar libre de ${fmt(s.w * G, 1)} cm en este muro (jambas ≥ 25 cm respecto de esquinas, muros y otros vanos).` };
        };
        return {
            hotkey: kind === 'door' ? 'p' : 'n',
            label: kind === 'door' ? 'Puerta' : 'Ventana',
            hint: 'Apuntá a un muro: el fantasma verde indica un lugar válido (jambas ≥ 25 cm). Clic para colocar.',
            options: () => h('span', { class: 'row' }, selectT('Tipo', preset, Object.entries(cfg.presets).filter(([, s]) => s.kind === kind).map(([k, s]) => [k, s.label]), (v) => { preset = v; app.render(); })),
            reset() { ghost = null; },
            move(p) {
                ghost = compute(p);
                app.render();
            },
            down(p) {
                ghost = compute(p);
                if (!ghost) return;
                if (!ghost.ok) {
                    app.toast(ghost.reason, 'error');
                    return;
                }
                const s = spec();
                const g = ghost;
                store.commit(kind === 'door' ? 'Agregar puerta' : 'Agregar ventana', (d) => {
                    d.levels[store.ui.level].openings.push({ id: nextId(d, 'o'), wall: g.wall.id, pos: g.pos, w: s.w, sill: s.sill, h: s.h, kind: s.kind, preset, flip: false });
                });
            },
            draw(ctx, cam) {
                if (!ghost) return;
                const s = spec();
                const box = openingBox(ghost.wall, ghost.pos, s.w, s.sill, s.h, base());
                ghostBox(ctx, cam, box, ghost.ok ? { fill: 'rgba(139,197,63,.5)', stroke: '#3f6212' } : { fill: 'rgba(180,35,24,.35)', stroke: '#b42318' });
            },
        };
    };
    T.door = openingTool('door');
    T.window = openingTool('window');

    // ---------------- viga U ----------------
    let uCourse = 5;
    let uModules = 1;
    let uGhost = null;
    T.ubeam = {
        hotkey: 'u',
        label: 'Viga U (encadenado)',
        hint: 'Coloca bloques U rellenos con hormigón en una hilada (encadenado intermedio, refuerzo). Los dinteles y la corona se generan solos.',
        options: () => h('span', { class: 'row' },
            selectT('Hilada', uCourse, Array.from({ length: cfg.crownCourse }, (_, i) => [i, `${i + 1} (${fmt(((i + 1) * cfg.blockH) / 100)} m)`]), (v) => { uCourse = Number(v); app.render(); }),
            selectT('Largo', uModules, [1, 2, 3, 4, 6, 8].map((m) => [m, `${m} bloque${m > 1 ? 's' : ''} (${fmt(m * 0.625)} m)`]), (v) => { uModules = Number(v); app.render(); })),
        reset() { uGhost = null; },
        move(p) {
            const wall = pickWall(app, p.sx, p.sy);
            if (!wall) {
                uGhost = null;
            } else {
                const len = uModules * 5;
                const maxPos = wallLen(wall) - len;
                uGhost = maxPos < 0 ? { wall, ok: false, pos: 0, len } : { wall, ok: true, len, pos: clamp(Math.round(alongPosition(app, wall, p.sx, p.sy) - len / 2), 0, maxPos) };
            }
            app.render();
        },
        down() {
            if (!uGhost) return;
            if (!uGhost.ok) {
                app.toast('El muro es más corto que la viga elegida.', 'error');
                return;
            }
            const g = uGhost;
            store.commit('Agregar viga U', (d) => {
                d.levels[store.ui.level].ubeams.push({ id: nextId(d, 'u'), wall: g.wall.id, pos: g.pos, len: g.len, course: uCourse });
            });
        },
        draw(ctx, cam) {
            if (!uGhost) return;
            const box = openingBox(uGhost.wall, uGhost.pos, uGhost.len, uCourse, 1, base());
            ghostBox(ctx, cam, box, uGhost.ok ? { fill: 'rgba(159,209,92,.65)', stroke: '#3f6212' } : { fill: 'rgba(180,35,24,.35)', stroke: '#b42318' });
        },
    };

    // ---------------- entrepiso de madera ----------------
    let floorSection = '3x8';
    let floorSpacing = 40;
    let floor = null;
    const groundOnly = () => (store.ui.level === 0 ? null : 'El entrepiso se dibuja sobre la Planta Baja: pasá a "Nivel 1".');
    const floorRect = (a, p) => {
        const x = Math.min(a.gx, p.gx);
        const y = Math.min(a.gy, p.gy);
        return { x, y, w: Math.abs(p.gx - a.gx), h: Math.abs(p.gy - a.gy) };
    };
    T.floor = {
        hotkey: 'e',
        label: 'Entrepiso de madera',
        hint: 'Clic dentro de un ambiente rectangular, o arrastre un rectángulo a ejes de muros. Los tirantes cruzan la luz menor.',
        disabled: groundOnly,
        planeZ: () => cfg.levelHeight,
        options: () => h('span', { class: 'row' },
            selectT('Sección', floorSection, Object.entries(cfg.timberSections).map(([k, s]) => [k, s.label]), (v) => { floorSection = v; }),
            selectT('Separación', floorSpacing, [30, 40, 50, 60].map((v) => [v, `${v} cm`]), (v) => { floorSpacing = Number(v); })),
        reset() { floor = null; },
        down(p) {
            floor = { a: { gx: p.gx, gy: p.gy }, rect: null, dragged: false, at: { x: p.sx, y: p.sy } };
        },
        move(p) {
            if (!floor) return;
            if (Math.hypot(p.sx - floor.at.x, p.sy - floor.at.y) > DRAG_PX) floor.dragged = true;
            floor.rect = floor.dragged ? floorRect(floor.a, p) : null;
            app.render();
        },
        up(p) {
            if (!floor) return;
            let r = floor.rect;
            const a = floor.a;
            floor = null;
            if (!r) {
                const rooms = store.analysis?.levels?.[0]?.rooms ?? [];
                const room = rooms.find((rm) => rm.rect && a.gx >= rm.bbox.x && a.gx < rm.bbox.x + rm.bbox.w && a.gy >= rm.bbox.y && a.gy < rm.bbox.y + rm.bbox.h);
                if (!room) {
                    app.toast('Clic dentro de un ambiente rectangular cerrado, o arrastre un rectángulo.', 'error');
                    return;
                }
                r = { x: room.bbox.x, y: room.bbox.y, w: room.bbox.w, h: room.bbox.h };
            }
            if (r.w < 4 || r.h < 4) {
                app.toast('El entrepiso debe medir al menos 50 × 50 cm.', 'error');
                return;
            }
            const dir = r.w <= r.h ? 'x' : 'y';
            store.commit('Agregar entrepiso', (d) => {
                d.levels[0].timber.push({ id: nextId(d, 't'), kind: 'joists', x: r.x, y: r.y, w: r.w, h: r.h, dir, section: floorSection, spacing: floorSpacing });
            });
        },
        keyDown(e) {
            if (e.key === 'Escape' && floor) {
                floor = null;
                app.render();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            const z = cfg.levelHeight;
            if (floor?.rect) {
                const { x, y, w, h: hh } = floor.rect;
                outlineRect(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, { stroke: '#8a5a1f', fill: 'rgba(217,160,91,.35)', width: 2.5, dash: [6, 4] });
                const span = Math.min(w, hh) * G;
                dimLabel(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, `luz ${fmt(span / 100)} m · tirantes en ${w <= hh ? 'X' : 'Y'}`);
            } else if (app.pointer && inLot(app.pointer.gx, app.pointer.gy)) {
                nodeMarker(ctx, cam, app.pointer.gx * G, app.pointer.gy * G, z, '#8a5a1f');
            }
        },
    };

    // ---------------- viga de madera ----------------
    let beamSection = '3x10';
    let beamA = null;
    let beamEnd = null;
    T.beam = {
        hotkey: 't',
        label: 'Viga de madera',
        hint: 'Clic en dos nodos alineados: viga apoyada sobre muros portantes (lleva placa de reparto).',
        disabled: groundOnly,
        planeZ: () => cfg.levelHeight,
        options: () => h('span', { class: 'row' }, selectT('Sección', beamSection, Object.entries(cfg.timberSections).map(([k, s]) => [k, s.label]), (v) => { beamSection = v; })),
        reset() { beamA = null; beamEnd = null; },
        move(p) {
            beamEnd = beamA ? ortho(beamA, p) : null;
            app.render();
        },
        down(p) {
            if (!beamA) {
                beamA = { gx: p.gx, gy: p.gy };
                return;
            }
            const b = ortho(beamA, p);
            const a = beamA;
            beamA = null;
            beamEnd = null;
            if (a.gx === b.gx && a.gy === b.gy) return;
            store.commit('Agregar viga de madera', (d) => {
                d.levels[0].timber.push({ id: nextId(d, 't'), kind: 'beam', x1: a.gx, y1: a.gy, x2: b.gx, y2: b.gy, section: beamSection });
            });
        },
        keyDown(e) {
            if (e.key === 'Escape' && beamA) {
                beamA = null;
                beamEnd = null;
                app.render();
                return true;
            }
            return false;
        },
        contextmenu() { beamA = null; beamEnd = null; app.render(); },
        draw(ctx, cam) {
            const z = cfg.levelHeight;
            if (beamA && beamEnd) {
                const s = cfg.timberSections[beamSection];
                const x0 = Math.min(beamA.gx, beamEnd.gx) * G;
                const x1 = Math.max(beamA.gx, beamEnd.gx) * G;
                const y0 = Math.min(beamA.gy, beamEnd.gy) * G;
                const y1 = Math.max(beamA.gy, beamEnd.gy) * G;
                const horizontal = beamA.gy === beamEnd.gy;
                ghostBox(ctx, cam, { x0: horizontal ? x0 : x0 - s.b / 2, x1: horizontal ? x1 : x1 + s.b / 2, y0: horizontal ? y0 - s.b / 2 : y0, y1: horizontal ? y1 + s.b / 2 : y1, z0: z, z1: z + s.d }, { fill: 'rgba(196,138,69,.6)', stroke: '#8a5a1f' });
            } else if (app.pointer && inLot(app.pointer.gx, app.pointer.gy)) {
                nodeMarker(ctx, cam, app.pointer.gx * G, app.pointer.gy * G, z, '#8a5a1f');
            }
            if (beamA) nodeMarker(ctx, cam, beamA.gx * G, beamA.gy * G, z, '#8a5a1f');
        },
    };

    // metadatos para la barra de herramientas
    for (const [id, t] of Object.entries(T)) {
        t.id = id;
        t.icon = ICONS[id === 'ubeam' ? 'ubeam' : id];
    }

    return T;
}

/** Caja de mundo de un vano (o viga U) sobre un muro; la hilada `sill` y `h` hiladas de alto. */
export function openingBox(wall, pos, w, sill, h, zBase) {
    const horizontal = wall.y1 === wall.y2;
    const from = (horizontal ? wall.x1 : wall.y1) * G + pos * G;
    const line = (horizontal ? wall.y1 : wall.x1) * G;
    const t = wall.t / 2 + 0.6;
    return {
        x0: horizontal ? from : line - t,
        x1: horizontal ? from + w * G : line + t,
        y0: horizontal ? line - t : from,
        y1: horizontal ? line + t : from + w * G,
        z0: zBase + sill * 25,
        z1: zBase + (sill + h) * 25,
    };
}

