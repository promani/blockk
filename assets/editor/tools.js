/**
 * Herramientas del editor. Cada una implementa (opcionalmente): move / down / up / key / draw / options / reset.
 * Las herramientas sólo arman intenciones (agregar un muro, un vano…); el servidor normaliza, valida y calcula.
 */
import { h } from '../lib/dom.js';
import { fmt } from '../lib/format.js';
import { sideLabel } from '../lib/orient.js';
import { pickAt, pickWall, alongPosition, G } from './pick.js';
import { outlineRect, ghostBox, label, nodeMarker } from './overlay.js';
import { nextId } from '../lib/storage.js';
import { ICONS } from './icons.js';
import { moveWallLine, collinearChain, mirrorMove } from './wallmove.js';
import { wallLines, nearestLine, anchorLines, nearestAnchor, ANCHOR_LABEL } from './snap.js';

const DRAG_PX = 6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wallLen = (w) => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);

export function createTools(app) {
    const { store } = app;
    const cfg = store.config;
    const BU = cfg.blockUnits; // bloque entero en unidades de 12,5 cm
    const BL = cfg.blockL; // largo del bloque en cm
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

    /** Todo se dibuja en bloques enteros; el imán y los anclajes permiten pegarse a muros existentes. */
    const step = () => BU;

    /**
     * Extremo de un tramo desde `origin`: se alinea con una pared existente cercana (imán o misma recta) y, si no hay,
     * el largo se redondea al ajuste elegido. Así un muro dibujado a mano y la herramienta Habitación dan las mismas medidas.
     */
    const snapLen = (v, origin, lines, minLen) => {
        const near = nearestLine(lines, v, 2);
        if (near !== null && Math.abs(near - origin) >= minLen) return near;
        const d = v - origin;
        return origin + (d < 0 ? -1 : 1) * Math.max(minLen, Math.round(Math.abs(d) / step()) * step());
    };

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

    /** Mueve una esquina de un ambiente: corre el muro horizontal y el vertical que se cruzan allí (y los muros que llegan a ellos se estiran). */
    const cornerWalls = (level, vx, vy) => ({
        horizontal: level.walls.find((w) => w.y1 === w.y2 && w.y1 === vy && w.x1 <= vx && vx <= w.x2),
        vertical: level.walls.find((w) => w.x1 === w.x2 && w.x1 === vx && w.y1 <= vy && vy <= w.y2),
    });
    const cornerMoveCommit = (vx, vy, nx, ny) => {
        const li = store.ui.level;
        const probe = structuredClone(store.level());
        const { horizontal, vertical } = cornerWalls(probe, vx, vy);
        const steps = [];
        if (nx !== vx) {
            if (!vertical) { app.toast('No hay un muro vertical en esa esquina para moverlo.', 'error'); return false; }
            steps.push([vertical.id, nx, vertical.x1, 'v']);
        }
        if (ny !== vy) {
            if (!horizontal) { app.toast('No hay un muro horizontal en esa esquina para moverlo.', 'error'); return false; }
            steps.push([horizontal.id, ny, horizontal.y1, 'h']);
        }
        const before = steps.map(([id]) => structuredClone(probe.walls.find((w) => w.id === id)));
        let dropped = 0;
        for (const [id, line, , kind] of steps) {
            const r = moveWallLine(probe, id, line, { maxLine: kind === 'h' ? lot().d : lot().w });
            if (!r.ok) { app.toast(r.reason, 'error'); return false; }
            dropped += r.dropped ?? 0;
        }
        store.commit('Mover esquina', (d) => {
            steps.forEach(([id, line, , kind], k) => {
                const maxLine = kind === 'h' ? lot().d : lot().w;
                moveWallLine(d.levels[li], id, line, { maxLine });
                if (li === 0 && d.upper) mirrorMove(d.levels[1], before[k], line, { maxLine });
            });
        });
        if (dropped) app.toast(`${dropped} vano(s) o viga(s) quedaron fuera del muro estirado y se quitaron.`);
        return true;
    };

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

    /** Rectángulo de un techo (con su cota de apoyo) o null. */
    const roofRect = (id) => store.project.roofs?.find((r) => r.id === id) ?? null;

    /** Manijas de la selección: muro (perpendicular), esquinas de un ambiente o esquinas de un techo. */
    const handlesOf = (cam) => {
        const sel = store.ui.selection;
        const out = [];
        if (!sel) return out;
        if (sel.type === 'wall' && store.ui.level <= 1) {
            const w = store.level().walls.find((x) => x.id === sel.id);
            if (w) {
                const [sx, sy] = cam.project(((w.x1 + w.x2) / 2) * G, ((w.y1 + w.y2) / 2) * G, base() + (w.h ?? 12) * 25);
                out.push({ kind: 'wall', sx, sy, w });
            }
        } else if (sel.type === 'room' && store.ui.level <= 1) {
            const room = store.analysis?.levels?.[store.ui.level]?.rooms?.find((r) => r.id === sel.id);
            for (const [vx, vy] of room?.corners ?? []) {
                const [sx, sy] = cam.project(vx * G, vy * G, base());
                out.push({ kind: 'corner', sx, sy, vx, vy });
            }
        } else if ((sel.type === 'roof' || sel.type === 'gable') && store.ui.level === 2) {
            const r = roofRect(sel.type === 'roof' ? sel.id : String(sel.id).split(':')[0]);
            if (r) {
                const z = (r.level + 1) * cfg.levelHeight;
                for (const [cx, cy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) {
                    const [sx, sy] = cam.project(cx * G, cy * G, z);
                    out.push({ kind: 'rcorner', sx, sy, cx, cy, r });
                }
                // bordes: se estiran de a un lado, como una pared de habitación
                for (const [side, cx, cy] of [['y0', r.x + r.w / 2, r.y], ['x1', r.x + r.w, r.y + r.h / 2], ['y1', r.x + r.w / 2, r.y + r.h], ['x0', r.x, r.y + r.h / 2]]) {
                    const [sx, sy] = cam.project(cx * G, cy * G, z);
                    out.push({ kind: 'rside', sx, sy, side, r });
                }
            }
        }
        return out;
    };
    const handleHit = (p) => handlesOf(app.cam).find((hd) => Math.hypot(p.sx - hd.sx, p.sy - hd.sy) < 14);

    let drag = null;
    const stepU = () => BU;
    const dragDelta = (p, axis) => Math.round(((axis === 'x' ? p.wx - drag.x0 : p.wy - drag.y0) / G) / stepU()) * stepU();
    const clampLot = (v, lim) => Math.min(lim, Math.max(0, v));
    /**
     * Valor arrastrado sobre un eje con imán a los anclajes (muros de abajo, de arriba o vecinos): a menos de 25 cm se pega
     * y deja registrado a cuál, para mostrarlo. `key` = 'ax' (rectas verticales, coordenada x) o 'ay' (horizontales, y).
     */
    const snapAxis = (p, key, v0) => {
        const axis = key === 'ax' ? 'x' : 'y';
        const v = clampLot(v0 + dragDelta(p, axis), axis === 'x' ? lot().w : lot().d);
        const a = nearestAnchor(drag[key] ?? [], v, 2, v0);
        drag[`${key}Hit`] = a;
        return a ? a.v : v;
    };
    /** Anclajes para un drag: rectas verticales (ax) y horizontales (ay). */
    const anchorsFor = (opts) => ({ ax: anchorLines(store, 'y', opts), ay: anchorLines(store, 'x', opts) });

    /** Guías de anclaje: rectas cercanas punteadas y la elegida en azul con su rótulo. */
    const drawAnchors = (ctx, cam, list, key, current, from, to, z) => {
        if (!list?.length) return;
        const P = (v, u) => (key === 'ax' ? cam.project(v * G, u * G, z) : cam.project(u * G, v * G, z));
        const hit = drag[`${key}Hit`];
        ctx.save();
        for (const a of list) {
            if (Math.abs(a.v - current) > 48) continue;
            const on = hit && a.v === hit.v;
            const lo = Math.min(from, a.from) - 6;
            const hi = Math.max(to, a.to) + 6;
            const [x0, y0] = P(a.v, lo);
            const [x1, y1] = P(a.v, hi);
            ctx.strokeStyle = on ? '#2563eb' : (a.kind === 'vecino' ? 'rgba(37,99,235,.28)' : 'rgba(217,119,6,.55)');
            ctx.lineWidth = on ? 2.5 : 1.3;
            ctx.setLineDash(on ? [] : [6, 5]);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }
        ctx.restore();
        if (hit) {
            const [sx, sy] = P(hit.v, (from + to) / 2);
            label(ctx, ANCHOR_LABEL[hit.kind] ?? 'Alineado', sx, sy + 22, { bg: 'rgba(37,99,235,.92)' });
        }
    };

    /** Fantasma de una cadena de muros colineales corrida a otra recta. */
    const ghostChain = (ctx, cam, wall, newLine) => {
        const horizontal = wall.y1 === wall.y2;
        const z = base();
        for (const w of collinearChain(store.level().walls, wall)) {
            const t = w.t / 2;
            const box = horizontal
                ? { x0: w.x1 * G, x1: w.x2 * G, y0: newLine * G - t, y1: newLine * G + t, z0: z, z1: z + cfg.levelHeight }
                : { x0: newLine * G - t, x1: newLine * G + t, y0: w.y1 * G, y1: w.y2 * G, z0: z, z1: z + cfg.levelHeight };
            ghostBox(ctx, cam, box, { fill: 'rgba(37,99,235,.25)', stroke: '#2563eb' });
        }
    };

    const drawHandle = (ctx, hd, cam) => {
        ctx.save();
        ctx.fillStyle = '#2563eb';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        if (hd.kind === 'wall') {
            const horizontal = hd.w.y1 === hd.w.y2;
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
        } else if (hd.kind === 'rside') {
            // borde de techo: círculo azul chico
            ctx.beginPath();
            ctx.arc(hd.sx, hd.sy, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            // esquina: cuadrado azul
            ctx.fillRect(hd.sx - 7, hd.sy - 7, 14, 14);
            ctx.strokeRect(hd.sx - 7, hd.sy - 7, 14, 14);
        }
        ctx.restore();
    };

    // ---------------- seleccionar ----------------
    T.select = {
        hotkey: 'v',
        label: 'Elegir',
        hint: 'Clic en un muro, vano, losa, escalera o techo; doble clic elige la habitación. Arrastrá las manijas azules para cambiar el tamaño.',
        reset() { drag = null; },
        move(p) {
            if (drag) {
                if (drag.kind === 'wall') drag.line = snapAxis(p, drag.horizontal ? 'ay' : 'ax', drag.line0);
                else if (drag.kind === 'corner') {
                    drag.nx = snapAxis(p, 'ax', drag.vx);
                    drag.ny = snapAxis(p, 'ay', drag.vy);
                } else if (drag.kind === 'rside') {
                    const key = drag.side[0] === 'x' ? 'ax' : 'ay';
                    drag.nv = snapAxis(p, key, drag.v0);
                } else {
                    drag.nx = snapAxis(p, 'ax', drag.cx);
                    drag.ny = snapAxis(p, 'ay', drag.cy);
                }
                app.render();
                return;
            }
            app.canvas.style.cursor = handleHit(p) ? 'grab' : '';
            const hit = pickAt(app, p.sx, p.sy);
            if (JSON.stringify(hit) !== JSON.stringify(app.hover)) {
                app.hover = hit;
                app.render();
            }
        },
        down(p, e) {
            const hd = handleHit(p);
            if (hd) {
                app.canvas.style.cursor = 'grabbing';
                if (hd.kind === 'wall') {
                    const horizontal = hd.w.y1 === hd.w.y2;
                    const line0 = horizontal ? hd.w.y1 : hd.w.x1;
                    const chain = new Set(collinearChain(store.level().walls, hd.w).map((w) => w.id));
                    drag = { kind: 'wall', w: hd.w, horizontal, line0, line: line0, x0: p.wx, y0: p.wy, ...anchorsFor({ exclude: chain }) };
                } else if (hd.kind === 'corner') {
                    drag = { kind: 'corner', vx: hd.vx, vy: hd.vy, nx: hd.vx, ny: hd.vy, x0: p.wx, y0: p.wy, ...anchorsFor({}) };
                } else {
                    // Techos: se alinean con los muros del nivel donde apoyan (y los del otro nivel).
                    const anchors = anchorsFor({ level: hd.r.level });
                    for (const k of ['ax', 'ay']) for (const a of anchors[k]) if (a.kind === 'vecino') a.kind = 'muro';
                    if (hd.kind === 'rside') {
                        const r = hd.r;
                        const v0 = { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }[hd.side];
                        drag = { kind: 'rside', r, side: hd.side, v0, nv: v0, x0: p.wx, y0: p.wy, ...anchors };
                    } else {
                        drag = { kind: 'rcorner', r: hd.r, cx: hd.cx, cy: hd.cy, nx: hd.cx, ny: hd.cy, x0: p.wx, y0: p.wy, ...anchors };
                    }
                }
                return;
            }
            app.hover = pickAt(app, p.sx, p.sy);
            // Doble clic: la habitación de ese lugar (aunque un muro de adelante tape el piso en la vista isométrica).
            if (e?.detail >= 2 && store.ui.level <= 1) {
                const [wx, wy] = app.cam.unproject(p.sx, p.sy, base());
                const room = store.analysis?.levels?.[store.ui.level]?.rooms?.find((r) => r.fill?.some(([x, y, w, h]) => wx / G >= x && wx / G < x + w && wy / G >= y && wy / G < y + h));
                if (room) app.hover = { type: 'room', id: room.id };
            }
            store.setUi({ selection: app.hover });
        },
        up() {
            if (!drag) return;
            const d = drag;
            drag = null;
            app.canvas.style.cursor = '';
            if (d.kind === 'wall') {
                if (d.line !== d.line0) wallMoveCommit(d.w.id, d.line);
            } else if (d.kind === 'corner') {
                if (d.nx !== d.vx || d.ny !== d.vy) cornerMoveCommit(d.vx, d.vy, d.nx, d.ny);
            } else if (d.kind === 'rside') {
                if (d.nv === d.v0) return;
                const r = d.r;
                const e = { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h };
                e[d.side] = d.nv;
                const x = Math.min(e.x0, e.x1);
                const y = Math.min(e.y0, e.y1);
                const w = Math.abs(e.x1 - e.x0);
                const hh = Math.abs(e.y1 - e.y0);
                if (w < 2 || hh < 2) {
                    app.toast('El techo debe medir al menos 25 × 25 cm.', 'error');
                    return;
                }
                store.commit('Estirar techo', (dr) => Object.assign(dr.roofs.find((q) => q.id === r.id), { x, y, w, h: hh }));
            } else if (d.nx !== d.cx || d.ny !== d.cy) {
                // el vértice opuesto queda fijo; el rectángulo se recalcula entre él y la esquina arrastrada
                const r = d.r;
                const fx = d.cx === r.x ? r.x + r.w : r.x;
                const fy = d.cy === r.y ? r.y + r.h : r.y;
                const x = Math.min(fx, d.nx);
                const y = Math.min(fy, d.ny);
                const w = Math.abs(d.nx - fx);
                const hh = Math.abs(d.ny - fy);
                if (w < 2 || hh < 2) {
                    app.toast('El techo debe medir al menos 25 × 25 cm.', 'error');
                    return;
                }
                store.commit('Cambiar tamaño del techo', (dr) => Object.assign(dr.roofs.find((q) => q.id === r.id), { x, y, w, h: hh }));
            }
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
                const z = base();
                if (drag.kind === 'wall') {
                    const horizontal = drag.w.y1 === drag.w.y2;
                    const delta = drag.line - drag.line0;
                    ghostChain(ctx, cam, drag.w, drag.line);
                    const chain = collinearChain(store.level().walls, drag.w);
                    const span = horizontal ? [Math.min(...chain.map((w) => w.x1)), Math.max(...chain.map((w) => w.x2))] : [Math.min(...chain.map((w) => w.y1)), Math.max(...chain.map((w) => w.y2))];
                    drawAnchors(ctx, cam, horizontal ? drag.ay : drag.ax, horizontal ? 'ay' : 'ax', drag.line, span[0], span[1], z);
                    const mid = chain[Math.floor(chain.length / 2)];
                    const [sx, sy] = cam.project(horizontal ? ((mid.x1 + mid.x2) / 2) * G : drag.line * G, horizontal ? drag.line * G : ((mid.y1 + mid.y2) / 2) * G, z + cfg.levelHeight);
                    label(ctx, `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta) * G, 1)} cm · ${horizontal ? 'y' : 'x'} = ${fmt((drag.line * G) / 100)} m`, sx, sy - 18, { bg: 'rgba(37,99,235,.92)' });
                } else if (drag.kind === 'corner') {
                    const { horizontal, vertical } = cornerWalls(store.level(), drag.vx, drag.vy);
                    if (drag.nx !== drag.vx && vertical) ghostChain(ctx, cam, vertical, drag.nx);
                    if (drag.ny !== drag.vy && horizontal) ghostChain(ctx, cam, horizontal, drag.ny);
                    drawAnchors(ctx, cam, drag.ax, 'ax', drag.nx, drag.ny - 8, drag.ny + 8, z);
                    drawAnchors(ctx, cam, drag.ay, 'ay', drag.ny, drag.nx - 8, drag.nx + 8, z);
                    const [sx, sy] = cam.project(drag.nx * G, drag.ny * G, z + cfg.levelHeight);
                    label(ctx, `esquina → x ${fmt((drag.nx * G) / 100)} m · y ${fmt((drag.ny * G) / 100)} m`, sx, sy - 18, { bg: 'rgba(37,99,235,.92)' });
                } else if (drag.kind === 'rside') {
                    const r = drag.r;
                    const e = { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h };
                    e[drag.side] = drag.nv;
                    const zr = (r.level + 1) * cfg.levelHeight;
                    outlineRect(ctx, cam, Math.min(e.x0, e.x1) * G, Math.min(e.y0, e.y1) * G, Math.max(e.x0, e.x1) * G, Math.max(e.y0, e.y1) * G, zr, { stroke: '#2563eb', fill: 'rgba(37,99,235,.18)', width: 2.5, dash: [6, 4] });
                    const key = drag.side[0] === 'x' ? 'ax' : 'ay';
                    drawAnchors(ctx, cam, drag[key], key, drag.nv, key === 'ax' ? e.y0 : e.x0, key === 'ax' ? e.y1 : e.x1, zr);
                    const [sx, sy] = cam.project(((e.x0 + e.x1) / 2) * G, ((e.y0 + e.y1) / 2) * G, zr);
                    label(ctx, `${fmt((Math.abs(e.x1 - e.x0) * G) / 100)} × ${fmt((Math.abs(e.y1 - e.y0) * G) / 100)} m`, sx, sy - 18, { bg: 'rgba(37,99,235,.92)' });
                } else {
                    const r = drag.r;
                    const fx = drag.cx === r.x ? r.x + r.w : r.x;
                    const fy = drag.cy === r.y ? r.y + r.h : r.y;
                    const zr = (r.level + 1) * cfg.levelHeight;
                    outlineRect(ctx, cam, Math.min(fx, drag.nx) * G, Math.min(fy, drag.ny) * G, Math.max(fx, drag.nx) * G, Math.max(fy, drag.ny) * G, zr, { stroke: '#2563eb', fill: 'rgba(37,99,235,.18)', width: 2.5, dash: [6, 4] });
                    drawAnchors(ctx, cam, drag.ax, 'ax', drag.nx, Math.min(fy, drag.ny), Math.max(fy, drag.ny), zr);
                    drawAnchors(ctx, cam, drag.ay, 'ay', drag.ny, Math.min(fx, drag.nx), Math.max(fx, drag.nx), zr);
                    const [sx, sy] = cam.project(drag.nx * G, drag.ny * G, zr);
                    label(ctx, `${fmt((Math.abs(drag.nx - fx) * G) / 100)} × ${fmt((Math.abs(drag.ny - fy) * G) / 100)} m`, sx, sy - 18, { bg: 'rgba(37,99,235,.92)' });
                }
                return;
            }
            for (const hd of handlesOf(cam)) drawHandle(ctx, hd, cam);
        },
    };

    // ---------------- mover varios elementos juntos ----------------
    /** Elementos cuya planta cae dentro del rectángulo (unidades), en todos los niveles: se mueven juntos, de arriba abajo. */
    const collectIn = (x0, y0, x1, y1) => {
        const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const sel = { walls: [], stairs: [], slabs: [], timber: [], roofs: [] };
        store.project.levels.forEach((lv, li) => {
            for (const w of lv.walls) if (inside(w.x1, w.y1) && inside(w.x2, w.y2)) sel.walls.push([li, w.id]);
            for (const sl of lv.slabs ?? []) if (inside(sl.x, sl.y) && inside(sl.x + sl.w, sl.y + sl.h)) sel.slabs.push([li, sl.id]);
            for (const st of lv.stairs ?? []) {
                const b = store.analysis?.floors?.stairs?.find((q) => q.id === st.id)?.bbox;
                if (b && inside(b.x / G, b.y / G) && inside((b.x + b.w) / G, (b.y + b.h) / G)) sel.stairs.push([li, st.id]);
            }
            for (const t of lv.timber ?? []) {
                const ok = t.kind === 'beam' ? inside(t.x1, t.y1) && inside(t.x2, t.y2) : inside(t.x, t.y) && inside(t.x + t.w, t.y + t.h);
                if (ok) sel.timber.push([li, t.id]);
            }
        });
        for (const r of store.project.roofs ?? []) if (inside(r.x, r.y) && inside(r.x + r.w, r.y + r.h)) sel.roofs.push([0, r.id]);
        return sel;
    };
    const countSel = (sel) => (sel ? Object.values(sel).reduce((a, l) => a + l.length, 0) : 0);
    /** Caja (unidades) de lo elegido. */
    const selBox = (sel) => {
        const xs = [];
        const ys = [];
        const p = store.project;
        for (const [li, id] of sel.walls) { const w = p.levels[li].walls.find((q) => q.id === id); if (w) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); } }
        for (const [li, id] of sel.slabs) { const q = p.levels[li].slabs.find((z) => z.id === id); if (q) { xs.push(q.x, q.x + q.w); ys.push(q.y, q.y + q.h); } }
        for (const [li, id] of sel.timber) { const t = p.levels[li].timber.find((z) => z.id === id); if (t) { if (t.kind === 'beam') { xs.push(t.x1, t.x2); ys.push(t.y1, t.y2); } else { xs.push(t.x, t.x + t.w); ys.push(t.y, t.y + t.h); } } }
        for (const [, id] of sel.roofs) { const r = p.roofs.find((z) => z.id === id); if (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); } }
        for (const [, id] of sel.stairs) { const b = store.analysis?.floors?.stairs?.find((q) => q.id === id)?.bbox; if (b) { xs.push(b.x / G, (b.x + b.w) / G); ys.push(b.y / G, (b.y + b.h) / G); } }
        return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : null;
    };
    const moveState = { sel: null, band: null, drag: null };
    const clampOffset = (box, dx, dy) => ({
        dx: Math.max(-box.x0, Math.min(lot().w - box.x1, dx)),
        dy: Math.max(-box.y0, Math.min(lot().d - box.y1, dy)),
    });
    const applyMove = (sel, dx, dy) => {
        if (!dx && !dy) return;
        store.commit('Mover', (d) => {
            for (const [li, id] of sel.walls) { const w = d.levels[li].walls.find((q) => q.id === id); if (w) { w.x1 += dx; w.x2 += dx; w.y1 += dy; w.y2 += dy; } }
            for (const [li, id] of sel.slabs) { const q = d.levels[li].slabs.find((z) => z.id === id); if (q) { q.x += dx; q.y += dy; } }
            for (const [li, id] of sel.stairs) { const q = d.levels[li].stairs.find((z) => z.id === id); if (q) { q.x += dx; q.y += dy; } }
            for (const [li, id] of sel.timber) {
                const t = d.levels[li].timber.find((z) => z.id === id);
                if (!t) continue;
                if (t.kind === 'beam') { t.x1 += dx; t.x2 += dx; t.y1 += dy; t.y2 += dy; } else { t.x += dx; t.y += dy; }
            }
            for (const [, id] of sel.roofs) { const r = d.roofs.find((z) => z.id === id); if (r) { r.x += dx; r.y += dy; } }
        });
    };
    const selectAll = () => {
        moveState.sel = collectIn(-1e4, -1e4, 1e4, 1e4);
        app.refreshOptions();
        app.render();
    };
    app.selectAll = selectAll;
    T.move = {
        hotkey: 'm',
        label: 'Mover',
        hint: `Arrastrá un rectángulo para elegir varios elementos (o «Toda la casa») y después arrastralos juntos. Flechas: ${fmt(BL, 1)} cm.`,
        planeZ: () => (store.ui.level === 2 ? (store.topLevel + 1) * cfg.levelHeight : base()),
        options: () => {
            const n = countSel(moveState.sel);
            return h('span', { class: 'row' },
                h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: selectAll }, 'Toda la casa (Ctrl+A)'),
                n ? h('span', { class: 'tag' }, `${n} elemento${n > 1 ? 's' : ''} elegido${n > 1 ? 's' : ''}`) : null,
                n ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { moveState.sel = null; app.refreshOptions(); app.render(); } }, 'Soltar') : null);
        },
        reset() { moveState.band = null; moveState.drag = null; },
        down(p) {
            const box = moveState.sel && selBox(moveState.sel);
            const ux = p.wx / G;
            const uy = p.wy / G;
            if (box && ux >= box.x0 - 1 && ux <= box.x1 + 1 && uy >= box.y0 - 1 && uy <= box.y1 + 1) {
                moveState.drag = { x0: p.wx, y0: p.wy, box, dx: 0, dy: 0 };
                app.canvas.style.cursor = 'grabbing';
                return;
            }
            moveState.band = { a: [ux, uy], b: [ux, uy] };
        },
        move(p) {
            if (moveState.drag) {
                const d = moveState.drag;
                const raw = { dx: Math.round((p.wx - d.x0) / G / BU) * BU, dy: Math.round((p.wy - d.y0) / G / BU) * BU };
                Object.assign(d, clampOffset(d.box, raw.dx, raw.dy));
                app.render();
            } else if (moveState.band) {
                moveState.band.b = [p.wx / G, p.wy / G];
                app.render();
            }
        },
        up() {
            if (moveState.drag) {
                const { dx, dy } = moveState.drag;
                moveState.drag = null;
                app.canvas.style.cursor = '';
                applyMove(moveState.sel, dx, dy);
                return;
            }
            if (moveState.band) {
                const [ax, ay] = moveState.band.a;
                const [bx, by] = moveState.band.b;
                moveState.band = null;
                const sel = collectIn(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
                moveState.sel = countSel(sel) ? sel : null;
                if (!moveState.sel) app.toast('No hay nada completo dentro del rectángulo: tiene que abarcar muros enteros.');
                app.refreshOptions();
                app.render();
            }
        },
        keyDown(e) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                selectAll();
                return true;
            }
            const dir = { ArrowLeft: [-BU, 0], ArrowRight: [BU, 0], ArrowUp: [0, -BU], ArrowDown: [0, BU] }[e.key];
            if (dir && moveState.sel) {
                e.preventDefault();
                const box = selBox(moveState.sel);
                const { dx, dy } = clampOffset(box, dir[0], dir[1]);
                applyMove(moveState.sel, dx, dy);
                return true;
            }
            if (e.key === 'Escape' && (moveState.sel || moveState.band)) {
                moveState.sel = null;
                moveState.band = null;
                app.refreshOptions();
                app.render();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            const z = T.move.planeZ();
            if (moveState.band) {
                const [ax, ay] = moveState.band.a;
                const [bx, by] = moveState.band.b;
                outlineRect(ctx, cam, Math.min(ax, bx) * G, Math.min(ay, by) * G, Math.max(ax, bx) * G, Math.max(ay, by) * G, z, { stroke: '#2563eb', fill: 'rgba(37,99,235,.10)', width: 1.5, dash: [5, 4] });
            }
            const sel = moveState.sel;
            if (!sel) return;
            const box = selBox(sel);
            if (!box) return;
            const dx = moveState.drag?.dx ?? 0;
            const dy = moveState.drag?.dy ?? 0;
            // muros elegidos (en su nivel), corridos por el arrastre
            for (const [li, id] of sel.walls) {
                const w = store.project.levels[li].walls.find((q) => q.id === id);
                if (!w) continue;
                const zb = li * cfg.levelHeight;
                const t = w.t / 2;
                const hz = (w.h ?? 12) * 25;
                const [x0, x1] = [Math.min(w.x1, w.x2) + dx, Math.max(w.x1, w.x2) + dx].map((v) => v * G);
                const [y0, y1] = [Math.min(w.y1, w.y2) + dy, Math.max(w.y1, w.y2) + dy].map((v) => v * G);
                const b = w.y1 === w.y2 ? { x0, x1, y0: y0 - t, y1: y1 + t } : { x0: x0 - t, x1: x1 + t, y0, y1 };
                if (dx || dy) ghostBox(ctx, cam, { ...b, z0: zb, z1: zb + hz }, { fill: 'rgba(37,99,235,.18)', stroke: 'rgba(37,99,235,.7)', width: 1 });
                else outlineRect(ctx, cam, b.x0, b.y0, b.x1, b.y1, zb + hz, { stroke: '#2563eb', fill: 'rgba(37,99,235,.35)', width: 1.5 });
            }
            outlineRect(ctx, cam, (box.x0 + dx) * G, (box.y0 + dy) * G, (box.x1 + dx) * G, (box.y1 + dy) * G, 0, { stroke: '#2563eb', width: 2, dash: [8, 5] });
            const [sx, sy] = cam.project(((box.x0 + box.x1) / 2 + dx) * G, ((box.y0 + box.y1) / 2 + dy) * G, 0);
            label(ctx, dx || dy ? `→ ${fmt((dx * G) / 100)} m · ↓ ${fmt((dy * G) / 100)} m` : `${countSel(sel)} elementos · arrastrá para mover`, sx, sy, { bg: 'rgba(37,99,235,.92)' });
        },
    };

    // ---------------- sala ----------------
    let room = null;
    const minRoom = () => 10;
    const snapSpan = (v, origin, lines) => snapLen(v, origin, lines, minRoom());
    T.room = {
        magnet: true,
        hotkey: 'r',
        label: 'Habitación',
        hint: 'Arrastrá en diagonal: se crean las 4 paredes. Cerca de otra pared, el borde se pega a ella (habitaciones contiguas).',
        options: () => h('span', { class: 'row' }, thicknessOption()),
        reset() { room = null; },
        down(p) {
            room = { a: { gx: p.gx, gy: p.gy }, rect: null };
        },
        move(p) {
            if (!room) return;
            const dx = p.gx - room.a.gx;
            const dy = p.gy - room.a.gy;
            // El lado se ajusta a la pared vecina más cercana (habitación contigua) o, si no hay, a múltiplos del bloque.
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
            store.commit('Crear habitación', (d) => {
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

        let chainStart = null;
        const compute = (p) => {
            if (!start) return null;
            const e = ortho(start, p);
            if (!opts.module) {
                // Mismo ajuste que Habitación: se pega al inicio de la cadena o a paredes cercanas; si no, largo en bloques.
                if (chainStart && Math.abs(p.gx - chainStart.gx) <= 1 && Math.abs(p.gy - chainStart.gy) <= 1 && (chainStart.gx === start.gx || chainStart.gy === start.gy)) return { ...chainStart };
                if (p.hit) return e;
                const lines = wallLines(store);
                if (chainStart) {
                    lines.xs.push(chainStart.gx);
                    lines.ys.push(chainStart.gy);
                }
                return e.gy === start.gy ? { gx: snapLen(e.gx, start.gx, lines.xs, Math.max(2, step())), gy: start.gy } : { gx: start.gx, gy: snapLen(e.gy, start.gy, lines.ys, Math.max(2, step())) };
            }
            if (opts.module) {
                const len = Math.max(0, Math.abs(e.gx - start.gx) + Math.abs(e.gy - start.gy));
                const sign = Math.sign(e.gx - start.gx + (e.gy - start.gy)) || 1;
                const q = Math.max(BU, Math.round(len / BU) * BU) * sign;
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
            const roomsBefore = store.analysis?.levels?.[store.ui.level]?.rooms?.length ?? 0;
            store.commit(opts.commitLabel, (d) => newWall(d, a.gx, a.gy, b.gx, b.gy, store.ui.thickness)).then(() => {
                // Si el muro cerró un contorno se avisa (igual que al crear una habitación).
                const rooms = store.analysis?.levels?.[store.ui.level]?.rooms ?? [];
                if (!opts.module && rooms.length > roomsBefore) {
                    const newest = rooms.reduce((m, r) => (r.id > m.id ? r : m), rooms[0]);
                    app.toast(`Habitación cerrada: ${fmt(newest.netM2)} m² útiles.`);
                }
            });
            return true;
        };
        return {
            magnet: true,
            hotkey: opts.key,
            label: opts.label,
            hint: opts.hint,
            options: () => h('span', { class: 'row' }, thicknessOption(), opts.module ? h('button', { class: 'btn btn-outline btn-sm', onclick: () => { axis = axis === 'x' ? 'y' : 'x'; app.refreshOptions(); } }, `Orientación: ${axis === 'x' ? '↔ horizontal' : '↕ vertical'} (X)`) : null),
            reset() { start = null; end = null; pressed = false; chainStart = null; },
            down(p, e) {
                if (start && !pressed) {
                    const b = compute(p);
                    if (commitSeg(start, b)) start = { ...b };
                    // Doble clic o volver al punto de partida terminan la cadena (el contorno quedó cerrado).
                    if (e.detail >= 2 || (chainStart && b && b.gx === chainStart.gx && b.gy === chainStart.gy)) {
                        start = null;
                        chainStart = null;
                        end = null;
                    }
                    app.render();
                    return;
                }
                start = { gx: p.gx, gy: p.gy };
                chainStart = { ...start };
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
                    const b = axis === 'x' ? { gx: a.gx + BU, gy: a.gy } : { gx: a.gx, gy: a.gy + BU };
                    commitSeg(a, b);
                    start = null;
                    end = null;
                    return;
                }
                if (dragged) {
                    commitSeg(start, compute(p));
                    start = null;
                    chainStart = null;
                    end = null;
                }
            },
            keyDown(e) {
                if (e.key === 'Escape' && start) {
                    start = null;
                    chainStart = null;
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
                chainStart = null;
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
                    const modular = len % BU === 0;
                    const closes = chainStart && end.gx === chainStart.gx && end.gy === chainStart.gy && (start.gx !== chainStart.gx || start.gy !== chainStart.gy);
                    if (closes) nodeMarker(ctx, cam, end.gx * G, end.gy * G, z, '#2563eb');
                    if (len > 0) dimLabel(ctx, cam, x0, y0, x1, y1, z + cfg.levelHeight, `${fmt((len * G) / 100)} m · ${fmt((len * G) / BL, 1)} bloques${modular ? '' : ' · con cortes'}${closes ? ' · cierra la habitación' : ''}`);
                } else if (opts.module && app.pointer && !start) {
                    const a = { gx: app.pointer.gx, gy: app.pointer.gy };
                    const b = axis === 'x' ? { gx: a.gx + BU, gy: a.gy } : { gx: a.gx, gy: a.gy + BU };
                    const horizontal = axis === 'x';
                    ghostBox(ctx, cam, { x0: a.gx * G - (horizontal ? 0 : t / 2), x1: b.gx * G + (horizontal ? 0 : t / 2), y0: a.gy * G - (horizontal ? t / 2 : 0), y1: b.gy * G + (horizontal ? t / 2 : 0), z0: z, z1: z + 25 }, { fill: 'rgba(139,197,63,.4)' });
                } else if (app.pointer && inLot(app.pointer.gx, app.pointer.gy)) {
                    nodeMarker(ctx, cam, app.pointer.gx * G, app.pointer.gy * G, z);
                }
                if (start) nodeMarker(ctx, cam, start.gx * G, start.gy * G, z, '#3f6212');
            },
        };
    };
    T.wall = segmentTool({ key: 'w', label: 'Muro', hint: 'Clic en cada esquina (o arrastrá un muro). Al volver al punto de partida la habitación se cierra; Esc o doble clic terminan.', commitLabel: 'Agregar muro' });
    T.block = segmentTool({ key: 'b', label: 'Bloque suelto', hint: `Clic: un bloque de ${fmt(BL, 1)} cm. Arrastre: hilera de bloques enteros. X gira la orientación.`, module: true, commitLabel: 'Agregar bloques' });

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
            selectT('Largo', uModules, [1, 2, 3, 4, 6, 8].map((m) => [m, `${m} bloque${m > 1 ? 's' : ''} (${fmt((m * BL) / 100)} m)`]), (v) => { uModules = Number(v); app.render(); })),
        reset() { uGhost = null; },
        move(p) {
            const wall = pickWall(app, p.sx, p.sy);
            if (!wall) {
                uGhost = null;
            } else {
                const len = uModules * BU;
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
    // El piso del Nivel 2 (losa o entrepiso de madera) y sus vigas se dibujan desde la pestaña «Nivel 2», sobre las habitaciones de abajo.
    const groundOnly = () => (!store.project.upper ? 'Primero agregá el Nivel 2 con «+ Agregar nivel».' : store.ui.level === 1 ? null : 'El piso del Nivel 2 se dibuja desde la pestaña «Nivel 2».');
    const floorRect = (a, p) => {
        const x = Math.min(a.gx, p.gx);
        const y = Math.min(a.gy, p.gy);
        return { x, y, w: Math.abs(p.gx - a.gx), h: Math.abs(p.gy - a.gy) };
    };
    T.floor = {
        magnet: true,
        hotkey: '',
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
        hotkey: '',
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

    // ---------------- piso del Nivel 2: losa de hormigón o entrepiso de madera (una sola herramienta) ----------------
    let pisoKind = 'slab';
    const piso = () => (pisoKind === 'slab' ? T.slab : T.floor);
    T.piso = {
        magnet: true,
        hotkey: 'l',
        label: 'Piso',
        hint: 'Clic dentro de una habitación de abajo: piso del mismo tamaño (o arrastrá un rectángulo). Losa de hormigón o entrepiso de madera.',
        disabled: needUpper,
        planeZ: () => cfg.levelHeight,
        options: () => h('span', { class: 'row' },
            h('span', { class: 'seg', role: 'group', 'aria-label': 'Tipo de piso' }, [['slab', 'Losa de hormigón'], ['floor', 'Madera (tirantes)']].map(([v, t]) =>
                h('button', { type: 'button', 'aria-pressed': String(pisoKind === v), onclick: () => { piso().reset?.(); pisoKind = v; app.refreshOptions(); app.render(); } }, t))),
            piso().options?.()),
        reset() { T.slab.reset(); T.floor.reset(); },
        down: (p, e) => piso().down?.(p, e),
        move: (p, e) => piso().move?.(p, e),
        up: (p, e) => piso().up?.(p, e),
        keyDown: (e) => piso().keyDown?.(e) ?? false,
        draw: (ctx, cam) => piso().draw?.(ctx, cam),
    };

    // ---------------- escalera (con descanso) ----------------
    const stairState = { shape: 'straight', dir: 'E', turn: 'right', w: 8, tread: 28 };
    const DIRS = ['E', 'S', 'W', 'N'];
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
    /**
     * Dónde queda la escalera con el cursor en p: centrada en el cursor y, si el cursor está en una habitación de la
     * planta baja, corrida para que entre en ella (a 12,5 cm de los ejes de los muros). ok = entra en la habitación.
     */
    const stairPlacement = (p) => {
        // Si no entra hacia donde sube, se prueba girada (la dirección elegida sigue primero).
        const order = [stairState.dir, ...DIRS.filter((d) => d !== stairState.dir)];
        let first = null;
        for (const dir of order) {
            const r = placeStair({ ...stairState, dir }, p);
            first ??= r;
            if (r.ok) return r;
        }
        return first;
    };
    const placeStair = (st, p) => {
        const g0 = stairGeometry(st, 0, 0);
        const wu = Math.ceil(g0.w / G - 1e-6);
        const hu = Math.ceil(g0.h / G - 1e-6);
        let gx = Math.round(p.wx / G - wu / 2);
        let gy = Math.round(p.wy / G - hu / 2);
        const cx = Math.floor(p.wx / G);
        const cy = Math.floor(p.wy / G);
        const rooms = store.analysis?.levels?.[0]?.rooms ?? [];
        let ok = false;
        for (const rm of rooms) {
            const cell = rm.fill?.find(([x, y, w, h]) => cx >= x && cx < x + w && cy >= y && cy < y + h);
            if (!cell) continue;
            const [fx, fy, fw, fh] = cell;
            if (wu <= fw - 2) gx = Math.min(Math.max(gx, fx + 1), fx + fw - 1 - wu);
            if (hu <= fh - 2) gy = Math.min(Math.max(gy, fy + 1), fy + fh - 1 - hu);
            ok = gx >= fx && gy >= fy && gx + wu <= fx + fw && gy + hu <= fy + fh;
            break;
        }
        return { gx, gy, ok, st, geo: stairGeometry(st, gx, gy) };
    };
    T.stair = {
        magnet: false,
        snap: 1,
        hotkey: 's',
        label: 'Escalera',
        hint: 'Clic dentro de una habitación de la planta baja. Recta, en L o en U (con descanso). X gira la dirección de subida. Abre el hueco en el piso de arriba.',
        disabled: () => (!store.project.upper ? 'Primero agregá el Nivel 2 con «+ Agregar nivel».' : store.ui.level === 0 ? null : 'Las escaleras se dibujan en la Planta Baja: elegí «Nivel 1».'),
        options: () => h('span', { class: 'row' },
            selectT('Forma', stairState.shape, [['straight', 'Recta'], ['L', 'En L con descanso'], ['U', 'En U con descanso']], (v) => { stairState.shape = v; app.refreshOptions(); app.render(); }),
            selectT('Ancho', stairState.w, [7, 8, 9, 10, 12].map((v) => [v, `${fmt(v * G, 1)} cm`]), (v) => { stairState.w = Number(v); app.render(); }),
            selectT('Huella', stairState.tread, [25, 26, 28, 30, 32].map((v) => [v, `${v} cm`]), (v) => { stairState.tread = Number(v); app.render(); }),
            h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: cycleDir }, `Sube hacia ${sideLabel(stairState.dir, store.project.north)} (X)`),
            stairState.shape === 'straight' ? null : selectT('Gira a', stairState.turn, [['right', 'la derecha'], ['left', 'la izquierda']], (v) => { stairState.turn = v; app.render(); })),
        down(p) {
            const { gx, gy, ok, geo, st } = stairPlacement(p);
            if (!inLot(gx, gy)) return;
            if (!ok) {
                app.setHint('La escalera tiene que quedar dentro de una habitación de la planta baja: probá en una más grande, girala (X) o cambiá la forma.');
                return;
            }
            stairState.dir = st.dir;
            let id = null;
            store.commit('Agregar escalera', (d) => {
                id = nextId(d, 'e');
                d.levels[0].stairs.push({ id, x: gx, y: gy, dir: st.dir, shape: st.shape, w: st.w, tread: st.tread, turn: st.turn });
            });
            // Queda elegida para ajustarla en el panel (forma, giro, posición).
            app.setTool('select');
            store.setUi({ selection: { type: 'stair', id } });
            app.setHint(`Escalera de ${fmt(geo.w / 100)} × ${fmt(geo.h / 100)} m agregada.`);
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
            const { gx, gy, ok: inside, geo: g, st } = stairPlacement(p);
            const ok = { fill: 'rgba(139,197,63,.5)', stroke: '#3f6212' };
            const bad = { fill: 'rgba(217,119,6,.4)', stroke: '#b45309' };
            for (const r of g.steps) ghostBox(ctx, cam, { x0: r[0], y0: r[1], x1: r[2], y1: r[3], z0: 0, z1: 12 }, inside ? ok : bad);
            for (const r of g.landings) ghostBox(ctx, cam, { x0: r[0], y0: r[1], x1: r[2], y1: r[3], z0: 0, z1: 14 }, inside ? ok : bad);
            const [sx, sy] = cam.project(gx * G + g.w / 2, gy * G + g.h / 2, 30);
            label(ctx, `${g.n} contrahuellas de ${fmt(g.rise, 1)} cm · ${fmt(g.w / 100)} × ${fmt(g.h / 100)} m${st.dir !== stairState.dir ? ` · sube hacia ${sideLabel(st.dir, store.project.north, false).toLowerCase()}` : ''}${inside ? '' : ' · no entra en la habitación'}`, sx, sy - 18);
        },
    };

    // ---------------- techo (rectángulo, como una habitación) ----------------
    const roofDefaults = { type: 'gable', dir: 'x', slope: 30, overhang: 40, section: '3x8', spacing: 50, gableT: 20 };
    const FALL_SIDES = ['S', 'N', 'E', 'W'];
    const selectedRoof = () => {
        const sel = store.ui.selection;
        if (!sel || (sel.type !== 'roof' && sel.type !== 'gable')) return null;
        return store.project.roofs?.find((r) => r.id === (sel.type === 'roof' ? sel.id : String(sel.id).split(':')[0])) ?? null;
    };
    let roofDraw = null;
    /** Lado del rectángulo que choca contra un muro del nivel de arriba (N, S, W, E) o null. */
    const wallAbove = (d, r, level) => {
        const up = d.levels[level + 1]?.walls ?? [];
        const cover = (horizontal, line, a0, a1) => up.filter((w) => (horizontal ? w.y1 === w.y2 && w.y1 === line : w.x1 === w.x2 && w.x1 === line))
            .reduce((s, w) => s + Math.max(0, Math.min(a1, horizontal ? w.x2 : w.y2) - Math.max(a0, horizontal ? w.x1 : w.y1)), 0);
        const sides = [['N', cover(true, r.y, r.x, r.x + r.w) / r.w], ['S', cover(true, r.y + r.h, r.x, r.x + r.w) / r.w], ['W', cover(false, r.x, r.y, r.y + r.h) / r.h], ['E', cover(false, r.x + r.w, r.y, r.y + r.h) / r.h]];
        const best = sides.sort((p, q) => q[1] - p[1])[0];
        return best[1] >= 0.5 ? best[0] : null;
    };
    const OPPOSITE = { N: 'S', S: 'N', W: 'E', E: 'W' };
    const newRoof = (d, r, level) => {
        const spec = { ...roofDefaults };
        const against = wallAbove(d, r, level);
        if (against) {
            // Pegado a la planta alta: a un agua, bajando desde esa pared (nunca un faldón que caiga contra ella).
            spec.type = 'shed';
            spec.dir = OPPOSITE[against];
        } else if (spec.type === 'gable') spec.dir = r.w >= r.h ? 'x' : 'y';
        else if (!FALL_SIDES.includes(spec.dir)) spec.dir = 'S';
        // El nivel es orientativo: el servidor lo ajusta a los muros que rodean el rectángulo.
        d.roofs.push({ id: nextId(d, 'r'), level, x: r.x, y: r.y, w: r.w, h: r.h, type: spec.type, dir: spec.dir, slope: spec.slope, overhang: spec.overhang, section: spec.section, spacing: spec.spacing, gableA: true, gableB: true, gableT: spec.gableT });
    };
    /**
     * Habitación que se ve bajo el cursor: se prueba desde el nivel más alto (en isométrica, lo más alto tapa lo de
     * abajo) cortando el rayo con el plano de la corona de cada nivel. Así un clic sobre la planta baja al lado de la alta
     * elige la planta baja, y no un punto corrido sobre el plano de arriba.
     */
    const roofRoomAt = (sx, sy) => {
        for (let level = store.topLevel; level >= 0; level--) {
            const [wx, wy] = app.cam.unproject(sx, sy, (level + 1) * cfg.levelHeight);
            const gx = Math.floor(wx / G);
            const gy = Math.floor(wy / G);
            const room = (store.analysis?.levels?.[level]?.rooms ?? []).find((rm) => rm.fill?.some(([x, y, w, h]) => gx >= x && gx < x + w && gy >= y && gy < y + h));
            if (room) return { room, level };
        }
        return null;
    };

    /** Barra de opciones del techo: edita el techo elegido o, si no hay, los valores de los techos nuevos. */
    const roofOptions = () => {
        const target = selectedRoof();
        const cur = target ? { type: target.type, dir: target.dir, slope: target.slope, overhang: target.overhang, section: target.section, spacing: target.spacing } : roofDefaults;
        const set = (label_, patch) => {
            if (target) store.commit(label_, (d) => Object.assign(d.roofs.find((r) => r.id === target.id), patch));
            else {
                Object.assign(roofDefaults, patch);
                app.refreshOptions();
            }
        };
        const numIn = (label_, value, min, max, step, key, unit) =>
            h('label', { class: 'field-inline' }, label_, h('input', { type: 'number', value, min, max, step, class: 'w-narrow', onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set(label_, { [key]: clamp(v, min, max) }); } }), unit);
        const longer = target ? (target.w >= target.h ? 'x' : 'y') : 'x';
        const types = h('span', { class: 'seg', role: 'group', 'aria-label': 'Tipo de techo' }, [['shed', 'A un agua'], ['gable', 'A dos aguas']].map(([v, t]) =>
            h('button', {
                type: 'button',
                class: 'seg-btn',
                'aria-pressed': String(cur.type === v),
                onclick: () => set('Tipo de techo', { type: v, dir: v === 'shed' ? (['N', 'S', 'E', 'W'].includes(cur.dir) ? cur.dir : 'S') : (['x', 'y'].includes(cur.dir) ? cur.dir : longer) }),
            }, t)));

        return h('span', { class: 'row' }, target ? h('span', { class: 'tag' }, `Techo ${target.id}`) : null, target ? h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => app.deleteSelection() }, 'Quitar techo') : null, types,
            cur.type === 'gable'
                ? selectT('Cumbrera', cur.dir, [['x', '↔ horizontal'], ['y', '↕ vertical']], (v) => set('Dirección de cumbrera', { dir: v }))
                : selectT('Cae hacia', cur.dir, FALL_SIDES.map((d) => [d, sideLabel(d, store.project.north)]), (v) => set('Caída del techo', { dir: v })),
            numIn('Pendiente', cur.slope, 10, 100, 5, 'slope', '%'),
            numIn('Alero', cur.overhang, 0, 100, 5, 'overhang', 'cm'),
            h('span', { class: 'muted small' }, 'Los cabios se eligen solos según la luz.'));
    };
    app.roofOptions = roofOptions;

    T.roof = {
        magnet: true,
        hotkey: 'h',
        label: 'Techo',
        hint: 'Clic sobre una habitación (de la planta alta o de la baja) para techarla, o arrastrá un rectángulo sobre los muros. El techo apoya en los muros que lo rodean.',
        // mientras se arrastra, el plano es el de la corona del nivel donde empezó el rectángulo
        planeZ: () => ((roofDraw?.level ?? store.topLevel) + 1) * cfg.levelHeight,
        options: roofOptions,
        reset() { roofDraw = null; },
        down(p) {
            const hit = roofRoomAt(p.sx, p.sy);
            const level = hit?.level ?? store.topLevel;
            const [wx, wy] = app.cam.unproject(p.sx, p.sy, (level + 1) * cfg.levelHeight);
            const a = { gx: Math.round(wx / G), gy: Math.round(wy / G) };
            roofDraw = { a, level, hit, rect: null, dragged: false, at: { x: p.sx, y: p.sy } };
            store.ui.roofLevel = level; // el imán se pega a los muros de ese nivel
        },
        move(p) {
            if (!roofDraw) return;
            if (Math.hypot(p.sx - roofDraw.at.x, p.sy - roofDraw.at.y) > DRAG_PX) roofDraw.dragged = true;
            roofDraw.rect = roofDraw.dragged ? floorRect(roofDraw.a, p) : null;
            app.render();
        },
        up() {
            if (!roofDraw) return;
            let r = roofDraw.rect;
            const { at, hit: roomHit } = roofDraw;
            let level = roofDraw.level;
            roofDraw = null;
            if (!r) {
                // Un clic sobre un techo existente lo elige (para editarlo o quitarlo) en lugar de dibujar otro encima.
                const hit = pickAt(app, at.x, at.y);
                if (hit) {
                    store.setUi({ selection: hit });
                    return;
                }
                if (!roomHit) {
                    app.toast('Clic sobre una habitación cerrada, o arrastrá un rectángulo sobre los muros.', 'error');
                    return;
                }
                const { room } = roomHit;
                level = roomHit.level;
                r = { x: room.bbox.x, y: room.bbox.y, w: room.bbox.w, h: room.bbox.h };
            }
            if (r.w < 4 || r.h < 4) {
                app.toast('El techo debe medir al menos 50 × 50 cm.', 'error');
                return;
            }
            store.commit('Agregar techo', (d) => newRoof(d, r, level));
        },
        keyDown(e) {
            if (e.key === 'Escape' && roofDraw) {
                roofDraw = null;
                app.render();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            if (roofDraw?.rect) {
                const z = (roofDraw.level + 1) * cfg.levelHeight;
                const { x, y, w, h: hh } = roofDraw.rect;
                outlineRect(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, { stroke: '#7a3b25', fill: 'rgba(196,99,63,.30)', width: 2.5, dash: [6, 4] });
                dimLabel(ctx, cam, x * G, y * G, (x + w) * G, (y + hh) * G, z, `${fmt((w * G) / 100)} × ${fmt((hh * G) / 100)} m · ${fmt(((w * G) / 100) * ((hh * G) / 100))} m² de planta`);
                return;
            }
            const p = app.pointer;
            if (!p) return;
            const hit = roofRoomAt(p.sx, p.sy);
            const z = ((hit?.level ?? store.topLevel) + 1) * cfg.levelHeight;
            if (hit) {
                const { room } = hit;
                outlineRect(ctx, cam, room.bbox.x * G, room.bbox.y * G, (room.bbox.x + room.bbox.w) * G, (room.bbox.y + room.bbox.h) * G, z, { stroke: '#7a3b25', fill: 'rgba(196,99,63,.22)', width: 2 });
            } else if (inLot(p.gx, p.gy)) nodeMarker(ctx, cam, p.gx * G, p.gy * G, z, '#7a3b25');
        },
    };

    // metadatos para la barra de herramientas
    const SHORT = { move: 'Mover', select: 'Elegir', room: 'Habitación', wall: 'Muro', block: 'Bloque', door: 'Puerta', window: 'Ventana', ubeam: 'Viga U', floor: 'Madera', beam: 'Viga madera', slab: 'Losa', stair: 'Escalera', roof: 'Techo', piso: 'Piso' };
    for (const [id, t] of Object.entries(T)) {
        t.id = id;
        t.short = SHORT[id] ?? t.label;
        t.icon = ICONS[id === 'piso' ? 'slab' : id];
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

