/**
 * Herramientas del editor. Cada una implementa (opcionalmente): move / down / up / key / draw / options / reset.
 * Las herramientas sólo arman intenciones (agregar un muro, un vano…); el servidor normaliza, valida y calcula.
 */
import { h } from '../lib/dom.js';
import { fmt } from '../lib/format.js';
import { sideLabel } from '../lib/orient.js';
import { pickAt, pickWall, alongPosition, wallRect, G } from './pick.js';
import { outlineRect, ghostBox, label, nodeMarker } from './overlay.js';
import { nextId } from '../lib/storage.js';
import { ICONS } from './icons.js';
import { moveWallLine, collinearChain, mirrorMove } from './wallmove.js';
import { wallLines, nearestLine, anchorLines, nearestAnchor, snapWalls, ANCHOR_LABEL } from './snap.js';
import { OPENING_TYPES, TYPE_CHOICES, typeOf, modeChoices, openingTitle, defaultMode, newOpening, commercialFor, commercialOf } from './openings.js';
import { roomNamesList, roomTypeItems, nameForType } from './names.js';
import { ZONE_KINDS, TREE_SIZES } from './site.js';
import { footprint, furnitureRect, furnitureGroups, furnitureOn } from './furniture.js';
import { stairCoverage, stairBox, STAIR_BLOCKED } from './stair-fit.js';

