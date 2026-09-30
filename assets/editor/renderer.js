/**
 * Dibujo del lienzo (Canvas 2D). Dos vistas con el mismo modelo:
 *  - isométrica 30°/30°, con oclusión por algoritmo del pintor sobre cajas de cada pieza;
 *  - planta cenital 2D con simbología de puertas y ventanas y rótulos de ambientes.
 * El dibujo es bajo demanda (rAF sólo cuando hay cambios): 60 FPS sin GPU dedicada.
 */
import { Camera } from './camera.js';
import { KIND, sortedItems, visibleFaces } from './scene.js';
import { fmt } from '../lib/format.js';
import { drawTheme, mix } from '../lib/theme.js';
import { planeEq, planeHoles, gableHoles, withHoles } from './roofclip.js';

const G = 12.5;

/** Colores de piso por ambiente (del tema): el mismo ambiente conserva su color al editar. */
export const roomColor = (room) => {
    const floors = drawTheme().floors;
    return floors[(room.id - 1) % floors.length];
};

function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Caras de cada tipo de caja (tapa, frente y costado sombreados) a partir de los colores del tema. */
let paletteFor = null;
let palette = null;
function PAL() {
    const t = drawTheme();
    if (paletteFor === t) return palette;
    const base = {
        [KIND.BLOCK]: t.block,
        [KIND.CUT]: t.cut,
        [KIND.U]: t.u,
        [KIND.UCUT]: mix(t.u, '#ffffff', 0.35),
        [KIND.DOOR]: t.door,
        [KIND.GLASS]: t.glass,
        [KIND.FRAME]: '#f7f8fa',
        [KIND.JOIST]: t.wood,
        [KIND.DECK]: mix(t.wood, '#ffffff', 0.45),
        [KIND.BEAM]: mix(t.wood, '#000000', 0.12),
        [KIND.STEP]: mix(t.slab, '#ffffff', 0.5),
        [KIND.SLAB]: t.slab,
    };
    palette = Object.fromEntries(Object.entries(base).map(([k, hex]) => [k, { top: shade(hex, 1.03), yp: shade(hex, 0.88), xp: shade(hex, 0.74) }]));
    paletteFor = t;
    return palette;
}

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = 1;
        this.shadow = document.createElement('canvas');
        this.shadowCtx = this.shadow.getContext('2d');
        // Capa estática (suelo + modelo + sombras): sólo se redibuja si cambia la cámara o el modelo,
        // no con cada movimiento del mouse (previews de herramientas, resaltes).
        this.layer = document.createElement('canvas');
        this.layerCtx = this.layer.getContext('2d');
        this.layerKey = '';
    }

    resize(w, h, dpr) {
        this.dpr = dpr;
        this.layerKey = '';
        for (const c of [this.canvas, this.shadow, this.layer]) {
            c.width = Math.round(w * dpr);
            c.height = Math.round(h * dpr);
        }
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
    }

    /** f: { cam, project, analysis, scene, ui, sun, sceneKey, overlay(ctx, cam) } */
    draw(f) {
        const { dpr } = this;
        const { cam } = f;
        const key = `${f.sceneKey}|${cam.cx.toFixed(3)}|${cam.cy.toFixed(3)}|${cam.zoom.toFixed(5)}|${cam.view}|${cam.rot}|${cam.w}|${cam.h}|${dpr}`;
        if (key !== this.layerKey || !f.sceneKey) {
            const main = this.ctx;
            this.ctx = this.layerCtx;
            this.drawStatic(f);
            this.ctx = main;
            this.layerKey = key;
        }
        const { ctx } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.layer, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        f.overlay?.(ctx, cam);
        this.drawCompass(f);
    }

    drawStatic(f) {
        this.frame = f;
        const { ctx, dpr } = this;
        const { cam } = f;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cam.w, cam.h);
        ctx.fillStyle = drawTheme().sky;
        ctx.fillRect(0, 0, cam.w, cam.h);
        this.drawGround(f);
        if (f.project) {
            if (cam.view === 'plan') this.drawPlan(f);
            else this.drawIso(f);
        }
    }

    // ---------- suelo, retícula ----------
    drawGround(f) {
        const { ctx } = this;
        const { cam, project, ui } = f;
        const showLot = ui?.showLot !== false;
        const showGrid = ui?.showGrid !== false;
        if (!showLot && !showGrid) return;
        const W = (project?.lot?.w ?? 24) * 100;
        const D = (project?.lot?.d ?? 20) * 100;
        const z = 0;
        const corners = [[0, 0], [W, 0], [W, D], [0, D]].map(([x, y]) => cam.project(x, y, z));
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        if (showLot) {
            ctx.fillStyle = drawTheme().ground;
            ctx.fill();
        }
        if (showGrid) this.drawGrid(cam, W, D, z);
        if (!showLot) return;
        ctx.strokeStyle = 'rgba(30,41,59,.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
    }

    drawGrid(cam, W, D, z) {
        const { ctx } = this;
        // Retícula simple: una línea por metro (tenue) y una más marcada cada 5 m. El ajuste real (12,5 cm o el bloque) se ve como
        // puntos alrededor del cursor cuando se dibuja.
        ctx.lineWidth = 1;
        if (100 * cam.zoom * (cam.view === 'plan' ? 1 : 0.87) >= 8) {
            ctx.strokeStyle = 'rgba(30,41,59,.10)';
            ctx.beginPath();
            for (let x = 0; x <= W + 0.1; x += 100) if (x % 500) this.seg(cam, x, 0, x, D, z);
            for (let y = 0; y <= D + 0.1; y += 100) if (y % 500) this.seg(cam, 0, y, W, y, z);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(30,41,59,.26)';
        ctx.beginPath();
        for (let x = 0; x <= W + 0.1; x += 500) this.seg(cam, x, 0, x, D, z);
        for (let y = 0; y <= D + 0.1; y += 500) this.seg(cam, 0, y, W, y, z);
        ctx.stroke();
    }

    seg(cam, x0, y0, x1, y1, z) {
        const a = cam.project(x0, y0, z);
        const b = cam.project(x1, y1, z);
        this.ctx.moveTo(a[0], a[1]);
        this.ctx.lineTo(b[0], b[1]);
    }

    // ---------- isométrica ----------
    drawIso(f) {
        const { ctx } = this;
        const { cam, scene, ui } = f;
        if (!scene) return;
        if (f.sun && ui.solar.show) this.drawShadows(f);

        // Sobre el nivel activo se puede recortar la vista para ver los ambientes.
        const activeLevel = ui.level;
        const strokeOn = cam.zoom > 0.085;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = 'rgba(30,41,59,.30)';

        const list = sortedItems(scene, scene.all, cam.rot, 'all');
        const margin = 40;
        this.drawRoomFloors(f, 0, 0);
        let upperFloors = f.project.upper && activeLevel >= 1;
        for (const it of list) {
            const b = it.b;
            if (b.level > activeLevel) continue;
            if (upperFloors && b.zs >= 300) {
                upperFloors = false;
                this.drawRoomFloors(f, 1, 300);
            }
            // Descarte de cajas fuera de la pantalla (proyectos grandes con zoom cercano).
            const [px, py] = cam.project((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
            const reach = (Math.max(b.x1 - b.x0, b.y1 - b.y0) + (b.z1 - b.z0)) * cam.zoom;
            if (px + reach < -margin || px - reach > cam.w + margin || py + reach < -margin || py - reach > cam.h + margin) continue;
            if (b.level === activeLevel && b.course !== undefined && b.kind <= KIND.UCUT && ui.cut < 12 && b.course >= ui.cut) continue;
            if (b.opening) {
                if (b.level === activeLevel && ui.cut < 12 && b.course >= ui.cut) continue;
            }
            this.drawBox(ctx, cam, it, strokeOn);
        }
        if (upperFloors) this.drawRoomFloors(f, 1, 300);
    }

    /** Piso de color de cada ambiente cerrado del nivel `li`, a la cota `z`. */
    drawRoomFloors(f, li, z) {
        const { ctx } = this;
        const { cam, analysis } = f;
        const stairHoles = li === 1 ? (analysis.floors?.stairs ?? []).flatMap((st) => [...st.steps, ...st.landings].map((q) => ({ x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1 }))) : [];
        for (const room of analysis.levels[li]?.rooms ?? []) {
            if (!room.fill?.length) continue;
            const color = roomColor(room);
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            for (const [x, y, w, h] of room.fill) {
                const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => cam.project(a * G, b * G, z));
                pts.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
                ctx.closePath();
            }
            // En el Nivel 2 el hueco de la escalera no lleva piso.
            for (const hl of li === 1 ? stairHoles : []) {
                [[hl.x0, hl.y0], [hl.x1, hl.y0], [hl.x1, hl.y1], [hl.x0, hl.y1]].map(([a, b]) => cam.project(a, b, z)).forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
                ctx.closePath();
            }
            ctx.fill('evenodd');
            ctx.stroke();
        }
    }

    /** Un techo: hastiales de bloque, faldones (del más lejano al más cercano), cabios y cumbrera. */
    drawRoofPart(f, part) {
        const { ctx } = this;
        const { cam } = f;
        const g = part.geometry;
        const parts = f.analysis.roof?.parts ?? [];
        const idx = parts.indexOf(part);
        // Huecos de un faldón (lo que queda debajo de otro techo más alto), llevados a pantalla sobre el mismo faldón.
        const holesOf = (eq) => planeHoles(parts, idx, eq).map((hp) => hp.map(([x, y]) => cam.project(x, y, eq[0] * x + eq[1] * y + eq[2])));
        const P = (pt) => cam.project(pt[0], pt[1], pt[2]);
        const poly = (pts, fill, stroke) => {
            ctx.beginPath();
            pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.stroke();
        };
        // Hastiales primero: los aleros de los faldones los tapan en parte (como en la realidad).
        const cx = (g.rect.x0 + g.rect.x1) / 2;
        const cy = (g.rect.y0 + g.rect.y1) / 2;
        for (const gb of g.gables ?? []) {
            if (!gb.enabled || !gb.plane) continue;
            // El hastial se dibuja en la cara exterior del muro (no en su eje), así tapa el coronamiento como en obra.
            const { axis, at } = gb.plane;
            const d = Math.min(gb.thickness / 2, g.overhang ?? 0) * Math.sign(at - (axis === 'y' ? cx : cy));
            const pts = gb.pts.map(([x, y, z]) => (axis === 'y' ? [x + d, y, z] : [x, y + d, z]));
            const holes = gableHoles(parts, idx, axis, at).map((hp) => hp.map(([u, z]) => (axis === 'y' ? cam.project(at + d, u, z) : cam.project(u, at + d, z))));
            withHoles(ctx, holes, () => this.drawGable(ctx, cam, { ...gb, pts, plane: { ...gb.plane, at: at + d } }, poly));
        }
        // Faldones opacos del más lejano al más cercano, sombreados según hacia dónde miran; cada uno con sus propios cabios.
        const depth = (pl) => pl.pts.reduce((a, p) => { const [X, Y] = Camera.rotate(p[0], p[1], cam.rot); return a + X + Y; }, 0);
        const planes = [...g.planes].sort((a, b) => depth(a) - depth(b));
        for (const pl of planes) {
            const [p0, p1, , p3] = pl.pts;
            const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            const v = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
            let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            if (n[2] < 0) n = n.map((c) => -c);
            const len = Math.hypot(...n) || 1;
            const light = (-0.35 * n[0] - 0.55 * n[1] + 0.76 * n[2]) / len; // luz desde arriba a la izquierda
            const eq = planeEq(pl.pts);
            pl.eq = eq;
            const holes = holesOf(eq);
            if (holes.length) {
                ctx.save();
                for (const hl of holes) {
                    ctx.beginPath();
                    ctx.rect(-1e5, -1e5, 2e5, 2e5);
                    hl.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                    ctx.closePath();
                    ctx.clip('evenodd');
                }
            }
            poly(pl.pts, shade(drawTheme().roof, 0.78 + 0.3 * Math.max(0, light)), shade(drawTheme().roof, 0.62));
            const xs = pl.pts.map((q) => q[0]);
            const ys = pl.pts.map((q) => q[1]);
            const inside = (r) => {
                const mx = (r.from[0] + r.to[0]) / 2;
                const my = (r.from[1] + r.to[1]) / 2;
                return mx >= Math.min(...xs) - 0.5 && mx <= Math.max(...xs) + 0.5 && my >= Math.min(...ys) - 0.5 && my <= Math.max(...ys) + 0.5;
            };
            ctx.save();
            ctx.beginPath();
            pl.pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.clip();
            ctx.strokeStyle = 'rgba(90,40,20,.35)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            for (const r of g.rafters ?? []) {
                if (!inside(r)) continue;
                const a = P(r.from);
                const b = P(r.to);
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
            }
            ctx.stroke();
            ctx.restore();
            if (holes.length) ctx.restore();
        }
        if (g.ridge) {
            const rh = holesOf(planeEq(g.planes[0].pts));
            if (rh.length) {
                withHoles(ctx, rh, () => this.drawRidge(ctx, P, g.ridge));
                return;
            }
            const a = P(g.ridge.from);
            const b = P(g.ridge.to);
            ctx.strokeStyle = '#4a2110';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
        }
    }

    drawRidge(ctx, P, ridge) {
        const a = P(ridge.from);
        const b = P(ridge.to);
        ctx.strokeStyle = '#4a2110';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
    }

    /** Losa o entrepiso de una pieza: caras laterales exteriores, bordes interiores del hueco de escalera y cara superior agujereada. */
    drawPlate(ctx, cam, b, strokeOn) {
        const pal = PAL()[b.kind];
        const { x0, x1, y0, y1, z0, z1 } = b;
        const P = (x, y, z) => cam.project(x, y, z);
        const poly = (pts, color) => {
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            if (strokeOn) ctx.stroke();
        };
        const side = (spec, r, inner, color) => {
            // afuera se ven las caras que miran a la cámara; dentro de un hueco, las opuestas
            const max = inner ? !spec.max : spec.max;
            const X = max ? r.x1 : r.x0;
            const Y = max ? r.y1 : r.y0;
            poly(spec.a === 'x' ? [P(X, r.y0, z0), P(X, r.y1, z0), P(X, r.y1, z1), P(X, r.y0, z1)] : [P(r.x0, Y, z0), P(r.x1, Y, z0), P(r.x1, Y, z1), P(r.x0, Y, z1)], color);
        };
        const { xp, yp } = visibleFaces(cam.rot);
        side(yp, b, false, pal.yp);
        side(xp, b, false, pal.xp);
        const holes = b.holes.map((hl) => ({ x0: Math.max(hl.x0, x0), y0: Math.max(hl.y0, y0), x1: Math.min(hl.x1, x1), y1: Math.min(hl.y1, y1) })).filter((hl) => hl.x1 > hl.x0 && hl.y1 > hl.y0);
        // Bordes del hueco: sólo el contorno de la unión (donde dos tramos de escalera se tocan no hay borde).
        const edges = []; // [axis, at, from, to, max] — axis 'x': cara en x = at, a lo largo de y
        for (const hl of holes) {
            for (const [axis, at, from, to, max] of [['x', hl.x0, hl.y0, hl.y1, false], ['x', hl.x1, hl.y0, hl.y1, true], ['y', hl.y0, hl.x0, hl.x1, false], ['y', hl.y1, hl.x0, hl.x1, true]]) {
                let segs = [[from, to]];
                for (const o of holes) {
                    if (o === hl) continue;
                    const touches = axis === 'x' ? (max ? o.x0 === at : o.x1 === at) : (max ? o.y0 === at : o.y1 === at);
                    if (!touches) continue;
                    const [a, c] = axis === 'x' ? [o.y0, o.y1] : [o.x0, o.x1];
                    segs = segs.flatMap(([s0, s1]) => [[s0, Math.min(s1, a)], [Math.max(s0, c), s1]]).filter(([s0, s1]) => s1 - s0 > 0.01);
                }
                for (const [s0, s1] of segs) edges.push([axis, at, s0, s1, max]);
            }
        }
        // dentro del hueco se ven las caras opuestas a las visibles desde afuera
        for (const [axis, at, s0, s1, max] of edges) {
            const spec = axis === 'x' ? (xp.a === 'x' ? xp : yp) : (xp.a === 'y' ? xp : yp);
            if (max === spec.max) continue;
            const pts = axis === 'x' ? [P(at, s0, z0), P(at, s1, z0), P(at, s1, z1), P(at, s0, z1)] : [P(s0, at, z0), P(s1, at, z0), P(s1, at, z1), P(s0, at, z1)];
            poly(pts, spec === xp ? pal.xp : pal.yp);
        }
        ctx.beginPath();
        for (const r of [{ x0, y0, x1, y1 }, ...holes]) {
            [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([x, y]) => P(x, y, z1)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
        }
        ctx.fillStyle = pal.top;
        ctx.fill('evenodd');
        if (strokeOn) {
            ctx.beginPath();
            [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => P(x, y, z1)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            for (const [axis, at, s0, s1] of edges) {
                const [a, c] = axis === 'x' ? [P(at, s0, z1), P(at, s1, z1)] : [P(s0, at, z1), P(s1, at, z1)];
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(c[0], c[1]);
            }
            ctx.stroke();
        }
    }

    /** Hastial de bloque: polígono con las hiladas y las juntas verticales del despiece del servidor. */
    drawGable(ctx, cam, gb, poly) {
        poly(gb.pts, drawTheme().block, 'rgba(30,41,59,.55)');
        if (cam.zoom < 0.07 || !gb.plane) return;
        const { axis, at, z } = gb.plane;
        const P = (u, v) => (axis === 'y' ? cam.project(at, u, z + v) : cam.project(u, at, z + v));
        ctx.save();
        ctx.beginPath();
        gb.pts.forEach((pt, i) => {
            const [x, y] = cam.project(pt[0], pt[1], pt[2]);
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
        });
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = 'rgba(30,41,59,.30)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        const us = gb.pts.map((p) => (axis === 'y' ? p[1] : p[0]));
        const uMin = Math.min(...us);
        const uMax = Math.max(...us);
        for (const c of gb.courses ?? []) {
            const [ax, ay] = P(uMin, c.v0);
            const [bx, by] = P(uMax, c.v0);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            for (const u of c.joints) {
                const [px, py] = P(u, c.v0);
                const [qx, qy] = P(u, c.v0 + 25);
                ctx.moveTo(px, py);
                ctx.lineTo(qx, qy);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    /** Picaporte: una barrita oscura sobre la cara visible de la hoja. */
    drawHandle(ctx, cam, b, spec) {
        const { at, z } = b.handle;
        const horizontal = b.axis === 'x';
        const plane = spec.a === 'x' ? (spec.max ? b.x1 : b.x0) : (spec.max ? b.y1 : b.y0);
        const pt = (u, zz) => (horizontal ? cam.project(u, plane, zz) : cam.project(plane, u, zz));
        const [ax, ay] = pt(at - 7, z);
        const [bx, by] = pt(at + 7, z);
        ctx.save();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = Math.max(2, 3.5 * cam.zoom);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.restore();
    }

    drawBox(ctx, cam, it, strokeOn) {
        const b = it.b;
        if (b.kind === KIND.ROOF) {
            this.drawRoofPart(this.frame, b.roof);
            return;
        }
        if (b.plate) {
            this.drawPlate(ctx, cam, b, strokeOn);
            return;
        }
        const rot = cam.rot;
        const glass = b.kind === KIND.GLASS;
        const pal = PAL()[b.kind];
        const { x0, x1, y0, y1, z0, z1 } = b;
        const P = (x, y, z) => cam.project(x, y, z);

        const drawFace = (pts, color) => {
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            if (strokeOn) ctx.stroke();
        };

        // Caras del marco girado: +x' y +y' (las que ve la cámara), más la superior.
        const { xp: xpFace, yp: ypFace } = visibleFaces(rot);

        const face = (spec, isXp) => {
            // Las caras perpendiculares al eje son "de extremo": no se pintan donde hay otra pieza pegada.
            if (spec.a === b.axis && (spec.max ? b.adjB : b.adjA)) return;
            const X = spec.max ? x1 : x0;
            const Y = spec.max ? y1 : y0;
            const pts = spec.a === 'x'
                ? [P(X, y0, z0), P(X, y1, z0), P(X, y1, z1), P(X, y0, z1)]
                : [P(x0, Y, z0), P(x1, Y, z0), P(x1, Y, z1), P(x0, Y, z1)];
            drawFace(pts, isXp ? pal.xp : pal.yp);
        };

        if (glass) {
            // sólo la cara larga, sin contorno: las hiladas no se notan en el vidrio
            const long = xpFace.a !== b.axis ? xpFace : ypFace;
            const on = strokeOn;
            strokeOn = false;
            face(long, long === xpFace);
            strokeOn = on;
            return;
        }
        if (b.flat) {
            const on = strokeOn;
            strokeOn = false;
            if (b.top) drawFace([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], pal.top);
            face(ypFace, false);
            face(xpFace, true);
            strokeOn = on;
            if (b.handle) this.drawHandle(ctx, cam, b, xpFace.a !== b.axis ? xpFace : ypFace);
            return;
        }
        if (b.top) {
            drawFace([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], pal.top);
        }
        face(ypFace, false);
        face(xpFace, true);
    }

    // ---------- sombras ----------
    drawShadows(f) {
        const { cam, project, analysis, ui, sun } = f;
        if (!sun || sun.alt < 3) return;
        const theta = (project.north * Math.PI) / 180;
        const north = [Math.sin(theta), -Math.cos(theta)];
        const east = [Math.cos(theta), Math.sin(theta)];
        const az = (sun.az * Math.PI) / 180;
        const toSun = [east[0] * Math.sin(az) + north[0] * Math.cos(az), east[1] * Math.sin(az) + north[1] * Math.cos(az)];
        const k = 1 / Math.tan((sun.alt * Math.PI) / 180);
        const disp = (h) => [-toSun[0] * h * k, -toSun[1] * h * k];

        const sctx = this.shadowCtx;
        sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        sctx.clearRect(0, 0, cam.w, cam.h);
        sctx.fillStyle = '#0f172a';
        const levelH = 300;
        const maxLevel = ui.level;
        for (let li = 0; li <= maxLevel; li++) {
            const zBase = li * levelH;
            const seen = new Set();
            for (const c of [0, 1]) {
                for (const run of analysis.levels[li]?.courses?.[c] ?? []) {
                    const half = run.t / 2;
                    const rect = run.axis === 'x' ? [run.a, run.line - half, run.b, run.line + half] : [run.line - half, run.a, run.line + half, run.b];
                    const key = rect.join(',');
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const [rx0, ry0, rx1, ry1] = rect;
                    const pts = [];
                    for (const [px, py] of [[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]]) {
                        const d0 = disp(zBase);
                        const d1 = disp(zBase + levelH);
                        pts.push([px + d0[0], py + d0[1]], [px + d1[0], py + d1[1]]);
                    }
                    const hull = convexHull(pts).map(([x, y]) => cam.project(x, y, 0));
                    sctx.beginPath();
                    hull.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)));
                    sctx.closePath();
                    sctx.fill();
                }
            }
        }
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.globalAlpha = 0.27;
        this.ctx.drawImage(this.shadow, 0, 0);
        this.ctx.restore();
    }

    // ---------- planta ----------
    drawPlan(f) {
        const { ctx } = this;
        const { cam, project, analysis, ui } = f;
        // En la pestaña Techo se ve la planta del último nivel con muros y, encima, el techo.
        const active = ui.level === 2 ? (project.upper ? 1 : 0) : ui.level;

        for (let li = 0; li <= active; li++) {
            const ghost = li < active;
            const courses = analysis.levels[li]?.courses ?? [];
            const rects = new Map();
            for (const c of [0, 1]) {
                for (const run of courses[c] ?? []) {
                    const half = run.t / 2;
                    const r = run.axis === 'x' ? [run.a, run.line - half, run.b, run.line + half] : [run.line - half, run.a, run.line + half, run.b];
                    rects.set(r.join(','), r);
                }
            }
            if (!ghost) this.drawRoomFloors(f, li, 0);
            const fill = ghost ? '#a9b4c4' : '#1e293b';
            const edge = ghost ? '#94a3b8' : '#0f172a';
            ctx.globalAlpha = ghost ? 0.7 : 1;
            // Primero el contorno (1 px) y luego el relleno: sólo queda la línea exterior de la unión.
            ctx.fillStyle = edge;
            for (const [x0, y0, x1, y1] of rects.values()) this.fillRectPlan(cam, x0 - 0.8 / cam.zoom, y0 - 0.8 / cam.zoom, x1 + 0.8 / cam.zoom, y1 + 0.8 / cam.zoom);
            ctx.fillStyle = fill;
            for (const [x0, y0, x1, y1] of rects.values()) this.fillRectPlan(cam, x0, y0, x1, y1);
            ctx.globalAlpha = 1;
            if (!ghost && ui.level !== 2) this.drawPlanRooms(f, li);
            this.drawPlanOpenings(f, project.levels[li], ghost);
            if (li === 1 && !ghost) this.drawPlanTimber(f, false);
            if (li === 0) this.drawPlanStairs(f, ghost);
            if (li === 1) this.drawPlanSlabs(f);
        }
        if (ui.level === 2) this.drawPlanRoof(f);
    }

    /** Escaleras en planta: peldaños como líneas, descansos rellenos y flecha de subida. */
    drawPlanStairs(f, ghost) {
        const { ctx } = this;
        const { cam, analysis } = f;
        const P = (x, y) => cam.project(x, y, 0);
        ctx.save();
        ctx.globalAlpha = ghost ? 0.6 : 1;
        for (const st of analysis.floors?.stairs ?? []) {
            for (const l of st.landings) {
                ctx.fillStyle = 'rgba(148,163,184,.55)';
                this.fillRectPlan(cam, l.x0, l.y0, l.x1, l.y1);
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 1.4;
                this.strokeRectPlan(cam, l.x0, l.y0, l.x1, l.y1);
            }
            ctx.fillStyle = 'rgba(255,255,255,.55)';
            for (const s of st.steps) this.fillRectPlan(cam, s.x0, s.y0, s.x1, s.y1);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            for (const s of st.steps) this.strokeRectPlan(cam, s.x0, s.y0, s.x1, s.y1);
            // flecha: del primer al último peldaño
            const first = st.steps[0];
            const last = st.steps[st.steps.length - 1];
            if (first && last) {
                const [ax, ay] = P((first.x0 + first.x1) / 2, (first.y0 + first.y1) / 2);
                const [bx, by] = P((last.x0 + last.x1) / 2, (last.y0 + last.y1) / 2);
                ctx.strokeStyle = '#3f6212';
                ctx.fillStyle = '#3f6212';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
                const ang = Math.atan2(by - ay, bx - ax);
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(bx - 9 * Math.cos(ang - 0.45), by - 9 * Math.sin(ang - 0.45));
                ctx.lineTo(bx - 9 * Math.cos(ang + 0.45), by - 9 * Math.sin(ang + 0.45));
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    drawPlanSlabs(f) {
        const { ctx } = this;
        const { cam, analysis } = f;
        ctx.save();
        for (const sl of analysis.floors?.slabs ?? []) {
            ctx.fillStyle = 'rgba(100,116,139,.32)';
            for (const p of sl.parts) this.fillRectPlan(cam, p.x0, p.y0, p.x1, p.y1);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([7, 4]);
            this.strokeRectPlan(cam, sl.rect.x, sl.rect.y, sl.rect.x + sl.rect.w, sl.rect.y + sl.rect.h);
            ctx.setLineDash([]);
            if (cam.zoom > 0.06) {
                ctx.font = '600 11px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#334155';
                const [sx, sy] = cam.project(sl.rect.x + sl.rect.w / 2, sl.rect.y + sl.rect.h / 2, 0);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`Losa ${sl.thickness} cm · ${fmt(sl.areaM2, 1)} m²`, sx, sy);
            }
        }
        ctx.restore();
    }

    /** Techo en planta: faldones, cumbrera (o caída) y pendiente. */
    drawPlanRoof(f) {
        const { ctx } = this;
        const { cam, analysis } = f;
        ctx.save();
        const parts = analysis.roof?.parts ?? [];
        for (const [idx, part] of parts.entries()) {
        const g = part.geometry;
        ctx.lineJoin = 'round';
        for (const pl of g.planes) {
            const holes = planeHoles(parts, idx, planeEq(pl.pts)).map((hp) => hp.map(([x, y]) => cam.project(x, y, 0)));
            withHoles(ctx, holes, () => {
            ctx.beginPath();
            pl.pts.forEach((pt, i) => {
                const [x, y] = cam.project(pt[0], pt[1], 0);
                if (i) ctx.lineTo(x, y);
                else ctx.moveTo(x, y);
            });
            ctx.closePath();
            ctx.fillStyle = 'rgba(196,99,63,.28)';
            ctx.fill();
            ctx.strokeStyle = '#7a3b25';
            ctx.lineWidth = 1.6;
            ctx.stroke();
            });
        }
        if (g.ridge) {
            const a = cam.project(g.ridge.from[0], g.ridge.from[1], 0);
            const b = cam.project(g.ridge.to[0], g.ridge.to[1], 0);
            ctx.strokeStyle = '#4a2110';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
        }
        // flechas de caída, una por faldón (del punto medio del alero hacia el interior)
        ctx.strokeStyle = '#7a3b25';
        ctx.fillStyle = '#7a3b25';
        ctx.lineWidth = 1.5;
        for (const pl of g.planes) {
            const xs = pl.pts.map((p) => p[0]);
            const ys = pl.pts.map((p) => p[1]);
            const zs = pl.pts.map((p) => p[2]);
            const zMax = Math.max(...zs);
            const zMin = Math.min(...zs);
            const hi = pl.pts.filter((p) => p[2] > zMax - 0.5);
            const lo = pl.pts.filter((p) => p[2] < zMin + 0.5);
            if (!hi.length || !lo.length || zMax - zMin < 1) continue;
            const mid = (list) => [list.reduce((a, p) => a + p[0], 0) / list.length, list.reduce((a, p) => a + p[1], 0) / list.length];
            const [hx, hy] = mid(hi);
            const [lx, ly] = mid(lo);
            const [ax, ay] = cam.project(hx, hy, 0);
            const [bx, by] = cam.project(lx, ly, 0);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
            const ang = Math.atan2(by - ay, bx - ax);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - 9 * Math.cos(ang - 0.45), by - 9 * Math.sin(ang - 0.45));
            ctx.lineTo(bx - 9 * Math.cos(ang + 0.45), by - 9 * Math.sin(ang + 0.45));
            ctx.closePath();
            ctx.fill();
            if (cam.zoom > 0.05 && xs.length) {
                ctx.font = '600 11px system-ui, sans-serif';
                ctx.textAlign = 'center';
                const [mx, my] = cam.project((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 0);
                ctx.fillText(`${fmt(pl.areaM2 * (pl.visible ?? 1), 1)} m²`, mx, my - 8);
            }
        }
        }
        ctx.restore();
    }

    strokeRectPlan(cam, x0, y0, x1, y1) {
        const { ctx } = this;
        ctx.beginPath();
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => {
            const [sx, sy] = cam.project(x, y, 0);
            if (i) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
    }

    fillRectPlan(cam, x0, y0, x1, y1) {
        const a = cam.project(x0, y0, 0);
        const b = cam.project(x1, y1, 0);
        const c = cam.project(x1, y0, 0);
        const d = cam.project(x0, y1, 0);
        const { ctx } = this;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fill();
    }

    drawPlanRooms(f, li) {
        const { ctx } = this;
        const { cam, analysis } = f;
        if (cam.zoom < 0.06) return;
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const r of analysis.levels[li]?.rooms ?? []) {
            const cx = (r.bbox.x + r.bbox.w / 2) * G;
            const cy = (r.bbox.y + r.bbox.h / 2) * G;
            const [sx, sy] = cam.project(cx, cy, 0);
            this.pill(ctx, `${r.name}`, `${fmt(r.netM2, 2)} m²`, sx, sy);
        }
    }

    pill(ctx, line1, line2, sx, sy) {
        const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 14;
        ctx.fillStyle = 'rgba(255,255,255,.86)';
        ctx.strokeStyle = 'rgba(30,41,59,.25)';
        roundRect(ctx, sx - w / 2, sy - 18, w, 36, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1e293b';
        ctx.fillText(line1, sx, sy - 6);
        ctx.fillStyle = '#3f6212';
        ctx.fillText(line2, sx, sy + 8);
    }

    drawPlanOpenings(f, level, ghost) {
        const { ctx } = this;
        const { cam } = f;
        for (const o of level.openings ?? []) {
            const w = level.walls.find((x) => x.id === o.wall);
            if (!w) continue;
            const horizontal = w.y1 === w.y2;
            const from = (horizontal ? w.x1 : w.y1) * G + o.pos * G;
            const len = o.w * G;
            const line = (horizontal ? w.y1 : w.x1) * G;
            const t = w.t;
            const rect = horizontal ? [from, line - t / 2 - 0.3, from + len, line + t / 2 + 0.3] : [line - t / 2 - 0.3, from, line + t / 2 + 0.3, from + len];
            ctx.globalAlpha = ghost ? 0.7 : 1;
            ctx.fillStyle = '#f7f9ff';
            this.fillRectPlan(cam, ...rect);
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 1.2;
            const P = (x, y) => cam.project(x, y, 0);
            ctx.beginPath();
            if (o.kind === 'window') {
                for (const off of [-t / 4, 0, t / 4]) {
                    const [a, b] = horizontal ? [P(from, line + off), P(from + len, line + off)] : [P(line + off, from), P(line + off, from + len)];
                    ctx.moveTo(a[0], a[1]);
                    ctx.lineTo(b[0], b[1]);
                }
                ctx.stroke();
            } else {
                // hoja de puerta abierta 90° + arco de giro
                const sign = o.flip ? -1 : 1;
                const hinge = horizontal ? [from, line] : [line, from];
                const tip = horizontal ? [from, line + sign * len] : [line + sign * len, from];
                const [h0, h1] = [P(...hinge), P(...tip)];
                ctx.moveTo(h0[0], h0[1]);
                ctx.lineTo(h1[0], h1[1]);
                ctx.stroke();
                ctx.beginPath();
                ctx.lineWidth = 0.9;
                ctx.strokeStyle = 'rgba(30,41,59,.6)';
                const steps = 12;
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * (Math.PI / 2);
                    const px = horizontal ? from + Math.cos(a) * len : line + sign * Math.sin(a) * len;
                    const py = horizontal ? line + sign * Math.sin(a) * len : from + Math.cos(a) * len;
                    const [sx, sy] = P(px, py);
                    if (i) ctx.lineTo(sx, sy);
                    else ctx.moveTo(sx, sy);
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
    }

    drawPlanTimber(f, ghost) {
        const { ctx } = this;
        const { cam, analysis } = f;
        const timber = analysis.timber;
        if (!timber) return;
        for (const fld of timber.fields ?? []) {
            // Sombreado suave del paño y tirantes como líneas finas continuas (sin guiones que ensucian la planta).
            ctx.fillStyle = ghost ? 'rgba(217,160,91,.10)' : 'rgba(217,160,91,.16)';
            this.fillRectPlan(cam, fld.rect.x, fld.rect.y, fld.rect.x + fld.rect.w, fld.rect.y + fld.rect.h);
            ctx.strokeStyle = ghost ? 'rgba(176,120,50,.45)' : 'rgba(176,120,50,.8)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            const pxGap = fld.spacingCm * cam.zoom;
            const skip = pxGap < 3 ? Math.ceil(3 / pxGap) : 1; // no dibujar tirantes a menos de 3 px entre sí
            fld.joists.forEach((j, i) => {
                if (i % skip) return;
                const a = cam.project(j.x1, j.y1, 0);
                const b = cam.project(j.x2, j.y2, 0);
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
            });
            ctx.stroke();
            if (!ghost && cam.zoom > 0.05) {
                ctx.font = '600 11px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const [sx, sy] = cam.project(fld.rect.x + fld.rect.w / 2, fld.rect.y + fld.rect.h / 2, 0);
                const label = `${fld.count} tirantes ${fld.section.replace('x', '″×')}″ c/${fmt(fld.spacingCm, 0)} cm`;
                const w = ctx.measureText(label).width + 10;
                ctx.fillStyle = 'rgba(255,255,255,.85)';
                roundRect(ctx, sx - w / 2, sy - 9, w, 18, 5);
                ctx.fill();
                ctx.fillStyle = '#7a4a12';
                ctx.fillText(label, sx, sy);
            }
        }
        ctx.strokeStyle = '#8a5a1f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const b of timber.beams ?? []) {
            const p = cam.project(b.x1, b.y1, 0);
            const q = cam.project(b.x2, b.y2, 0);
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(q[0], q[1]);
        }
        ctx.stroke();
    }

    // ---------- rosa de los vientos y sol ----------
    drawCompass(f) {
        const { ctx } = this;
        const { cam, project, sun, ui } = f;
        if (!project) return;
        // Brújula con el sol, arriba a la derecha del lienzo.
        const r = 30;
        const cx = cam.w - 50;
        const cy = 50;
        const dirOf = (vx, vy) => {
            const [X, Y] = Camera.rotate(vx, vy, cam.rot);
            const [sx, sy] = cam.view === 'plan' ? [X, Y] : [(X - Y) * Math.cos(Math.PI / 6), (X + Y) * 0.5];
            const len = Math.hypot(sx, sy) || 1;
            return [sx / len, sy / len];
        };
        const theta = (project.north * Math.PI) / 180;
        const north = dirOf(Math.sin(theta), -Math.cos(theta));

        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,.88)';
        ctx.strokeStyle = 'rgba(30,41,59,.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // cardinales
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cardinals = [['N', 0, '#b42318'], ['E', 90, '#1e293b'], ['S', 180, '#1e293b'], ['O', 270, '#1e293b']];
        for (const [label, deg, color] of cardinals) {
            const a = ((project.north + deg) * Math.PI) / 180;
            const d = dirOf(Math.sin(a), -Math.cos(a));
            ctx.fillStyle = color;
            ctx.fillText(label, cx + d[0] * (r - 4), cy + d[1] * (r - 4));
        }
        // aguja del norte
        ctx.strokeStyle = '#b42318';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + north[0] * (r - 14), cy + north[1] * (r - 14));
        ctx.stroke();
        if (sun && ui.solar.show) {
            const theta2 = theta;
            const n2 = [Math.sin(theta2), -Math.cos(theta2)];
            const e2 = [Math.cos(theta2), Math.sin(theta2)];
            const az = (sun.az * Math.PI) / 180;
            const dir = dirOf(e2[0] * Math.sin(az) + n2[0] * Math.cos(az), e2[1] * Math.sin(az) + n2[1] * Math.cos(az));
            const up = sun.alt > 0;
            ctx.fillStyle = up ? '#f5b301' : '#94a3b8';
            ctx.strokeStyle = '#7a5a00';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx + dir[0] * (r + 6), cy + dir[1] * (r + 6), 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#1e293b';
            ctx.font = '600 11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            const hh = Math.floor(sun.h);
            const mm = String(Math.round((sun.h - hh) * 60)).padStart(2, '0');
            ctx.fillText(`${String(hh).padStart(2, '0')}:${mm} · ${up ? `sol ${fmt(sun.alt, 0)}°` : 'noche'}`, cx, cy + r + 18);
        }
        ctx.restore();
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Envolvente convexa (cadena monótona de Andrew). */
export function convexHull(points) {
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (const p of [...pts].reverse()) {
        while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
        upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}
