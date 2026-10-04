/**
 * Ventanas en los hastiales (y en el muro alto de un techo a un agua): se colocan, eligen y mueven como las de un muro.
 * El hastial es un plano vertical: el puntero se lleva a coordenadas (u a lo largo del muro, v sobre su base) y de ahí
 * sale el lugar de la ventana en unidades de 12,5 cm y en hiladas. El servidor cala el vano, pone el dintel y avisa si
 * no entra; acá sólo se arma la intención y el fantasma.
 */
import { Camera } from './camera.js';

export const G = 12.5;
const COURSE = 25;
/** Jamba mínima (cm) entre la ventana y el borde del hastial o la ventana de al lado. */
const JAMB = 25;

/** Hastiales habilitados del análisis, con su techo y su lado. */
export function gablesOf(store) {
    return (store.analysis?.roof?.parts ?? []).flatMap((p) => (p.geometry.gables ?? [])
        .filter((gb) => gb.enabled && gb.plane)
        .map((gb) => ({ gb, roof: p.id, side: String(gb.id).split(':')[1] })));
}

export function findGable(store, id) {
    return gablesOf(store).find((g) => g.gb.id === id) ?? null;
}

/** Contorno del hastial en (u, v): u a lo largo del muro, v sobre la base (cm). */
const uvOf = (gb) => gb.pts.map((p) => [gb.plane.axis === 'y' ? p[1] : p[0], p[2] - gb.plane.z]);

/** Alto del contorno en la abscisa u (−∞ fuera del hastial). */
export function topAt(gb, u) {
    const uv = uvOf(gb);
    let best = -Infinity;
    uv.forEach((a, i) => {
        const c = uv[(i + 1) % uv.length];
        if (u < Math.min(a[0], c[0]) - 1e-6 || u > Math.max(a[0], c[0]) + 1e-6) return;
        best = Math.max(best, a[0] === c[0] ? Math.max(a[1], c[1]) : a[1] + ((c[1] - a[1]) * (u - a[0])) / (c[0] - a[0]));
    });
    return best;
}

/** Punto del plano del hastial (u, v en cm) bajo el puntero: la vista es una proyección paralela, así que es exacto. */
export function uvAt(cam, gb, sx, sy) {
    const { axis, at, z } = gb.plane;
    const P = (u, v) => cam.project(axis === 'x' ? u : at, axis === 'x' ? at : u, z + v);
    const o = P(0, 0);
    const pu = P(100, 0);
    const pv = P(0, 100);
    const a = [(pu[0] - o[0]) / 100, (pu[1] - o[1]) / 100];
    const b = [(pv[0] - o[0]) / 100, (pv[1] - o[1]) / 100];
    const det = a[0] * b[1] - a[1] * b[0];
    if (Math.abs(det) < 1e-9) return null; // de canto: no se puede apuntar
    const dx = sx - o[0];
    const dy = sy - o[1];
    return { u: (dx * b[1] - dy * b[0]) / det, v: (a[0] * dy - a[1] * dx) / det };
}

/** Caja 3D (cm) de una ventana del modelo { pos, w, sill, h } en el hastial. */
export function windowBox(gb, w) {
    const { axis, at, z } = gb.plane;
    const half = (gb.thickness ?? 20) / 2;
    const u0 = w.pos * G;
    const u1 = (w.pos + w.w) * G;
    return {
        x0: axis === 'x' ? u0 : at - half, x1: axis === 'x' ? u1 : at + half,
        y0: axis === 'x' ? at - half : u0, y1: axis === 'x' ? at + half : u1,
        z0: z + w.sill * COURSE, z1: z + (w.sill + w.h) * COURSE,
    };
}