const DRAG_PX = 6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wallLen = (w) => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
/** Metros con hasta 3 decimales sin ceros de más (las medidas van de a 12,5 cm): 3,125 · 3,5 · 4. */
const meters = (cmv) => fmt(cmv / 100, 3).replace(/0+$/, '').replace(/,$/, '');

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

    /**
     * Medida exacta de una habitación rectangular: corre su muro derecho (`w`, ancho) o el de abajo (`h`, fondo) hasta
     * que mida `units` (12,5 cm) a ejes. Es el mismo movimiento que arrastrar la manija del muro.
     */
    app.setRoomSize = (roomId, dim, units) => {
        const room = store.analysis?.levels?.[store.ui.level]?.rooms?.find((r) => r.id === roomId);
        if (!room?.rect) return;
        const b = room.bbox;
        const wall = dim === 'w'
            ? store.level().walls.find((w) => w.x1 === w.x2 && w.x1 === b.x + b.w && w.y1 < b.y + b.h && w.y2 > b.y)
            : store.level().walls.find((w) => w.y1 === w.y2 && w.y1 === b.y + b.h && w.x1 < b.x + b.w && w.x2 > b.x);
        if (!wall) return;
        if (!wallMoveCommit(wall.id, (dim === 'w' ? b.x : b.y) + Math.max(4, units))) return;
        // El servidor renumera los ambientes: al volver, se elige de nuevo el que quedó en ese lugar.
        store.addEventListener('change', () => {
            const again = store.analysis?.levels?.[store.ui.level]?.rooms?.find((r) => r.fill?.some(([x, y, w, hh]) => b.x + 1 >= x && b.x + 1 < x + w && b.y + 1 >= y && b.y + 1 < y + hh));
            if (again) store.setUi({ selection: { type: 'room', id: again.id } });
        }, { once: true });
    };

    /** Rectángulo de un techo (con su cota de apoyo) o null. */
    const roofRect = (id) => store.project.roofs?.find((r) => r.id === id) ?? null;

    /** Manijas de la selección: muro (perpendicular), esquinas de un ambiente, esquinas y bordes de un techo o lados de una zona. */
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
        } else if (sel.type === 'zone' && store.ui.level <= 1) {
            const z = store.project.zones?.find((q) => q.id === sel.id);
            for (const [side, cx, cy] of z ? [['y0', z.x + z.w / 2, z.y], ['x1', z.x + z.w, z.y + z.h / 2], ['y1', z.x + z.w / 2, z.y + z.h], ['x0', z.x, z.y + z.h / 2]] : []) {
                const [sx, sy] = cam.project(cx * G, cy * G, 0.5);
                out.push({ kind: 'zside', sx, sy, side, z });
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
        } else if (hd.kind === 'rside' || hd.kind === 'zside') {
            // borde de techo o lado de zona: círculo azul chico
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

    // ---------------- muebles: lugar y fantasma (los usan Elegir y la herramienta Mueble) ----------------
    /** Esquina (unidades) para un mueble cuya esquina se quiere en (ux, uy): en la retícula de 12,5 cm y dentro del lote. */
    const furnitureSpot = (m, ux, uy) => {
        const s = footprint(cfg, m);
        return [clamp(Math.round(ux), 0, Math.max(0, Math.floor(lot().w - s.w / G))), clamp(Math.round(uy), 0, Math.max(0, Math.floor(lot().d - s.d / G)))];
    };
    const furnitureGhost = (ctx, cam, m, style) => {
        const r = furnitureRect(cfg, m);
        if (r) ghostBox(ctx, cam, { x0: r[0], y0: r[1], x1: r[2], y1: r[3], z0: base(), z1: base() + footprint(cfg, m).h }, style);
    };

    // ---------------- elegir varios elementos y moverlos juntos ----------------
    /** Elementos cuya planta cae dentro del rectángulo (unidades), en todos los niveles: se mueven juntos, de arriba abajo. */
    const collectIn = (x0, y0, x1, y1) => {
        const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const sel = { walls: [], stairs: [], slabs: [], timber: [], roofs: [], columns: [], labels: [], furniture: [] };
        store.project.levels.forEach((lv, li) => {
            for (const m of furnitureOn(store.ui) ? lv.furniture ?? [] : []) {
                const r = furnitureRect(cfg, m);
                if (r && inside(r[0] / G, r[1] / G) && inside(r[2] / G, r[3] / G)) sel.furniture.push([li, m.id]);
            }
            for (const w of lv.walls) if (inside(w.x1, w.y1) && inside(w.x2, w.y2)) sel.walls.push([li, w.id]);
            for (const sl of lv.slabs ?? []) if (inside(sl.x, sl.y) && inside(sl.x + sl.w, sl.y + sl.h)) sel.slabs.push([li, sl.id]);
            for (const st of lv.stairs ?? []) {
                const b = store.analysis?.floors?.stairs?.find((q) => q.id === st.id)?.bbox;
                if (b && inside(b.x / G, b.y / G) && inside((b.x + b.w) / G, (b.y + b.h) / G)) sel.stairs.push([li, st.id]);
            }
            for (const c of lv.columns ?? []) if (inside(c.x, c.y)) sel.columns.push([li, c.id]);
            for (const lb of lv.labels ?? []) if (inside(lb.x, lb.y)) sel.labels.push([li, lb.id]);
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
        for (const [li, id] of sel.columns) { const c = p.levels[li].columns.find((z) => z.id === id); if (c) { xs.push(c.x); ys.push(c.y); } }
        for (const [li, id] of sel.labels) { const lb = p.levels[li].labels.find((z) => z.id === id); if (lb) { xs.push(lb.x); ys.push(lb.y); } }
        for (const [li, id] of sel.furniture ?? []) { const r = furnitureRect(cfg, p.levels[li].furniture?.find((z) => z.id === id) ?? {}); if (r) { xs.push(r[0] / G, r[2] / G); ys.push(r[1] / G, r[3] / G); } }
        for (const [, id] of sel.roofs) { const r = p.roofs.find((z) => z.id === id); if (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); } }
        for (const [, id] of sel.stairs) { const b = store.analysis?.floors?.stairs?.find((q) => q.id === id)?.bbox; if (b) { xs.push(b.x / G, (b.x + b.w) / G); ys.push(b.y / G, (b.y + b.h) / G); } }
        return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : null;
    };
    /** Grupo elegido con un rectángulo (`sel`), rectángulo en curso (`band`), arrastre del grupo (`drag`) y clic pendiente (`press`). */
    const multi = { sel: null, band: null, drag: null, press: null, paste: null };
    const clampOffset = (box, dx, dy) => ({
        dx: Math.max(-box.x0, Math.min(lot().w - box.x1, dx)),
        dy: Math.max(-box.y0, Math.min(lot().d - box.y1, dy)),
    });
    const applyMove = (sel, dx, dy) =>
        store.commit('Mover', (d) => {
            for (const [li, id] of sel.walls) { const w = d.levels[li].walls.find((q) => q.id === id); if (w) { w.x1 += dx; w.x2 += dx; w.y1 += dy; w.y2 += dy; } }
            for (const [li, id] of sel.slabs) { const q = d.levels[li].slabs.find((z) => z.id === id); if (q) { q.x += dx; q.y += dy; } }
            for (const [li, id] of sel.stairs) { const q = d.levels[li].stairs.find((z) => z.id === id); if (q) { q.x += dx; q.y += dy; } }
            for (const [li, id] of sel.columns) { const q = d.levels[li].columns.find((z) => z.id === id); if (q) { q.x += dx; q.y += dy; } }
            for (const [li, id] of sel.labels) { const q = d.levels[li].labels.find((z) => z.id === id); if (q) { q.x += dx; q.y += dy; } }
            for (const [li, id] of sel.furniture ?? []) { const q = d.levels[li].furniture?.find((z) => z.id === id); if (q) { q.x += dx; q.y += dy; } }
            for (const [li, id] of sel.timber) {
                const t = d.levels[li].timber.find((z) => z.id === id);
                if (!t) continue;
                if (t.kind === 'beam') { t.x1 += dx; t.x2 += dx; t.y1 += dy; t.y2 += dy; } else { t.x += dx; t.y += dy; }
            }
            for (const [, id] of sel.roofs) { const r = d.roofs.find((z) => z.id === id); if (r) { r.x += dx; r.y += dy; } }
        });
    /**
     * Corre el grupo elegido, de a un movimiento por vez: el servidor normaliza los muros (los parte o los une y cambian
     * sus ids), así que al terminar el grupo se vuelve a elegir con la caja ya corrida.
     */
    /**
     * Mueve lo elegido, pero una escalera no puede quedar atravesando un muro ni fuera de la planta baja: si con el
     * movimiento queda menos dentro de una habitación que antes, se deshace. Se mira después del cálculo porque los
     * muros elegidos se mueven con ella. Devuelve false si se deshizo.
     */
    const guardedMove = async (sel, dx, dy) => {
        const cover = (id) => { const b = stairBox(store.analysis, id); return b ? stairCoverage(store.analysis, b) : 1; };
        const before = sel.stairs.map(([, id]) => cover(id));
        await applyMove(sel, dx, dy);
        if (store.fresh && sel.stairs.some(([, id], i) => cover(id) < before[i] - 1e-6)) {
            await store.undo();
            app.toast(STAIR_BLOCKED);
            return false;
        }
        return true;
    };
    let moving = Promise.resolve();
    const moveMulti = (dx, dy) => {
        moving = moving.then(async () => {
            const box = multi.sel && selBox(multi.sel);
            if (!box) return;
            const o = clampOffset(box, dx, dy);
            if (!o.dx && !o.dy) return;
            if (!(await guardedMove(multi.sel, o.dx, o.dy))) return;
            if (multi.sel) setMulti(collectIn(box.x0 + o.dx, box.y0 + o.dy, box.x1 + o.dx, box.y1 + o.dy));
        });
    };
    const setMulti = (sel) => {
        multi.sel = countSel(sel) ? sel : null;
        if (multi.sel) store.setUi({ selection: null });
        app.refreshOptions();
        app.render();
    };
    const selectAll = () => setMulti(collectIn(-1e4, -1e4, 1e4, 1e4));
    app.selectAll = selectAll;
    app.multiCount = () => countSel(multi.sel);
    /** El punto (unidades) cae sobre el grupo elegido: se arrastra en vez de elegir otra cosa. */
    const onMulti = (ux, uy) => {
        const box = multi.sel && selBox(multi.sel);
        return box && ux >= box.x0 - 1 && ux <= box.x1 + 1 && uy >= box.y0 - 1 && uy <= box.y1 + 1 ? box : null;
    };
    const bandZ = () => (store.ui.level === 2 ? (store.topLevel + 1) * cfg.levelHeight : base());

    /** Dibujo del rectángulo en curso y del grupo elegido (corrido por el arrastre). */
    const drawMulti = (ctx, cam) => {
        if (multi.band) {
            const [ax, ay] = multi.band.a;
            const [bx, by] = multi.band.b;
            outlineRect(ctx, cam, Math.min(ax, bx) * G, Math.min(ay, by) * G, Math.max(ax, bx) * G, Math.max(ay, by) * G, bandZ(), { stroke: '#2563eb', fill: 'rgba(37,99,235,.10)', width: 1.5, dash: [5, 4] });
        }
        const sel = multi.sel;
        if (!sel) return;
        const box = selBox(sel);
        if (!box) return;
        const dx = multi.drag?.dx ?? 0;
        const dy = multi.drag?.dy ?? 0;
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
        label(ctx, dx || dy ? `→ ${fmt((dx * G) / 100)} m · ↓ ${fmt((dy * G) / 100)} m` : `${countSel(sel)} elemento${countSel(sel) > 1 ? 's' : ''} · arrastrá para mover`, sx, sy, { bg: 'rgba(37,99,235,.92)' });
    };

    // ---------------- copiar y pegar ----------------
    /** Portapapeles en memoria: copias de los objetos (no ids), con su nivel y la caja (unidades) que ocupan. */
    let clip = null;
    const CLIP_KINDS = ['walls', 'slabs', 'stairs', 'timber', 'columns', 'labels', 'furniture', 'roofs', 'zones', 'trees'];
    const clipCount = (c) => CLIP_KINDS.reduce((n, k) => n + c[k].length, 0);
    /** Lo elegido como grupo: el del rectángulo o el elemento suelto (una abertura sola se trata aparte). */
    const selectionGroup = () => multi.sel ?? (store.ui.selection ? groupOf(store.ui.selection) : null);
    /** Un elemento suelto ({ type, id }) como grupo, para moverlo o copiarlo con lo mismo que un grupo. */
    const groupOf = (s) => {
        const sel = { walls: [], stairs: [], slabs: [], timber: [], roofs: [], columns: [], labels: [], furniture: [], zones: [], trees: [] };
        const key = { wall: 'walls', stair: 'stairs', slab: 'slabs', timber: 'timber', column: 'columns', label: 'labels', furniture: 'furniture' }[s.type];
        if (key) {
            const li = store.project.levels.findIndex((lv) => (lv[key] ?? []).some((q) => q.id === s.id));
            if (li >= 0) sel[key].push([li, s.id]);
        } else if (s.type === 'roof' || s.type === 'gable') sel.roofs.push([0, s.type === 'roof' ? s.id : String(s.id).split(':')[0]]);
        else if (s.type === 'zone') sel.zones.push([0, s.id]);
        else if (s.type === 'tree') sel.trees.push([0, s.id]);
        return countSel(sel) ? sel : null;
    };
    const copySelection = () => {
        const p = store.project;
        const s = store.ui.selection;
        if (!multi.sel && s?.type === 'opening') {
            const o = store.level().openings.find((q) => q.id === s.id);
            if (!o) return false;
            clip = { opening: structuredClone(o), level: store.ui.level };
            app.toast('Abertura copiada: elegí un muro y Ctrl+V la pone ahí (sin elegir otro, la repite en el mismo muro).');
            return true;
        }
        const sel = selectionGroup();
        if (!sel) {
            app.toast('Elegí algo para copiar (un elemento, o varios con un rectángulo).');
            return false;
        }
        const c = Object.fromEntries(CLIP_KINDS.map((k) => [k, []]));
        const xs = [];
        const ys = [];
        const grab = (x, y) => { xs.push(x); ys.push(y); };
        for (const [li, id] of sel.walls) {
            const lv = p.levels[li];
            const w = lv.walls.find((q) => q.id === id);
            if (!w) continue;
            c.walls.push({ li, o: structuredClone(w), openings: structuredClone(lv.openings.filter((q) => q.wall === id)), ubeams: structuredClone((lv.ubeams ?? []).filter((q) => q.wall === id)) });
            grab(w.x1, w.y1);
            grab(w.x2, w.y2);
        }
        for (const [li, id] of sel.slabs) { const q = p.levels[li].slabs.find((z) => z.id === id); if (q) { c.slabs.push({ li, o: structuredClone(q) }); grab(q.x, q.y); grab(q.x + q.w, q.y + q.h); } }
        for (const [li, id] of sel.stairs) {
            const q = p.levels[li].stairs.find((z) => z.id === id);
            const b = store.analysis?.floors?.stairs?.find((z) => z.id === id)?.bbox;
            if (!q) continue;
            const box = b ? [b.x / G, b.y / G, (b.x + b.w) / G, (b.y + b.h) / G] : [q.x, q.y, q.x, q.y];
            c.stairs.push({ li, o: structuredClone(q), box });
            grab(box[0], box[1]);
            grab(box[2], box[3]);
        }
        for (const [li, id] of sel.timber) {
            const t = p.levels[li].timber.find((z) => z.id === id);
            if (!t) continue;
            c.timber.push({ li, o: structuredClone(t) });
            if (t.kind === 'beam') { grab(t.x1, t.y1); grab(t.x2, t.y2); } else { grab(t.x, t.y); grab(t.x + t.w, t.y + t.h); }
        }
        for (const [li, id] of sel.columns) { const q = p.levels[li].columns.find((z) => z.id === id); if (q) { c.columns.push({ li, o: structuredClone(q) }); grab(q.x, q.y); } }
        for (const [li, id] of sel.labels) { const q = p.levels[li].labels.find((z) => z.id === id); if (q) { c.labels.push({ li, o: structuredClone(q) }); grab(q.x, q.y); } }
        for (const [li, id] of sel.furniture ?? []) {
            const q = p.levels[li].furniture?.find((z) => z.id === id);
            const r = q && furnitureRect(cfg, q);
            if (r) { c.furniture.push({ li, o: structuredClone(q) }); grab(r[0] / G, r[1] / G); grab(r[2] / G, r[3] / G); }
        }
        for (const [, id] of sel.roofs) { const r = p.roofs.find((z) => z.id === id); if (r) { c.roofs.push({ o: structuredClone(r) }); grab(r.x, r.y); grab(r.x + r.w, r.y + r.h); } }
        for (const [, id] of sel.zones ?? []) { const z = p.zones?.find((q) => q.id === id); if (z) { c.zones.push({ o: structuredClone(z) }); grab(z.x, z.y); grab(z.x + z.w, z.y + z.h); } }
        for (const [, id] of sel.trees ?? []) { const t = p.trees?.find((q) => q.id === id); if (t) { c.trees.push({ o: structuredClone(t) }); grab(t.x, t.y); } }
        const n = clipCount(c);
        if (!n) return false;
        // Si los muros, pilares y nombres son de un solo nivel, se pueden pegar en el otro (repetir la planta arriba).
        const levels = new Set([...c.walls, ...c.columns, ...c.labels, ...c.furniture].map((it) => it.li));
        clip = { ...c, single: levels.size === 1 ? [...levels][0] : null, box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
        app.toast(`${n} elemento${n > 1 ? 's' : ''} copiado${n > 1 ? 's' : ''}: Ctrl+V para pegar.`);
        return true;
    };
    /**
     * Pega la abertura copiada (mismo tipo y medidas) en el muro elegido, en el lugar libre más cercano al centro; si no
     * hay otro muro elegido, la repite en el mismo muro, lo más cerca de la original. Jambas ≥ 25 cm (las del servidor).
     */
    const pasteOpening = () => {
        const li = store.ui.level;
        const o = clip.opening;
        const s = store.ui.selection;
        // el muro elegido, o el de la abertura elegida (así Ctrl+V seguidos van repitiendo en el último muro)
        const pickedId = s?.type === 'wall' ? s.id : s?.type === 'opening' ? s.wall : null;
        const picked = pickedId ? store.level().walls.find((w) => w.id === pickedId) : null;
        const wall = picked ?? (li === clip.level ? store.level().walls.find((w) => w.id === o.wall) : null);
        const info = wall ? store.analysis?.levels?.[li]?.walls?.[wall.id] : null;
        if (!wall || !info) {
            app.toast('Elegí el muro donde pegar la abertura y apretá Ctrl+V.', 'error');
            return;
        }
        const desired = wall.id === o.wall ? o.pos : (wallLen(wall) - o.w) / 2;
        let best = null;
        for (const [from, to] of info.slots) {
            if (to - from < o.w) continue;
            const pos = clamp(Math.round(desired), from, to - o.w);
            if (best === null || Math.abs(pos - desired) < Math.abs(best - desired)) best = pos;
        }
        if (best === null) {
            app.toast(`No hay lugar libre de ${fmt(o.w * G, 1)} cm en ese muro.`, 'error');
            return;
        }
        let id = null;
        store.commit(`Pegar ${openingTitle(o).toLowerCase()}`, (d) => {
            id = nextId(d, 'o');
            d.levels[li].openings.push({ ...structuredClone(o), id, wall: wall.id, pos: best });
        }).then(() => store.setUi({ selection: { type: 'opening', id, wall: wall.id } }));
    };
    /** Nivel donde se pegan muros, pilares y nombres si lo copiado es de un solo nivel y el activo es otro; si no, null. */
    const pasteTarget = () => (clip.single !== null && store.ui.level <= 1 && store.ui.level !== clip.single ? store.ui.level : null);
    const pasteOffset = (p) => {
        const b = clip.box;
        return clampOffset(b, Math.round((p.wx / G - (b.x0 + b.x1) / 2) / BU) * BU, Math.round((p.wy / G - (b.y0 + b.y1) / 2) / BU) * BU);
    };
    /** Ctrl+V: el grupo copiado sigue al cursor (de a bloques enteros) hasta que un clic lo coloca. */
    const startPaste = () => {
        if (!clip) {
            app.toast('No hay nada copiado (Ctrl+C).');
            return;
        }
        if (store.ui.tool !== 'select') app.setTool('select');
        if (clip.opening) {
            pasteOpening();
            return;
        }
        multi.band = null;
        multi.drag = null;
        multi.press = null;
        multi.paste = { ...(app.pointer ? pasteOffset(app.pointer) : clampOffset(clip.box, 2 * BU, 2 * BU)), target: pasteTarget() };
        app.setHint('Mové el grupo copiado y hacé clic para pegarlo. Esc cancela.');
        app.render();
    };
    const commitPaste = () => {
        const { dx, dy, target } = multi.paste;
        if (target === null && !dx && !dy) {
            app.toast('Mové la copia a otro lugar antes de pegarla.', 'error');
            return;
        }
        multi.paste = null;
        const c = clip;
        const b = c.box;
        const lvl = (li) => target ?? li;
        const skipped = target === null ? 0 : c.slabs.length + c.stairs.length + c.timber.length + c.roofs.length + c.zones.length + c.trees.length;
        let single = null;
        store.commit('Pegar', (d) => {
            for (const it of c.walls) {
                const lv = d.levels[lvl(it.li)];
                const id = nextId(d, 'w');
                lv.walls.push({ ...it.o, id, x1: it.o.x1 + dx, x2: it.o.x2 + dx, y1: it.o.y1 + dy, y2: it.o.y2 + dy });
                for (const o of it.openings) lv.openings.push({ ...o, id: nextId(d, 'o'), wall: id });
                for (const u of it.ubeams) (lv.ubeams ??= []).push({ ...u, id: nextId(d, 'u'), wall: id });
            }
            for (const it of c.columns) (d.levels[lvl(it.li)].columns ??= []).push({ ...it.o, id: nextId(d, 'c'), x: it.o.x + dx, y: it.o.y + dy });
            for (const it of c.labels) (d.levels[lvl(it.li)].labels ??= []).push({ ...it.o, id: nextId(d, 'n'), x: it.o.x + dx, y: it.o.y + dy });
            for (const it of c.furniture) { single = { type: 'furniture', id: nextId(d, 'm') }; (d.levels[lvl(it.li)].furniture ??= []).push({ ...it.o, id: single.id, x: it.o.x + dx, y: it.o.y + dy }); }
            if (target !== null) return;
            for (const it of c.slabs) d.levels[it.li].slabs.push({ ...it.o, id: nextId(d, 'l'), x: it.o.x + dx, y: it.o.y + dy });
            for (const it of c.stairs) d.levels[it.li].stairs.push({ ...it.o, id: nextId(d, 'e'), x: it.o.x + dx, y: it.o.y + dy });
            for (const it of c.timber) {
                const t = { ...it.o, id: nextId(d, 't') };
                if (t.kind === 'beam') Object.assign(t, { x1: t.x1 + dx, x2: t.x2 + dx, y1: t.y1 + dy, y2: t.y2 + dy });
                else Object.assign(t, { x: t.x + dx, y: t.y + dy });
                d.levels[it.li].timber.push(t);
            }
            for (const it of c.roofs) (d.roofs ??= []).push({ ...it.o, id: nextId(d, 'r'), x: it.o.x + dx, y: it.o.y + dy });
            for (const it of c.zones) { single = { type: 'zone', id: nextId(d, 'z') }; (d.zones ??= []).push({ ...it.o, id: single.id, x: it.o.x + dx, y: it.o.y + dy }); }
            for (const it of c.trees) { single = { type: 'tree', id: nextId(d, 'a') }; (d.trees ??= []).push({ ...it.o, id: single.id, x: it.o.x + dx, y: it.o.y + dy }); }
        }).then(() => {
            // Queda elegido lo pegado, para seguir moviéndolo (zonas y árboles no entran en un grupo: se elige el suelto).
            setMulti(collectIn(b.x0 + dx, b.y0 + dy, b.x1 + dx, b.y1 + dy));
            if (!multi.sel && single) store.setUi({ selection: single });
        });
        if (skipped) app.toast(`Se pegaron muros, pilares y nombres en el ${cfg.levelShort?.[target] ?? 'nivel'}; ${skipped} elemento(s) de otro tipo no se copian entre niveles.`);
        app.refreshOptions();
    };
    const duplicateSelection = () => { if (copySelection()) startPaste(); };
    app.copySelection = copySelection;
    app.pickAt = (sx, sy) => pickAt(app, sx, sy); // para las pruebas de punta a punta
    app.pasteClipboard = startPaste;
    app.duplicateSelection = duplicateSelection;

    /** Fantasma del grupo que se está por pegar, corrido por el cursor. */
    const drawPaste = (ctx, cam) => {
        const ps = multi.paste;
        if (!ps) return;
        const { dx, dy, target } = ps;
        const style = { fill: 'rgba(37,99,235,.18)', stroke: 'rgba(37,99,235,.7)', width: 1 };
        const flat = { stroke: '#2563eb', fill: 'rgba(37,99,235,.12)', width: 1.5, dash: [6, 4] };
        for (const it of clip.walls) {
            const w = it.o;
            const zb = (target ?? it.li) * cfg.levelHeight;
            const t = w.t / 2;
            const x0 = (w.x1 + dx) * G;
            const x1 = (w.x2 + dx) * G;
            const y0 = (w.y1 + dy) * G;
            const y1 = (w.y2 + dy) * G;
            ghostBox(ctx, cam, w.y1 === w.y2 ? { x0, x1, y0: y0 - t, y1: y1 + t, z0: zb, z1: zb + (w.h ?? 12) * 25 } : { x0: x0 - t, x1: x1 + t, y0, y1, z0: zb, z1: zb + (w.h ?? 12) * 25 }, style);
        }
        for (const it of clip.columns) {
            const zb = (target ?? it.li) * cfg.levelHeight;
            const s = it.o.size / 2;
            ghostBox(ctx, cam, { x0: (it.o.x + dx) * G - s, x1: (it.o.x + dx) * G + s, y0: (it.o.y + dy) * G - s, y1: (it.o.y + dy) * G + s, z0: zb, z1: zb + cfg.levelHeight }, style);
        }
        for (const it of clip.furniture) {
            const r = furnitureRect(cfg, it.o);
            const zb = (target ?? it.li) * cfg.levelHeight;
            if (r) ghostBox(ctx, cam, { x0: r[0] + dx * G, x1: r[2] + dx * G, y0: r[1] + dy * G, y1: r[3] + dy * G, z0: zb, z1: zb + footprint(cfg, it.o).h }, style);
        }
        if (target === null) {
            for (const it of clip.roofs) outlineRect(ctx, cam, (it.o.x + dx) * G, (it.o.y + dy) * G, (it.o.x + it.o.w + dx) * G, (it.o.y + it.o.h + dy) * G, (it.o.level + 1) * cfg.levelHeight, flat);
            for (const it of clip.slabs) outlineRect(ctx, cam, (it.o.x + dx) * G, (it.o.y + dy) * G, (it.o.x + it.o.w + dx) * G, (it.o.y + it.o.h + dy) * G, cfg.levelHeight, flat);
            for (const it of clip.zones) outlineRect(ctx, cam, (it.o.x + dx) * G, (it.o.y + dy) * G, (it.o.x + it.o.w + dx) * G, (it.o.y + it.o.h + dy) * G, 0.5, flat);
            for (const it of clip.stairs) outlineRect(ctx, cam, (it.box[0] + dx) * G, (it.box[1] + dy) * G, (it.box[2] + dx) * G, (it.box[3] + dy) * G, 0.5, flat);
            for (const it of clip.trees) treeRing(ctx, cam, it.o.x + dx, it.o.y + dy, it.o.size, '#2563eb');
        }
        const b = clip.box;
        const z = (target ?? 0) * cfg.levelHeight;
        outlineRect(ctx, cam, (b.x0 + dx) * G, (b.y0 + dy) * G, (b.x1 + dx) * G, (b.y1 + dy) * G, z, { stroke: '#2563eb', width: 2, dash: [8, 5] });
        const [sx, sy] = cam.project(((b.x0 + b.x1) / 2 + dx) * G, ((b.y0 + b.y1) / 2 + dy) * G, z);
        label(ctx, `Clic para pegar${target === null ? ` · → ${fmt((dx * G) / 100)} m · ↓ ${fmt((dy * G) / 100)} m` : ` en el ${cfg.levelShort?.[target] ?? 'nivel'}`}`, sx, sy, { bg: 'rgba(37,99,235,.92)' });
    };

    /** Clic sin arrastre: elige lo que hay bajo el puntero (doble clic, la habitación). */
    const pickClick = (p, detail) => {
        app.hover = pickAt(app, p.sx, p.sy);
        // Doble clic: la habitación de ese lugar (aunque un muro de adelante tape el piso en la vista isométrica).
        if (detail >= 2 && store.ui.level <= 1) {
            const [wx, wy] = app.cam.unproject(p.sx, p.sy, base());
            const room = store.analysis?.levels?.[store.ui.level]?.rooms?.find((r) => r.fill?.some(([x, y, w, h]) => wx / G >= x && wx / G < x + w && wy / G >= y && wy / G < y + h));
            if (room) app.hover = { type: 'room', id: room.id };
        }
        store.setUi({ selection: app.hover });
    };

    // ---------------- elegir ----------------
    T.select = {
        hotkey: 'v',
        label: 'Elegir',
        hint: `Clic en una pieza para elegirla; doble clic elige la habitación. Aberturas, pilares, muebles, escaleras, zonas, árboles y nombres se mueven arrastrándolos; un muro, una losa, un entrepiso o un techo, arrastrándolo una vez elegido. Arrastrá un rectángulo para elegir varios elementos y después movelos juntos (flechas: ${fmt(BL, 1)} cm). Ctrl+C / Ctrl+V copian y pegan lo elegido.`,
        options: () => {
            const n = countSel(multi.sel);
            return h('span', { class: 'row' },
                h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: selectAll }, 'Toda la casa (Ctrl+A)'),
                n || store.ui.selection ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', title: 'Copia lo elegido y lo deja listo para colocar (Ctrl+C y Ctrl+V hacen lo mismo en dos pasos)', onclick: duplicateSelection }, 'Duplicar (Ctrl+D)') : null,
                n ? h('span', { class: 'tag' }, `${n} elemento${n > 1 ? 's' : ''} elegido${n > 1 ? 's' : ''}`) : null,
                n ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => setMulti(null) }, 'Soltar') : null);
        },
        reset() {
            drag = null;
            multi.band = null;
            multi.drag = null;
            multi.press = null;
            multi.paste = null;
        },
        move(p) {
            if (multi.paste) {
                Object.assign(multi.paste, pasteOffset(p));
                app.render();
                return;
            }
            if (multi.drag) {
                const d = multi.drag;
                const raw = { dx: Math.round((p.wx - d.x0) / G / BU) * BU, dy: Math.round((p.wy - d.y0) / G / BU) * BU };
                Object.assign(d, clampOffset(d.box, raw.dx, raw.dy));
                app.render();
                return;
            }
            if (multi.press?.item && Math.hypot(p.sx - multi.press.sx, p.sy - multi.press.sy) > DRAG_PX) {
                // las piezas se mueven arrastrándolas
                const { type, id } = multi.press.item;
                const press = multi.press;
                const lv = store.level();
                multi.press = null;
                if (type === 'opening') {
                    const o = lv.openings.find((q) => q.id === id);
                    if (o) drag = { kind: 'opening', o: { ...o }, spot: null };
                } else if (type === 'column') {
                    const c = lv.columns?.find((q) => q.id === id);
                    if (c) drag = { kind: 'column', c: { ...c }, nx: c.x, ny: c.y };
                } else if (type === 'furniture') {
                    const m = lv.furniture?.find((q) => q.id === id);
                    if (m) drag = { kind: 'furniture', m: { ...m }, off: [press.wx / G - m.x, press.wy / G - m.y], nx: m.x, ny: m.y };
                } else if (type === 'label') {
                    const lb = lv.labels?.find((q) => q.id === id);
                    if (lb) drag = { kind: 'label', lb: { ...lb }, nx: lb.x, ny: lb.y };
                } else if (type === 'tree') {
                    const t = store.project.trees?.find((q) => q.id === id);
                    if (t) drag = { kind: 'tree', t: { ...t }, nx: t.x, ny: t.y };
                } else if (type === 'zone') {
                    const z = store.project.zones?.find((q) => q.id === id);
                    if (z) drag = { kind: 'zone', z: { ...z }, off: [press.wx / G - z.x, press.wy / G - z.y], nx: z.x, ny: z.y };
                } else if (type === 'wall') {
                    // igual que su manija: el muro se corre perpendicular a sí mismo
                    const w = lv.walls.find((q) => q.id === id);
                    if (w) {
                        const horizontal = w.y1 === w.y2;
                        const line0 = horizontal ? w.y1 : w.x1;
                        const chain = new Set(collinearChain(lv.walls, w).map((q) => q.id));
                        drag = { kind: 'wall', w, horizontal, line0, line: line0, x0: press.wx, y0: press.wy, ...anchorsFor({ exclude: chain }) };
                    }
                } else if (['stair', 'slab', 'timber', 'roof'].includes(type)) {
                    // escaleras, losas, entrepisos, vigas y techos: se corren enteros, de a 12,5 cm, dentro del terreno
                    const sel = groupOf({ type, id });
                    const box = sel && selBox(sel);
                    const z = type === 'roof' ? ((roofRect(id)?.level ?? 0) + 1) * cfg.levelHeight : type === 'stair' ? 0.5 : cfg.levelHeight;
                    if (box) drag = { kind: 'shift', sel, box, dx: 0, dy: 0, x0: press.wx, y0: press.wy, z };
                }
                if (drag) {
                    store.setUi({ selection: type === 'opening' ? { type, id, wall: drag.o.wall } : { type, id } });
                    app.canvas.style.cursor = 'grabbing';
                }
            }
            if (multi.press && !multi.band && Math.hypot(p.sx - multi.press.sx, p.sy - multi.press.sy) > DRAG_PX) {
                // el clic se volvió arrastre: rectángulo de selección desde donde se apretó
                multi.band = { a: [multi.press.wx / G, multi.press.wy / G], b: [p.wx / G, p.wy / G] };
                app.hover = null;
            }
            if (multi.band) {
                multi.band.b = [p.wx / G, p.wy / G];
                app.render();
                return;
            }
            if (drag) {
                if (drag.kind === 'opening') drag.spot = openingSpot(p, drag.o.w, drag.o) ?? drag.spot; // fuera de un muro queda el último lugar
                else if (drag.kind === 'column') {
                    drag.nx = Math.round(p.wx / G);
                    drag.ny = Math.round(p.wy / G);
                } else if (drag.kind === 'furniture') {
                    [drag.nx, drag.ny] = furnitureSpot(drag.m, p.wx / G - drag.off[0], p.wy / G - drag.off[1]);
                } else if (drag.kind === 'tree') {
                    drag.nx = Math.round(p.wx / G);
                    drag.ny = Math.round(p.wy / G);
                } else if (drag.kind === 'zone') {
                    drag.nx = clamp(Math.round(p.wx / G - drag.off[0]), 0, lot().w - drag.z.w);
                    drag.ny = clamp(Math.round(p.wy / G - drag.off[1]), 0, lot().d - drag.z.h);
                } else if (drag.kind === 'label') {
                    drag.nx = Math.floor(p.wx / G);
                    drag.ny = Math.floor(p.wy / G);
                } else if (drag.kind === 'zside') {
                    // el lado opuesto queda fijo y la zona no baja de 25 cm
                    const x = drag.side[0] === 'x';
                    const z = drag.z;
                    const v = clamp(Math.round((x ? p.wx : p.wy) / G), 0, x ? lot().w : lot().d);
                    drag.nv = drag.side[1] === '0' ? Math.min(v, (x ? z.x + z.w : z.y + z.h) - 2) : Math.max(v, (x ? z.x : z.y) + 2);
                } else if (drag.kind === 'shift') {
                    Object.assign(drag, clampOffset(drag.box, Math.round((p.wx - drag.x0) / G), Math.round((p.wy - drag.y0) / G)));
                } else if (drag.kind === 'wall') drag.line = snapAxis(p, drag.horizontal ? 'ay' : 'ax', drag.line0);
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
            app.canvas.style.cursor = handleHit(p) || onMulti(p.wx / G, p.wy / G) ? 'grab' : '';
            const hit = pickAt(app, p.sx, p.sy);
            if (JSON.stringify(hit) !== JSON.stringify(app.hover)) {
                app.hover = hit;
                app.render();
            }
        },
        down(p, e) {
            if (multi.paste) {
                Object.assign(multi.paste, pasteOffset(p));
                commitPaste();
                return;
            }
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
                } else if (hd.kind === 'zside') {
                    const z = hd.z;
                    const v0 = { x0: z.x, x1: z.x + z.w, y0: z.y, y1: z.y + z.h }[hd.side];
                    drag = { kind: 'zside', z, side: hd.side, v0, nv: v0 };
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
            const box = onMulti(p.wx / G, p.wy / G);
            if (box) {
                multi.drag = { x0: p.wx, y0: p.wy, box, dx: 0, dy: 0 };
                app.canvas.style.cursor = 'grabbing';
                return;
            }
            // Se decide al soltar: sin moverse es un clic (elige lo de abajo); arrastrando, un rectángulo.
            const under = pickAt(app, p.sx, p.sy);
            // Las piezas sueltas se arrastran directo; un muro, una losa, un entrepiso o un techo, sólo si ya está elegido
            // (son grandes: apretar sobre ellos y arrastrar sigue siendo el rectángulo de selección).
            const chosen = store.ui.selection;
            const grab = ['opening', 'column', 'label', 'tree', 'zone', 'furniture', 'stair'].includes(under?.type)
                || (['wall', 'slab', 'timber', 'roof'].includes(under?.type) && chosen?.type === under.type && chosen.id === under.id);
            multi.press = { sx: p.sx, sy: p.sy, wx: p.wx, wy: p.wy, detail: e?.detail ?? 1, item: grab ? under : null };
        },
        up(p) {
            if (multi.paste) return;
            if (multi.drag) {
                const { dx, dy } = multi.drag;
                multi.drag = null;
                app.canvas.style.cursor = '';
                moveMulti(dx, dy);
                return;
            }
            if (multi.band) {
                const [ax, ay] = multi.band.a;
                const [bx, by] = multi.band.b;
                multi.band = null;
                multi.press = null;
                const sel = collectIn(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
                if (!countSel(sel)) {
                    store.setUi({ selection: null });
                    app.toast('No hay nada completo dentro del rectángulo: tiene que abarcar muros enteros.');
                }
                setMulti(sel);
                return;
            }
            if (multi.press) {
                const press = multi.press;
                multi.press = null;
                if (multi.sel) setMulti(null);
                pickClick(press, press.detail);
                return;
            }
            if (!drag) return;
            const d = drag;
            drag = null;
            app.canvas.style.cursor = '';
            if (d.kind === 'opening') {
                const sp = d.spot;
                if (sp && !sp.ok) app.toast(sp.reason, 'error');
                else if (sp && (sp.wall.id !== d.o.wall || sp.pos !== d.o.pos)) {
                    store.commit('Mover abertura', (dr) => Object.assign(dr.levels[store.ui.level].openings.find((q) => q.id === d.o.id), { wall: sp.wall.id, pos: sp.pos }));
                }
            } else if (d.kind === 'column') {
                if ((d.nx !== d.c.x || d.ny !== d.c.y) && inLot(d.nx, d.ny)) store.commit('Mover pilar', (dr) => Object.assign(dr.levels[store.ui.level].columns.find((q) => q.id === d.c.id), { x: d.nx, y: d.ny }));
            } else if (d.kind === 'furniture') {
                if (d.nx !== d.m.x || d.ny !== d.m.y) store.commit('Mover mueble', (dr) => Object.assign(dr.levels[store.ui.level].furniture.find((q) => q.id === d.m.id), { x: d.nx, y: d.ny }));
            } else if (d.kind === 'tree') {
                if ((d.nx !== d.t.x || d.ny !== d.t.y) && inLot(d.nx, d.ny)) store.commit('Mover árbol', (dr) => Object.assign(dr.trees.find((q) => q.id === d.t.id), { x: d.nx, y: d.ny }));
            } else if (d.kind === 'zone') {
                if (d.nx !== d.z.x || d.ny !== d.z.y) store.commit('Mover zona', (dr) => Object.assign(dr.zones.find((q) => q.id === d.z.id), { x: d.nx, y: d.ny }));
            } else if (d.kind === 'label') {
                if (d.nx !== d.lb.x || d.ny !== d.lb.y) store.commit('Mover nombre', (dr) => Object.assign(dr.levels[store.ui.level].labels.find((q) => q.id === d.lb.id), { x: d.nx, y: d.ny }));
            } else if (d.kind === 'zside') {
                if (d.nv === d.v0) return;
                const e = { x0: d.z.x, x1: d.z.x + d.z.w, y0: d.z.y, y1: d.z.y + d.z.h, [d.side]: d.nv };
                store.commit('Estirar zona', (dr) => Object.assign(dr.zones.find((q) => q.id === d.z.id), { x: e.x0, y: e.y0, w: e.x1 - e.x0, h: e.y1 - e.y0 }));
            } else if (d.kind === 'shift') {
                if (d.dx || d.dy) guardedMove(d.sel, d.dx, d.dy);
            } else if (d.kind === 'wall') {
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
            if (e.key === 'Escape' && multi.paste) {
                multi.paste = null;
                app.refreshOptions();
                app.render();
                return true;
            }
            if (e.key === 'Escape' && drag) {
                drag = null;
                app.canvas.style.cursor = '';
                app.render();
                return true;
            }
            const dir = { ArrowLeft: [-BU, 0], ArrowRight: [BU, 0], ArrowUp: [0, -BU], ArrowDown: [0, BU] }[e.key];
            if (dir && multi.sel && e.shiftKey) {
                // Mayús + flechas corren lo elegido de a un bloque (las flechas solas mueven la cámara)
                e.preventDefault();
                moveMulti(dir[0], dir[1]);
                return true;
            }
            if (e.key === 'Escape' && (multi.sel || multi.band || multi.drag)) {
                multi.band = null;
                multi.drag = null;
                multi.press = null;
                setMulti(null);
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            if (multi.paste) {
                drawPaste(ctx, cam);
                return;
            }
            drawMulti(ctx, cam);
            if (drag) {
                const z = base();
                if (drag.kind === 'opening') {
                    const sp = drag.spot;
                    if (sp) ghostBox(ctx, cam, openingBox(sp.wall, sp.pos, drag.o.w, drag.o.sill, drag.o.h, z), sp.ok ? { fill: 'rgba(139,197,63,.5)', stroke: '#3f6212' } : { fill: 'rgba(180,35,24,.35)', stroke: '#b42318' });
                    return;
                }
                if (drag.kind === 'zside' || drag.kind === 'shift') {
                    const b = drag.kind === 'shift'
                        ? { x0: drag.box.x0 + drag.dx, x1: drag.box.x1 + drag.dx, y0: drag.box.y0 + drag.dy, y1: drag.box.y1 + drag.dy }
                        : { x0: drag.z.x, x1: drag.z.x + drag.z.w, y0: drag.z.y, y1: drag.z.y + drag.z.h, [drag.side]: drag.nv };
                    const zr = drag.kind === 'shift' ? drag.z : 0.5;
                    outlineRect(ctx, cam, b.x0 * G, b.y0 * G, b.x1 * G, b.y1 * G, zr, { stroke: '#2563eb', fill: 'rgba(37,99,235,.2)', width: 2, dash: [6, 4] });
                    const [sx, sy] = cam.project(((b.x0 + b.x1) / 2) * G, ((b.y0 + b.y1) / 2) * G, zr);
                    label(ctx, drag.kind === 'shift' ? `→ ${fmt((drag.dx * G) / 100)} m · ↓ ${fmt((drag.dy * G) / 100)} m` : `${fmt(((b.x1 - b.x0) * G) / 100)} × ${fmt(((b.y1 - b.y0) * G) / 100)} m`, sx, sy, { bg: 'rgba(37,99,235,.92)' });
                    return;
                }
                if (drag.kind === 'column') {
                    const half = drag.c.size / 2;
                    ghostBox(ctx, cam, { x0: drag.nx * G - half, x1: drag.nx * G + half, y0: drag.ny * G - half, y1: drag.ny * G + half, z0: z, z1: z + cfg.levelHeight }, { fill: 'rgba(37,99,235,.25)', stroke: '#2563eb' });
                    return;
                }
                if (drag.kind === 'furniture') {
                    furnitureGhost(ctx, cam, { ...drag.m, x: drag.nx, y: drag.ny }, { fill: 'rgba(37,99,235,.25)', stroke: '#2563eb' });
                    return;
                }
                if (drag.kind === 'tree') {
                    treeRing(ctx, cam, drag.nx, drag.ny, drag.t.size, '#2563eb');
                    return;
                }
                if (drag.kind === 'zone') {
                    outlineRect(ctx, cam, drag.nx * G, drag.ny * G, (drag.nx + drag.z.w) * G, (drag.ny + drag.z.h) * G, 0.5, { stroke: '#2563eb', fill: 'rgba(37,99,235,.2)', width: 2, dash: [6, 4] });
                    return;
                }
                if (drag.kind === 'label') {
                    const [sx, sy] = cam.project((drag.nx + 0.5) * G, (drag.ny + 0.5) * G, z);
                    label(ctx, drag.lb.name, sx, sy, { bg: 'rgba(37,99,235,.92)' });
                    return;
                }
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
        // Largo escrito con el teclado (metros) mientras hay un tramo en curso, y último puntero para saber hacia dónde va.
        let typed = '';
        let lastP = null;
        const typedUnits = () => {
            const m = Number.parseFloat(typed.replace(',', '.'));
            return Number.isFinite(m) && m > 0 ? Math.max(2, Math.round((m * 100) / G)) : 0;
        };
        const compute = (p) => {
            if (!start) return null;
            const e = ortho(start, p);
            if (!opts.module && typedUnits()) {
                // Largo exacto (de a 12,5 cm) en la dirección del cursor.
                const u = typedUnits();
                if (e.gy !== start.gy) return { gx: start.gx, gy: start.gy + Math.sign(e.gy - start.gy) * u };
                return { gx: start.gx + (Math.sign(e.gx - start.gx) || 1) * u, gy: start.gy };
            }
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
            reset() { start = null; end = null; pressed = false; chainStart = null; typed = ''; },
            down(p, e) {
                if (start && !pressed) {
                    const b = compute(p);
                    typed = '';
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
                typed = '';
                pressed = true;
                dragged = false;
                downAt = { x: p.sx, y: p.sy };
            },
            move(p) {
                lastP = p;
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
                    typed = '';
                    app.render();
                    return true;
                }
                // Con el primer punto puesto se puede escribir el largo en metros: Enter coloca el tramo y sigue la cadena.
                if (!opts.module && start && !pressed) {
                    const aim = app.pointer ?? lastP ?? { gx: start.gx + 1, gy: start.gy };
                    if (/^[0-9]$/.test(e.key) || ((e.key === ',' || e.key === '.') && typed !== '' && !/[.,]/.test(typed))) {
                        if (typed.length < 6) typed += e.key;
                        end = compute(aim);
                        app.render();
                        return true;
                    }
                    if (e.key === 'Backspace' && typed !== '') {
                        typed = typed.slice(0, -1);
                        end = compute(aim);
                        app.render();
                        return true;
                    }
                    if (e.key === 'Enter' && typedUnits()) {
                        e.preventDefault();
                        const b = compute(aim);
                        typed = '';
                        if (commitSeg(start, b)) start = { ...b };
                        if (chainStart && b.gx === chainStart.gx && b.gy === chainStart.gy) {
                            start = null;
                            chainStart = null;
                        }
                        end = null;
                        app.render();
                        return true;
                    }
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
                typed = '';
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
                    if (len > 0 && typedUnits()) dimLabel(ctx, cam, x0, y0, x1, y1, z + cfg.levelHeight, `${typed} → ${meters(len * G)} m · ${fmt((len * G) / BL, 1)} bloques${modular ? '' : ' · con cortes'} · Enter lo coloca`);
                    else if (len > 0) dimLabel(ctx, cam, x0, y0, x1, y1, z + cfg.levelHeight, `${fmt((len * G) / 100)} m · ${fmt((len * G) / BL, 1)} bloques${modular ? '' : ' · con cortes'}${closes ? ' · cierra la habitación' : ''}`);
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
    T.wall = segmentTool({ key: 'w', label: 'Muro', hint: 'Clic en cada esquina (o arrastrá un muro). Con el primer punto puesto, escribí el largo en metros (3,25) y Enter lo coloca hacia donde apunta el cursor. Al volver al punto de partida la habitación se cierra; Esc o doble clic terminan.', commitLabel: 'Agregar muro' });
    T.block = segmentTool({ key: 'b', label: 'Bloque suelto', hint: `Clic: un bloque de ${fmt(BL, 1)} cm. Arrastre: hilera de bloques enteros. X gira la orientación.`, module: true, commitLabel: 'Agregar bloques' });

    // ---------------- aberturas (puertas, ventanas, portones) ----------------
    /**
     * Lugar válido para una abertura de `w` unidades bajo el puntero: el tramo libre del muro más cercano (jambas ≥ 25 cm
     * respecto de esquinas, muros y otras aberturas). Al mover una existente (`self`) se libera el lugar que ocupa.
     */
    const openingSpot = (p, w, self = null) => {
        const wall = pickWall(app, p.sx, p.sy);
        if (!wall) return null;
        const info = store.analysis?.levels?.[store.ui.level]?.walls?.[wall.id];
        if (!info) return null;
        const desired = Math.round(alongPosition(app, wall, p.sx, p.sy) - w / 2);
        let slots = info.slots.map((s) => [...s]);
        if (self && self.wall === wall.id) {
            slots.push([self.pos - 2, self.pos + self.w + 2]);
            slots.sort((x, y) => x[0] - y[0]);
            slots = slots.reduce((acc, s) => {
                const last = acc.at(-1);
                if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
                else acc.push(s);
                return acc;
            }, []);
        }
        let best = null;
        for (const [from, to] of slots) {
            if (to - from < w) continue;
            const pos = clamp(desired, from, to - w);
            const dist = Math.abs(pos - desired);
            if (!best || dist < best.dist) best = { pos, dist };
        }
        return best
            ? { wall, pos: best.pos, ok: true, w }
            : { wall, pos: clamp(desired, 0, Math.max(0, wallLen(wall) - w)), ok: false, w, reason: `No hay lugar libre de ${fmt(w * G, 1)} cm en este muro (jambas ≥ 25 cm respecto de esquinas, muros y otras aberturas).` };
    };

    const openingState = { kind: 'door', w: OPENING_TYPES.door.w, mode: 'swing', sill: OPENING_TYPES.door.sill, custom: false };
    /** Tipo de la herramienta: puerta, arcada (puerta sin hoja), ventana o portón. */
    const setOpeningKind = (type) => {
        const kind = type === 'arch' ? 'door' : type;
        openingState.kind = kind;
        openingState.w = OPENING_TYPES[kind].w;
        openingState.mode = type === 'arch' ? 'open' : defaultMode(kind);
        openingState.sill = OPENING_TYPES[kind].sill;
        openingState.custom = false;
    };
    {
        let ghost = null;
        T.opening = {
            hotkey: 'p',
            label: 'Abertura',
            hint: 'Elegí el tipo (puerta, arcada, ventana o portón), la medida (de catálogo o a medida) y cómo abre; apuntá a un muro: el fantasma verde indica un lugar válido. Clic para colocar. Después se mueve arrastrándola.',
            setKind: (kind) => { setOpeningKind(kind); app.refreshOptions(); app.render(); },
            options: () => {
                const t = OPENING_TYPES[openingState.kind];
                // Medida comercial del catálogo (fija ancho, antepecho y apertura) o «A medida», con los controles libres.
                const arch = typeOf(openingState) === 'arch';
                const list = arch ? [] : commercialFor(cfg, openingState.kind);
                const match = openingState.custom || arch ? null : commercialOf(cfg, openingState);
                const widths = t.widths.includes(openingState.w) ? t.widths : [...t.widths, openingState.w].sort((a, b) => a - b);
                return h('span', { class: 'row' },
                    selectT('Tipo', typeOf(openingState), TYPE_CHOICES, (v) => { setOpeningKind(v); app.refreshOptions(); app.render(); }),
                    list.length ? selectT('Medida', match?.id ?? '', [...list.map((c) => [c.id, c.label]), ['', 'A medida']], (v) => {
                        const c = list.find((x) => x.id === v);
                        if (c) Object.assign(openingState, { w: c.w, sill: c.sill, mode: c.mode, custom: false });
                        else openingState.custom = true;
                        app.refreshOptions();
                        app.render();
                    }) : null,
                    match ? null : selectT('Ancho', openingState.w, widths.map((n) => [n, `${fmt(n * G, 1)} cm`]), (v) => { openingState.w = Number(v); app.render(); }),
                    !match && openingState.kind === 'window' ? selectT('Antepecho', openingState.sill, [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [n, `${n * 25} cm del suelo`]), (v) => { openingState.sill = Number(v); app.render(); }) : null,
                    arch ? null : selectT('Apertura', openingState.mode, modeChoices(openingState), (v) => { openingState.mode = v; app.render(); }));
            },
            reset() { ghost = null; },
            move(p) {
                ghost = openingSpot(p, openingState.w);
                app.render();
            },
            down(p) {
                ghost = openingSpot(p, openingState.w);
                if (!ghost) return;
                if (!ghost.ok) {
                    app.toast(ghost.reason, 'error');
                    return;
                }
                const g = ghost;
                const st = { ...openingState };
                store.commit(`Agregar ${openingTitle(st).toLowerCase()}`, (d) => {
                    d.levels[store.ui.level].openings.push({ id: nextId(d, 'o'), wall: g.wall.id, pos: g.pos, ...newOpening(st.kind, cfg.openingTopCourse, st.w), sill: st.sill, h: cfg.openingTopCourse - st.sill, mode: st.mode });
                });
            },
            draw(ctx, cam) {
                if (!ghost) return;
                const sill = openingState.kind === 'window' ? openingState.sill : 0;
                const box = openingBox(ghost.wall, ghost.pos, openingState.w, sill, cfg.openingTopCourse - sill, base());
                ghostBox(ctx, cam, box, ghost.ok ? { fill: 'rgba(139,197,63,.5)', stroke: '#3f6212' } : { fill: 'rgba(180,35,24,.35)', stroke: '#b42318' });
            },
        };
    }

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
                    // una habitación en L (o de otra forma) no admite una losa de un clic: se dibuja con un rectángulo
                    const odd = rooms.some((rm) => rm.fill?.some(([x, y, w, hh]) => a.gx >= x && a.gx < x + w && a.gy >= y && a.gy < y + hh));
                    app.toast(odd ? 'Esa habitación no es rectangular: arrastrá un rectángulo para dibujar la losa.' : 'Clic dentro de una habitación cerrada de la planta baja (o arrastrá un rectángulo).', 'error');
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

    // ---------------- muebles simples ----------------
    // Al entrar a la herramienta se abre el menú de muebles: no se coloca nada hasta elegir uno.
    const furnitureState = { kind: null, rot: 0, active: false };
    let furnitureMenu = null;
    const closeFurnitureMenu = () => {
        furnitureMenu?.remove();
        furnitureMenu = null;
    };
    const openFurnitureMenu = () => {
        closeFurnitureMenu();
        const pick = (id) => {
            furnitureState.kind = id;
            closeFurnitureMenu();
            app.refreshOptions();
            app.render();
            app.canvas.focus({ preventScroll: true });
        };
        furnitureMenu = h('div', { class: 'furniture-menu', role: 'dialog', 'aria-label': 'Elegir un mueble' },
            h('div', { class: 'fm-head' },
                h('strong', {}, '¿Qué mueble vas a colocar?'),
                furnitureState.kind ? h('button', { type: 'button', class: 'ai-x', 'aria-label': 'Cerrar', onclick: closeFurnitureMenu }, '×') : null),
            furnitureGroups(cfg).map(([group, items]) => h('div', { class: 'fm-group' },
                h('div', { class: 'kv-title' }, group),
                h('div', { class: 'fm-items' }, items.map(([id, def]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(id === furnitureState.kind), onclick: () => pick(id) }, def.name))))));
        document.getElementById('stage').append(furnitureMenu);
    };
    /** El mueble a colocar, centrado bajo el cursor. */
    const furnitureAt = (p) => {
        const m = { kind: furnitureState.kind, rot: furnitureState.rot, x: 0, y: 0 };
        const s = footprint(cfg, m);
        if (!s) return null;
        [m.x, m.y] = furnitureSpot(m, (p.wx - s.w / 2) / G, (p.wy - s.d / 2) / G);
        return m;
    };
    const turnTool = () => { furnitureState.rot = (furnitureState.rot + 1) % 4; app.refreshOptions(); app.render(); };
    T.furniture = {
        snap: 1,
        hotkey: 'g',
        label: 'Mueble',
        hint: 'Elegí un mueble del menú y hacé clic para colocarlo; X lo gira. Son gabaritos de tamaño real para ver si el ambiente alcanza: no entran al cómputo. Después se mueve arrastrándolo.',
        disabled: () => (store.ui.level === 2 ? 'Elegí «Nivel 1» o «Nivel 2».' : null),
        options: () => {
            if (!furnitureState.active) {
                // recién elegida la herramienta: primero el menú, para decidir qué se va a colocar
                furnitureState.active = true;
                furnitureState.kind = null;
                openFurnitureMenu();
            }
            const def = cfg.furniture?.[furnitureState.kind];
            return h('span', { class: 'row' },
                def
                    ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', id: 'furniture-change', onclick: openFurnitureMenu }, `${def.name} · cambiar ▾`)
                    : h('span', { class: 'muted' }, 'Elegí un mueble del menú para colocarlo.'),
                def ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: turnTool }, `Girar (X) · ${furnitureState.rot * 90}°`) : null);
        },
        reset() {
            furnitureState.active = false;
            closeFurnitureMenu();
        },
        down(p) {
            if (!furnitureState.kind) {
                openFurnitureMenu();
                return;
            }
            const m = furnitureAt(p);
            if (!m) return;
            store.commit('Agregar mueble', (d) => {
                (d.levels[store.ui.level].furniture ??= []).push({ id: nextId(d, 'm'), ...m });
            });
        },
        keyDown(e) {
            if (e.key === 'x' || e.key === 'X') {
                turnTool();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            const p = app.pointer;
            const m = p && furnitureAt(p);
            if (!m) return;
            furnitureGhost(ctx, cam, m, { fill: 'rgba(139,197,63,.5)', stroke: '#3f6212' });
            const s = footprint(cfg, m);
            const [sx, sy] = cam.project(m.x * G + s.w / 2, m.y * G + s.d / 2, base() + s.h);
            label(ctx, `${s.def.short} · ${fmt(s.w, 0)} × ${fmt(s.d, 0)} cm`, sx, sy - 18);
        },
    };

    // ---------------- pilares ----------------
    const columnState = { size: cfg.columnSizes?.[0] ?? 20 };
    const levelOnly = () => (store.ui.level === 2 ? 'Elegí «Nivel 1» o «Nivel 2».' : null);
    T.column = {
        magnet: true,
        snap: 1,
        hotkey: 'c',
        label: 'Pilar',
        hint: 'Clic en un punto de la retícula: pilar de hormigón armado de piso a techo del nivel. Sostiene el techo o la losa donde no hay muro (alfresco, galería, portón ancho).',
        disabled: levelOnly,
        options: () => h('span', { class: 'row' },
            selectT('Lado', columnState.size, (cfg.columnSizes ?? [20, 25, 30, 40]).map((v) => [v, `${v} × ${v} cm`]), (v) => { columnState.size = Number(v); app.render(); })),
        down(p) {
            if (!inLot(p.gx, p.gy)) return;
            if (store.level().columns?.some((c) => c.x === p.gx && c.y === p.gy)) {
                app.toast('Ya hay un pilar en ese punto.', 'error');
                return;
            }
            store.commit('Agregar pilar', (d) => {
                (d.levels[store.ui.level].columns ??= []).push({ id: nextId(d, 'c'), x: p.gx, y: p.gy, size: columnState.size });
            });
        },
        draw(ctx, cam) {
            const p = app.pointer;
            if (!p || !inLot(p.gx, p.gy)) return;
            const s = columnState.size / 2;
            ghostBox(ctx, cam, { x0: p.gx * G - s, x1: p.gx * G + s, y0: p.gy * G - s, y1: p.gy * G + s, z0: base(), z1: base() + cfg.levelHeight }, { fill: 'rgba(139,197,63,.5)', stroke: '#3f6212' });
        },
    };

    // ---------------- nombres de ambientes ----------------
    const labelState = { name: 'Estar', type: '' };
    T.label = {
        hotkey: 'a',
        label: 'Nombre',
        hint: 'Elegí un tipo o escribí un nombre libre y hacé clic dentro de un ambiente: se ve en la planta. El tipo da las recomendaciones de la Revisión y agrupa los m². En un espacio abierto (cocina + estar) podés poner varios.',
        disabled: levelOnly,
        options: () => h('span', { class: 'row' },
            selectT('Tipo', labelState.type, roomTypeItems(cfg), (v) => {
                labelState.type = v;
                labelState.name = nameForType(cfg, v, labelState.name.trim());
                app.refreshOptions();
                app.render();
            }),
            h('label', { class: 'field-inline' }, 'Nombre',
                h('input', { type: 'text', list: 'room-names', maxlength: 40, value: labelState.name, oninput: (e) => { labelState.name = e.target.value; } })),
            roomNamesList()),
        down(p) {
            const name = labelState.name.trim();
            if (!name) {
                app.toast('Escribí un nombre para el ambiente.', 'error');
                return;
            }
            const [wx, wy] = app.cam.unproject(p.sx, p.sy, base());
            const x = Math.floor(wx / G);
            const y = Math.floor(wy / G);
            let id = null;
            store.commit('Nombrar ambiente', (d) => {
                id = nextId(d, 'n');
                (d.levels[store.ui.level].labels ??= []).push({ id, x, y, name, ...(labelState.type ? { type: labelState.type } : {}) });
            });
            app.setTool('select');
            store.setUi({ selection: { type: 'label', id } });
        },
        draw(ctx, cam) {
            const p = app.pointer;
            if (!p) return;
            const [wx, wy] = cam.unproject(p.sx, p.sy, base());
            const [sx, sy] = cam.project((Math.floor(wx / G) + 0.5) * G, (Math.floor(wy / G) + 0.5) * G, base());
            label(ctx, labelState.name || '…', sx, sy);
        },
    };

    // ---------------- terreno: zonas y árboles ----------------
    const zoneState = { kind: 'pool' };
    let zoneDraft = null;
    const zoneRect = (d) => ({ x: Math.min(d.a[0], d.b[0]), y: Math.min(d.a[1], d.b[1]), w: Math.abs(d.b[0] - d.a[0]), h: Math.abs(d.b[1] - d.a[1]) });
    T.zone = {
        magnet: false,
        snap: 2,
        hotkey: 'z',
        label: 'Zona',
        hint: 'Arrastrá un rectángulo sobre el terreno: pileta, patio o deck, jardín o camino. No son parte de la casa ni entran al cómputo: marcan cómo se usa el espacio.',
        disabled: levelOnly,
        options: () => h('span', { class: 'row' },
            selectT('Tipo', zoneState.kind, Object.entries(ZONE_KINDS).map(([k, z]) => [k, z.label]), (v) => { zoneState.kind = v; app.render(); })),
        reset() { zoneDraft = null; },
        down(p) {
            if (inLot(p.gx, p.gy)) zoneDraft = { a: [p.gx, p.gy], b: [p.gx, p.gy] };
        },
        move(p) {
            if (!zoneDraft) return;
            zoneDraft.b = [clamp(p.gx, 0, lot().w), clamp(p.gy, 0, lot().d)];
            app.render();
        },
        up() {
            if (!zoneDraft) return;
            const r = zoneRect(zoneDraft);
            zoneDraft = null;
            if (r.w < 2 || r.h < 2) {
                app.render();
                return;
            }
            let id = null;
            store.commit('Agregar zona', (d) => {
                id = nextId(d, 'z');
                (d.zones ??= []).push({ id, ...r, kind: zoneState.kind, name: '' });
            });
            app.setTool('select');
            store.setUi({ selection: { type: 'zone', id } });
        },
        draw(ctx, cam) {
            if (!zoneDraft) return;
            const r = zoneRect(zoneDraft);
            outlineRect(ctx, cam, r.x * G, r.y * G, (r.x + r.w) * G, (r.y + r.h) * G, 0.5, { stroke: '#2563eb', fill: 'rgba(37,99,235,.15)', width: 2, dash: [6, 4] });
            const [sx, sy] = cam.project((r.x + r.w / 2) * G, (r.y + r.h / 2) * G, 0);
            label(ctx, `${fmt((r.w * G) / 100)} × ${fmt((r.h * G) / 100)} m`, sx, sy, { bg: 'rgba(37,99,235,.92)' });
        },
    };

    const treeState = { size: 'M' };
    /** Contorno de la copa (para el fantasma y el arrastre). */
    const treeRing = (ctx, cam, x, y, size, color) => {
        const d = TREE_SIZES[size] ?? TREE_SIZES.M;
        const pts = Array.from({ length: 28 }, (_, i) => cam.project(x * G + Math.cos((i / 28) * Math.PI * 2) * d.r, y * G + Math.sin((i / 28) * Math.PI * 2) * d.r, 0.6));
        ctx.save();
        ctx.beginPath();
        pts.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(139,197,63,.35)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.restore();
        nodeMarker(ctx, cam, x * G, y * G, 0.6, color);
    };
    T.tree = {
        magnet: false,
        snap: 1,
        hotkey: 'o',
        label: 'Árbol',
        hint: 'Clic en el terreno para plantar un árbol (tronco, copa y sombra). No entra al cómputo; con el sol activado proyecta su sombra.',
        disabled: levelOnly,
        options: () => h('span', { class: 'row' },
            selectT('Tamaño', treeState.size, Object.entries(TREE_SIZES).map(([k, t]) => [k, t.label]), (v) => { treeState.size = v; app.render(); })),
        down(p) {
            if (!inLot(p.gx, p.gy)) return;
            store.commit('Plantar árbol', (d) => {
                (d.trees ??= []).push({ id: nextId(d, 'a'), x: p.gx, y: p.gy, size: treeState.size });
            });
        },
        draw(ctx, cam) {
            const p = app.pointer;
            if (p && inLot(p.gx, p.gy)) treeRing(ctx, cam, p.gx, p.gy, treeState.size, '#3f6212');
        },
    };

    // ---------------- medir ----------------
    /** Punto de medición (cm): la retícula de 12,5 cm y, cerca de un muro, su cara (para medir la luz libre interior). */
    const measurePoint = (p) => {
        const reach = Math.min(12 / app.cam.zoom, 30);
        let x = Math.round(p.wx / G) * G;
        let y = Math.round(p.wy / G) * G;
        let bx = reach;
        let by = reach;
        for (const { w } of snapWalls(store)) {
            const [x0, y0, x1, y1] = wallRect(w);
            if (p.wy >= y0 - reach && p.wy <= y1 + reach) for (const fx of [x0, x1]) if (Math.abs(p.wx - fx) < bx) { bx = Math.abs(p.wx - fx); x = fx; }
            if (p.wx >= x0 - reach && p.wx <= x1 + reach) for (const fy of [y0, y1]) if (Math.abs(p.wy - fy) < by) { by = Math.abs(p.wy - fy); y = fy; }
        }
        return [x, y];
    };
    /** Segundo punto: si casi no se aparta de la horizontal o la vertical del primero, se endereza. */
    const measureEnd = (a, p) => {
        const [x, y] = measurePoint(p);
        return [Math.abs(x - a[0]) < G ? a[0] : x, Math.abs(y - a[1]) < G ? a[1] : y];
    };
    let measure = null;
    T.measure = {
        snap: 1,
        hotkey: 'm',
        label: 'Medir',
        hint: 'Clic en un punto y clic en otro: muestra la distancia. Cerca de un muro se pega a su cara (luz libre entre paredes). No cambia el proyecto; Esc borra la medida.',
        options: () => h('span', { class: 'row' }, h('span', { class: 'muted small' }, 'Se ajusta a la retícula de 12,5 cm y a las caras de los muros.')),
        reset() { measure = null; },
        down(p) {
            if (!measure || measure.done) measure = { a: measurePoint(p), b: null, done: false };
            else {
                measure.b = measureEnd(measure.a, p);
                measure.done = true;
            }
        },
        move(p) {
            if (measure && !measure.done) measure.b = measureEnd(measure.a, p);
            app.render();
        },
        keyDown(e) {
            if (e.key === 'Escape' && measure) {
                measure = null;
                app.render();
                return true;
            }
            return false;
        },
        contextmenu() { measure = null; app.render(); },
        draw(ctx, cam) {
            const z = bandZ();
            if (!measure) {
                if (app.pointer) {
                    const [x, y] = measurePoint(app.pointer);
                    nodeMarker(ctx, cam, x, y, z, '#b45309');
                }
                return;
            }
            const { a, b } = measure;
            if (b) {
                const [ax, ay] = cam.project(a[0], a[1], z);
                const [bx, by] = cam.project(b[0], b[1], z);
                ctx.save();
                ctx.strokeStyle = '#b45309';
                ctx.lineWidth = 2;
                if (!measure.done) ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
                ctx.restore();
                nodeMarker(ctx, cam, b[0], b[1], z, '#b45309');
                const dx = Math.abs(b[0] - a[0]);
                const dy = Math.abs(b[1] - a[1]);
                const d = Math.hypot(dx, dy);
                if (d > 0) label(ctx, dx && dy ? `${meters(d)} m · Δx ${meters(dx)} · Δy ${meters(dy)}` : `${meters(d)} m`, (ax + bx) / 2, (ay + by) / 2 - 16, { bg: 'rgba(180,83,9,.95)' });
            }
            nodeMarker(ctx, cam, a[0], a[1], z, '#b45309');
        },
    };
    /** Medida en curso o terminada, en cm (para pruebas): { a, b, done } o null. */
    app.measurement = () => measure;

    // metadatos para la barra de herramientas
    const SHORT = { measure: 'Medir', furniture: 'Mueble', select: 'Elegir', room: 'Habitación', wall: 'Muro', block: 'Bloque', opening: 'Abertura', column: 'Pilar', label: 'Nombre', zone: 'Zona', tree: 'Árbol', ubeam: 'Viga U', floor: 'Madera', beam: 'Viga madera', slab: 'Losa', stair: 'Escalera', roof: 'Techo', piso: 'Piso' };
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

