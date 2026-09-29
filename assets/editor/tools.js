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
import { moveWallLine, collinearChain, mirrorMove } from './wallmove.js';
import { wallLines, nearestLine } from './snap.js';

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

    // ---------------- mover un muro (agrandar / achicar la habitación) ----------------
    const wallMoveCommit = (wallId, newLine) => {
        const li = store.ui.level;
        const probe = structuredClone(store.level());
        const wall = probe.walls.find((w) => w.id === wallId);
        if (!wall) return false;
        const maxLine = wall.y1 === wall.y2 ? lot().d : lot().w;
        const test = moveWallLine(probe, wallId, newLine, { maxLine });
        if (!test.ok) {
            app.toast(test.reason, 'error');
            return false;
        }
        const before = structuredClone(wall);
        store.commit('Mover muro', (d) => {
            moveWallLine(d.levels[li], wallId, newLine, { maxLine });
            // Un muro de Planta Baja arrastra al muro que tiene encima (misma recta) para que sigan alineados.
            if (li === 0 && d.upper) mirrorMove(d.levels[1], before, newLine, { maxLine });
        });
        if (test.dropped) app.toast(`${test.dropped} vano(s) o viga(s) quedaron fuera del muro estirado y se quitaron.`);
        return true;
    };
    /** Desplaza el muro `delta` unidades (12,5 cm) en sentido perpendicular: + hacia el sur / este. */
    app.moveWallBy = (wallId, delta) => {
        const w = store.level().walls.find((x) => x.id === wallId);
        if (!w) return;
        wallMoveCommit(wallId, (w.y1 === w.y2 ? w.y1 : w.x1) + delta);
    };

    // ---------------- seleccionar ----------------
    let drag = null;
    const handleAt = (cam) => {
        const sel = store.ui.selection;
        if (sel?.type !== 'wall' || store.ui.level > 1) return null;
        const w = store.level().walls.find((x) => x.id === sel.id);
        if (!w) return null;
        const [sx, sy] = cam.project(((w.x1 + w.x2) / 2) * G, ((w.y1 + w.y2) / 2) * G, base() + cfg.levelHeight);
        return { w, sx, sy };
    };
    const dragLine = (p) => {
        const horizontal = drag.w.y1 === drag.w.y2;
        const step = Math.max(1, store.ui.snap);
        const d = Math.round(((horizontal ? p.wy - drag.y0 : p.wx - drag.x0) / G) / step) * step;
        let line = drag.line0 + d;
        const lines = wallLines(store);
        const near = nearestLine(horizontal ? lines.ys : lines.xs, line, 1);
        if (near !== null && near !== drag.line0) line = near;
        const lim = horizontal ? lot().d : lot().w;
        return Math.min(lim, Math.max(0, line));
    };
    T.select = {
        hotkey: 'v',
        label: 'Seleccionar',
        hint: 'Clic en un muro, vano, losa o escalera. Con un muro elegido, arrastrá su manija para agrandar o achicar la habitación.',
        reset() { drag = null; },
        move(p) {
            if (drag) {
                drag.line = dragLine(p);
                app.render();
                return;
            }
            const hd = handleAt(app.cam);
            app.canvas.style.cursor = hd && Math.hypot(p.sx - hd.sx, p.sy - hd.sy) < 16 ? 'grab' : '';
            const hit = pickAt(app, p.sx, p.sy);
            if (JSON.stringify(hit) !== JSON.stringify(app.hover)) {
                app.hover = hit;
                app.render();
            }
        },
        down(p) {
            const hd = handleAt(app.cam);
            if (hd && Math.hypot(p.sx - hd.sx, p.sy - hd.sy) < 16) {
                const horizontal = hd.w.y1 === hd.w.y2;
                drag = { w: hd.w, line0: horizontal ? hd.w.y1 : hd.w.x1, line: horizontal ? hd.w.y1 : hd.w.x1, x0: p.wx, y0: p.wy };
                app.canvas.style.cursor = 'grabbing';
                return;
            }
            app.hover = pickAt(app, p.sx, p.sy);
            store.setUi({ selection: app.hover });
        },
        up() {
            if (!drag) return;
            const d = drag;
            drag = null;
            app.canvas.style.cursor = '';
            if (d.line !== d.line0) wallMoveCommit(d.w.id, d.line);
        },
        keyDown(e) {
            if (e.key === 'Escape' && drag) {
                drag = null;
                app.canvas.style.cursor = '';
                app.render();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            if (drag) {
                const horizontal = drag.w.y1 === drag.w.y2;
                const delta = drag.line - drag.line0;
                const z = base();
                const chain = collinearChain(store.level().walls, drag.w);
                for (const w of chain) {
                    const t = w.t / 2;
                    const box = horizontal
                        ? { x0: w.x1 * G, x1: w.x2 * G, y0: drag.line * G - t, y1: drag.line * G + t, z0: z, z1: z + cfg.levelHeight }
                        : { x0: drag.line * G - t, x1: drag.line * G + t, y0: w.y1 * G, y1: w.y2 * G, z0: z, z1: z + cfg.levelHeight };
                    ghostBox(ctx, cam, box, { fill: 'rgba(37,99,235,.25)', stroke: '#2563eb' });
                }
                const mid = chain[Math.floor(chain.length / 2)];
                const [sx, sy] = cam.project(horizontal ? ((mid.x1 + mid.x2) / 2) * G : drag.line * G, horizontal ? drag.line * G : ((mid.y1 + mid.y2) / 2) * G, z + cfg.levelHeight);
                label(ctx, `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta) * G, 1)} cm · ${horizontal ? 'y' : 'x'} = ${fmt((drag.line * G) / 100)} m`, sx, sy - 18, { bg: 'rgba(37,99,235,.92)' });
                return;
            }
            const hd = handleAt(cam);
            if (!hd) return;
            const horizontal = hd.w.y1 === hd.w.y2;
            ctx.save();
            ctx.fillStyle = '#2563eb';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(hd.sx, hd.sy, 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            // flechas ↔ perpendiculares al muro (en pantalla, según la proyección)
            const a = cam.project(((hd.w.x1 + hd.w.x2) / 2) * G, ((hd.w.y1 + hd.w.y2) / 2) * G - (horizontal ? 30 : 0), base() + cfg.levelHeight);
            const b = cam.project(((hd.w.x1 + hd.w.x2) / 2) * G - (horizontal ? 0 : 30), ((hd.w.y1 + hd.w.y2) / 2) * G, base() + cfg.levelHeight);
            const dir = horizontal ? [a[0] - hd.sx, a[1] - hd.sy] : [b[0] - hd.sx, b[1] - hd.sy];
            const len = Math.hypot(dir[0], dir[1]) || 1;
            const ux = dir[0] / len;
            const uy = dir[1] / len;
            ctx.strokeStyle = '#fff';
            ctx.fillStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(hd.sx - ux * 6, hd.sy - uy * 6);
            ctx.lineTo(hd.sx + ux * 6, hd.sy + uy * 6);
            ctx.stroke();
            for (const k of [-1, 1]) {
                const tx = hd.sx + ux * 7 * k;
                const ty = hd.sy + uy * 7 * k;
                ctx.beginPath();
                ctx.moveTo(tx + ux * 3 * k, ty + uy * 3 * k);
                ctx.lineTo(tx - ux * 2 * k - uy * 3, ty - uy * 2 * k + ux * 3);
                ctx.lineTo(tx - ux * 2 * k + uy * 3, ty - uy * 2 * k - ux * 3);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        },
    };

    // ---------------- sala ----------------
    let room = null;
    const snapSpan = (v, origin, lines) => {
        const near = nearestLine(lines, v, 2);
        if (near !== null && Math.abs(near - origin) >= 10) return near;
        const d = v - origin;
        return origin + (d < 0 ? -1 : 1) * Math.max(10, Math.round(Math.abs(d) / 5) * 5);
    };
    T.room = {
        magnet: true,
        hotkey: 'r',
        label: 'Crear sala',
        hint: 'Arrastrá en diagonal: se crean las 4 paredes. Cerca de una pared existente el borde se pega a ella (habitación contigua).',
        options: () => h('span', { class: 'row' }, thicknessOption()),
        reset() { room = null; },
        down(p) {
            room = { a: { gx: p.gx, gy: p.gy }, rect: null };
        },
        move(p) {
            if (!room) return;
            const dx = p.gx - room.a.gx;
            const dy = p.gy - room.a.gy;
            // El lado se ajusta a la pared vecina más cercana (habitación contigua) o, si no hay, a múltiplos de 62,5 cm.
            const lines = wallLines(store);
            const ex = snapSpan(p.gx, room.a.gx, lines.xs);
            const ey = snapSpan(p.gy, room.a.gy, lines.ys);
            const w = Math.abs(ex - room.a.gx);
            const hh = Math.abs(ey - room.a.gy);
            const x = Math.min(room.a.gx, ex);
            const y = Math.min(room.a.gy, ey);
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
                dimLabel(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, `${fmt((w * G) / 100)} × ${fmt((hh * G) / 100)} m · ${fmt(area)} m²`);
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
            magnet: true,
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
        magnet: true,
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
        magnet: true,
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

    // ---------------- losa (piso del Nivel 2) ----------------
    let slabThickness = 12;
    let slabShrink = 0;
    let slab = null;
    const needUpper = () => (!store.project.upper ? 'Primero agregá el Nivel 2 con «+ Agregar nivel».' : store.ui.level === 1 ? null : 'La losa es el piso del Nivel 2: elegí la pestaña «Nivel 2».');
    T.slab = {
        magnet: true,
        hotkey: 'l',
        label: 'Losa de piso',
        hint: 'Clic dentro de una habitación de abajo: losa del mismo tamaño (o un módulo más chica). O arrastrá un rectángulo. Debe apoyar sobre muros.',
        disabled: needUpper,
        planeZ: () => cfg.levelHeight,
        options: () => h('span', { class: 'row' },
            selectT('Espesor', slabThickness, [10, 12, 15, 20].map((v) => [v, `${v} cm`]), (v) => { slabThickness = Number(v); }),
            selectT('Tamaño', slabShrink, [[0, 'Igual a la habitación'], [1, 'Más chica (−12,5 cm por lado)'], [2, 'Más chica (−25 cm por lado)']], (v) => { slabShrink = Number(v); })),
        reset() { slab = null; },
        down(p) {
            slab = { a: { gx: p.gx, gy: p.gy }, rect: null, dragged: false, at: { x: p.sx, y: p.sy } };
        },
        move(p) {
            if (!slab) return;
            if (Math.hypot(p.sx - slab.at.x, p.sy - slab.at.y) > DRAG_PX) slab.dragged = true;
            slab.rect = slab.dragged ? floorRect(slab.a, p) : null;
            app.render();
        },
        up() {
            if (!slab) return;
            let r = slab.rect;
            const a = slab.a;
            slab = null;
            if (!r) {
                const rooms = store.analysis?.levels?.[0]?.rooms ?? [];
                const room = rooms.find((rm) => rm.rect && a.gx >= rm.bbox.x && a.gx < rm.bbox.x + rm.bbox.w && a.gy >= rm.bbox.y && a.gy < rm.bbox.y + rm.bbox.h);
                if (!room) {
                    app.toast('Clic dentro de una habitación cerrada de la planta baja (o arrastrá un rectángulo).', 'error');
                    return;
                }
                const k = slabShrink;
                r = { x: room.bbox.x + k, y: room.bbox.y + k, w: room.bbox.w - 2 * k, h: room.bbox.h - 2 * k };
            }
            if (r.w < 4 || r.h < 4) {
                app.toast('La losa debe medir al menos 50 × 50 cm.', 'error');
                return;
            }
            const t = slabThickness;
            store.commit('Agregar losa', (d) => {
                d.levels[1].slabs.push({ id: nextId(d, 'l'), x: r.x, y: r.y, w: r.w, h: r.h, thickness: t });
            });
        },
        keyDown(e) {
            if (e.key === 'Escape' && slab) {
                slab = null;
                app.render();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            const z = cfg.levelHeight;
            if (slab?.rect) {
                const { x, y, w, h: hh } = slab.rect;
                outlineRect(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, { stroke: '#475569', fill: 'rgba(100,116,139,.35)', width: 2.5, dash: [6, 4] });
                dimLabel(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, `${fmt((w * G) / 100)} × ${fmt((hh * G) / 100)} m · ${fmt(((w * G) / 100) * ((hh * G) / 100))} m²`);
                return;
            }
            const p = app.pointer;
            if (!p) return;
            const rooms = store.analysis?.levels?.[0]?.rooms ?? [];
            const room = rooms.find((rm) => rm.rect && p.gx >= rm.bbox.x && p.gx < rm.bbox.x + rm.bbox.w && p.gy >= rm.bbox.y && p.gy < rm.bbox.y + rm.bbox.h);
            if (room) {
                const k = slabShrink;
                outlineRect(ctx, cam, (room.bbox.x + k) * G, (room.bbox.y + k) * G, (room.bbox.x + room.bbox.w - k) * G, (room.bbox.y + room.bbox.h - k) * G, z, { stroke: '#475569', fill: 'rgba(100,116,139,.3)', width: 2 });
            } else if (inLot(p.gx, p.gy)) {
                nodeMarker(ctx, cam, p.gx * G, p.gy * G, z, '#475569');
            }
        },
    };

    // ---------------- escalera (con descanso) ----------------
    const stairState = { shape: 'straight', dir: 'E', turn: 'right', w: 8, tread: 28 };
    const DIRS = ['E', 'S', 'W', 'N'];
    const DIR_NAME = { N: '↑ Norte', E: '→ Este', S: '↓ Sur', W: '← Oeste' };
    /** Huellas de la escalera (cm, en planta), con la misma geometría que calcula el servidor. */
    const stairGeometry = (st, gx, gy) => {
        const n = Math.ceil(cfg.levelHeight / 18);
        const W = st.w * G;
        const tread = st.tread;
        const k1 = st.shape === 'straight' ? n : Math.ceil(n / 2);
        const sgn = st.turn === 'left' ? -1 : 1;
        const l1 = (k1 - 1) * tread;
        const steps = [];
        const landings = [];
        for (let i = 1; i < k1; i++) steps.push([(i - 1) * tread, i * tread, 0, W]);
        if (st.shape !== 'straight') {
            const second = n - k1 - 1;
            if (st.shape === 'L') {
                landings.push([l1, l1 + W, 0, W]);
                for (let j = 1; j <= second; j++) steps.push([l1, l1 + W, W + (j - 1) * tread, W + j * tread]);
            } else {
                landings.push([l1, l1 + W, 0, 2 * W]);
                for (let j = 1; j <= second; j++) steps.push([l1 - j * tread, l1 - (j - 1) * tread, W, 2 * W]);
            }
        }
        const toPlan = ([u0, u1, v0, v1]) => {
            const pts = [[u0, v0 * sgn], [u1, v1 * sgn]].map(([u, v]) => (st.dir === 'N' ? [v, -u] : st.dir === 'E' ? [u, v] : st.dir === 'S' ? [-v, u] : [-u, -v]));
            return [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
        };
        const all = [...steps, ...landings].map(toPlan);
        const minX = Math.min(...all.map((r) => r[0]));
        const minY = Math.min(...all.map((r) => r[1]));
        const maxX = Math.max(...all.map((r) => r[2]));
        const maxY = Math.max(...all.map((r) => r[3]));
        const sh = (r) => [r[0] - minX + gx * G, r[1] - minY + gy * G, r[2] - minX + gx * G, r[3] - minY + gy * G];
        return { steps: steps.map((r) => sh(toPlan(r))), landings: landings.map((r) => sh(toPlan(r))), w: maxX - minX, h: maxY - minY, n, rise: cfg.levelHeight / n };
    };
    const cycleDir = () => { stairState.dir = DIRS[(DIRS.indexOf(stairState.dir) + 1) % 4]; app.refreshOptions(); app.render(); };
    T.stair = {
        magnet: true,
        hotkey: 's',
        label: 'Escalera',
        hint: 'Clic dentro de una habitación de la planta baja. Recta, en L o en U (con descanso). X gira la dirección de subida. Abre el hueco en el piso de arriba.',
        disabled: () => (!store.project.upper ? 'Primero agregá el Nivel 2 con «+ Agregar nivel».' : store.ui.level === 0 ? null : 'Las escaleras se dibujan en la Planta Baja: elegí «Nivel 1».'),
        options: () => h('span', { class: 'row' },
            selectT('Forma', stairState.shape, [['straight', 'Recta'], ['L', 'En L con descanso'], ['U', 'En U con descanso']], (v) => { stairState.shape = v; app.refreshOptions(); app.render(); }),
            selectT('Ancho', stairState.w, [7, 8, 9, 10, 12].map((v) => [v, `${fmt(v * G, 1)} cm`]), (v) => { stairState.w = Number(v); app.render(); }),
            selectT('Huella', stairState.tread, [25, 26, 28, 30, 32].map((v) => [v, `${v} cm`]), (v) => { stairState.tread = Number(v); app.render(); }),
            h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: cycleDir }, `Sube hacia ${DIR_NAME[stairState.dir]} (X)`),
            stairState.shape === 'straight' ? null : selectT('Gira a', stairState.turn, [['right', 'la derecha'], ['left', 'la izquierda']], (v) => { stairState.turn = v; app.render(); })),
        down(p) {
            if (!inLot(p.gx, p.gy)) return;
            const st = { ...stairState };
            const { w, h: hh } = stairGeometry(st, p.gx, p.gy);
            store.commit('Agregar escalera', (d) => {
                d.levels[0].stairs.push({ id: nextId(d, 'e'), x: p.gx, y: p.gy, dir: st.dir, shape: st.shape, w: st.w, tread: st.tread, turn: st.turn });
            });
            app.setHint(`Escalera de ${fmt(w / 100)} × ${fmt(hh / 100)} m agregada.`);
        },
        keyDown(e) {
            if (e.key === 'x' || e.key === 'X') {
                cycleDir();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            const p = app.pointer;
            if (!p || !inLot(p.gx, p.gy)) return;
            const g = stairGeometry(stairState, p.gx, p.gy);
            const rooms = store.analysis?.levels?.[0]?.rooms ?? [];
            const inside = rooms.some((rm) => rm.rect && p.gx * G >= rm.bbox.x * G - 1 && p.gy * G >= rm.bbox.y * G - 1 && p.gx * G + g.w <= (rm.bbox.x + rm.bbox.w) * G + 1 && p.gy * G + g.h <= (rm.bbox.y + rm.bbox.h) * G + 1);
            const ok = { fill: 'rgba(139,197,63,.5)', stroke: '#3f6212' };
            const bad = { fill: 'rgba(217,119,6,.4)', stroke: '#b45309' };
            for (const r of g.steps) ghostBox(ctx, cam, { x0: r[0], y0: r[1], x1: r[2], y1: r[3], z0: 0, z1: 12 }, inside ? ok : bad);
            for (const r of g.landings) ghostBox(ctx, cam, { x0: r[0], y0: r[1], x1: r[2], y1: r[3], z0: 0, z1: 14 }, inside ? ok : bad);
            const [sx, sy] = cam.project(p.gx * G + g.w / 2, p.gy * G + g.h / 2, 30);
            label(ctx, `${g.n} contrahuellas de ${fmt(g.rise, 1)} cm · ${fmt(g.w / 100)} × ${fmt(g.h / 100)} m${inside ? '' : ' · fuera de la habitación'}`, sx, sy - 18);
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

