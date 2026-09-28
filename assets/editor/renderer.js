/**
 * Dibujo del lienzo (Canvas 2D). Dos vistas con el mismo modelo:
 *  - isométrica 30°/30°, con oclusión por algoritmo del pintor sobre cajas de cada pieza;
 *  - planta cenital 2D con simbología de puertas y ventanas y rótulos de ambientes.
 * El dibujo es bajo demanda (rAF sólo cuando hay cambios): 60 FPS sin GPU dedicada.
 */
import { Camera } from './camera.js';
import { KIND, sortedItems, visibleFaces } from './scene.js';
import { fmt } from '../lib/format.js';

const G = 12.5;

const BASE = {
    [KIND.BLOCK]: '#e7ebf1',
    [KIND.CUT]: '#f4d99a',
    [KIND.U]: '#9fd15c',
    [KIND.UCUT]: '#c2df95',
    [KIND.DOOR]: '#b9834f',
    [KIND.JOIST]: '#d9a05b',
    [KIND.DECK]: '#ecd2a0',
    [KIND.BEAM]: '#c48a45',
};

function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const PALETTE = Object.fromEntries(Object.entries(BASE).map(([k, hex]) => [k, { top: shade(hex, 1.03), yp: shade(hex, 0.88), xp: shade(hex, 0.74) }]));

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
        const { ctx, dpr } = this;
        const { cam } = f;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cam.w, cam.h);
        ctx.fillStyle = '#e9eef6';
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
        const W = (project?.lot?.w ?? 24) * 100;
        const D = (project?.lot?.d ?? 20) * 100;
        const z = 0;
        const corners = [[0, 0], [W, 0], [W, D], [0, D]].map(([x, y]) => cam.project(x, y, z));
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = '#e1e9d6';
        ctx.fill();

        const step = ui.snap === 5 ? 62.5 : 62.5;
        const px = step * cam.zoom * (cam.view === 'plan' ? 1 : 0.87);
        ctx.lineWidth = 1;
        if (px >= 7) {
            ctx.strokeStyle = 'rgba(30,41,59,.09)';
            ctx.beginPath();
            for (let x = 0; x <= W + 0.1; x += step) this.seg(cam, x, 0, x, D, z);
            for (let y = 0; y <= D + 0.1; y += step) this.seg(cam, 0, y, W, y, z);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(30,41,59,.2)';
        ctx.beginPath();
        for (let x = 0; x <= W + 0.1; x += 100) this.seg(cam, x, 0, x, D, z);
        for (let y = 0; y <= D + 0.1; y += 100) this.seg(cam, 0, y, W, y, z);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(30,41,59,.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
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
        for (const it of list) {
            const b = it.b;
            if (b.level > activeLevel) continue;
            // Descarte de cajas fuera de la pantalla (proyectos grandes con zoom cercano).
            const [px, py] = cam.project((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
            const reach = (Math.max(b.x1 - b.x0, b.y1 - b.y0) + (b.z1 - b.z0)) * cam.zoom;
            if (px + reach < -margin || px - reach > cam.w + margin || py + reach < -margin || py - reach > cam.h + margin) continue;
            if (b.level === activeLevel && b.course !== undefined && b.kind <= KIND.UCUT && b.course >= ui.cut) continue;
            if (b.kind === KIND.DOOR || b.kind === KIND.GLASS) {
                if (b.level === activeLevel && b.course >= ui.cut) continue;
            }
            const ghostDeck = b.deck && activeLevel === 0;
            if (ghostDeck) ctx.globalAlpha = 0.32;
            this.drawBox(ctx, cam, it, strokeOn);
            if (ghostDeck) ctx.globalAlpha = 1;
        }
    }

    drawBox(ctx, cam, it, strokeOn) {
        const b = it.b;
        const rot = cam.rot;
        const glass = b.kind === KIND.GLASS;
        const pal = PALETTE[b.kind];
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
            drawFace(pts, glass ? 'rgba(96,165,220,.42)' : isXp ? pal.xp : pal.yp);
        };

        if (glass) {
            const save = ctx.strokeStyle;
            ctx.strokeStyle = 'rgba(30,41,59,.65)';
            ctx.lineWidth = 1;
            const long = xpFace.a !== b.axis ? xpFace : ypFace;
            face(long, long === xpFace);
            ctx.lineWidth = 0.6;
            ctx.strokeStyle = save;
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
        const active = ui.level;

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
            const fill = ghost ? '#a9b4c4' : '#1e293b';
            const edge = ghost ? '#94a3b8' : '#0f172a';
            ctx.globalAlpha = ghost ? 0.7 : 1;
            // Primero el contorno (1 px) y luego el relleno: sólo queda la línea exterior de la unión.
            ctx.fillStyle = edge;
            for (const [x0, y0, x1, y1] of rects.values()) this.fillRectPlan(cam, x0 - 0.8 / cam.zoom, y0 - 0.8 / cam.zoom, x1 + 0.8 / cam.zoom, y1 + 0.8 / cam.zoom);
            ctx.fillStyle = fill;
            for (const [x0, y0, x1, y1] of rects.values()) this.fillRectPlan(cam, x0, y0, x1, y1);
            ctx.globalAlpha = 1;
            if (!ghost) this.drawPlanRooms(f, li);
            this.drawPlanOpenings(f, project.levels[li], ghost);
            if (li === 0) this.drawPlanTimber(f, ghost);
        }
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
        ctx.strokeStyle = ghost ? 'rgba(176,120,50,.55)' : '#b07832';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        for (const fld of timber.fields ?? []) {
            for (const j of fld.joists) {
                const a = cam.project(j.x1, j.y1, 0);
                const b = cam.project(j.x2, j.y2, 0);
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
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
        const r = 30;
        const cx = 52;
        const cy = cam.h - 58;
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
            ctx.textAlign = 'left';
            const hh = Math.floor(sun.h);
            const mm = String(Math.round((sun.h - hh) * 60)).padStart(2, '0');
            ctx.fillText(`${String(hh).padStart(2, '0')}:${mm} · ${up ? `sol ${fmt(sun.alt, 0)}°` : 'noche'}`, cx + r + 20, cy - 2);
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