/** Ventana del hastial bajo el puntero ({ type: 'gwindow', id: 'r1:v2', gable }) o null. */
export function pickGableWindow(store, cam, sx, sy, inPoly, only = null) {
    for (const { gb, roof, side } of gablesOf(store)) {
        if (only && gb.id !== only) continue;
        const r = store.project.roofs?.find((x) => x.id === roof);
        for (const w of (r?.windows ?? []).filter((q) => q.side === side)) {
            const b = windowBox(gb, w);
            const at = gb.plane.at;
            const pts = gb.plane.axis === 'x'
                ? [[b.x0, at, b.z0], [b.x1, at, b.z0], [b.x1, at, b.z1], [b.x0, at, b.z1]]
                : [[at, b.y0, b.z0], [at, b.y1, b.z0], [at, b.y1, b.z1], [at, b.y0, b.z1]];
            if (inPoly(pts.map((p) => cam.project(...p)), sx, sy)) return { type: 'gwindow', id: `${roof}:${w.id}`, gable: gb.id };
        }
    }
    return null;
}

/**
 * Lugar para una ventana de `w` unidades y `h` hiladas centrada en el punto (u, v) del hastial: se corre para dejar
 * jambas de 25 cm a los bordes, baja si la pendiente no la deja entera y, si hace falta, se achica hasta 2 hiladas.
 * `self` es la ventana que se está moviendo (no choca consigo misma); `fixedH` no deja achicarla.
 */
export function gableSpot(store, g, p, w, h, self = null, fixedH = false) {
    const { gb, roof, side } = g;
    const uv = uvOf(gb);
    const us = uv.map((q) => q[0]);
    const uMin = Math.min(...us);
    const uMax = Math.max(...us);
    const lo = Math.ceil((uMin + JAMB) / G - 1e-6);
    const hi = Math.floor((uMax - JAMB) / G + 1e-6) - w;
    const spot = { g, roof, side, w, h, ok: false };
    if (hi < lo) return { ...spot, pos: Math.round(p.u / G - w / 2), sill: 0, reason: 'El hastial es muy angosto para una ventana de ese ancho.' };
    const pos = Math.min(hi, Math.max(lo, Math.round(p.u / G - w / 2)));
    // alto libre en las jambas: la ventana y su dintel tienen que quedar debajo de la pendiente
    const room = Math.floor(Math.min(topAt(gb, pos * G - JAMB), topAt(gb, (pos + w) * G + JAMB)) / COURSE + 1e-6) - 1;
    let sill = Math.max(0, Math.round(p.v / COURSE - h / 2));
    let hh = h;
    if (sill + hh > room) sill = Math.max(0, room - hh);
    if (sill + hh > room && !fixedH) hh = room - sill;
    Object.assign(spot, { pos, sill, h: hh });
    if (hh < 2 || sill + hh > room) return { ...spot, reason: 'No entra debajo de la pendiente: probá más cerca del medio, más angosta o subí la pendiente.' };
    const r = store.project.roofs?.find((x) => x.id === roof);
    const gap = JAMB / G;
    const clash = (r?.windows ?? []).some((q) => q.side === side && q.id !== self?.id && pos < q.pos + q.w + gap && pos + w + gap > q.pos);
    if (clash) return { ...spot, reason: 'Se pisa con otra ventana del hastial (dejá 25 cm entre una y otra).' };
    spot.ok = true;
    return spot;
}

/** Hastial bajo el puntero (el de más adelante) con el punto (u, v) en su plano. */
export function gableAt(store, cam, sx, sy, inPoly) {
    let best = null;
    for (const g of gablesOf(store)) {
        if (!inPoly(g.gb.pts.map((q) => cam.project(q[0], q[1], q[2])), sx, sy)) continue;
        const p = uvAt(cam, g.gb, sx, sy);
        if (!p) continue;
        // más adelante = mayor profundidad de pantalla del punto apuntado (x + y rotados)
        const { axis, at } = g.gb.plane;
        const [wx, wy] = axis === 'x' ? [p.u, at] : [at, p.u];
        const [X, Y] = Camera.rotate(wx, wy, cam.rot);
        const depth = X + Y;
        if (!best || depth > best.depth) best = { g, p, depth };
    }
    return best;
}
