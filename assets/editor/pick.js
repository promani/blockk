/** Selección por geometría en pantalla: envolvente convexa de cada muro (iso) o rectángulo (planta). */
import { Camera } from './camera.js';
import { convexHull } from './renderer.js';
import { roofOuter } from './scene.js';

export const G = 12.5;

export function wallRect(w) {
    const t = w.t / 2;
    const x0 = w.x1 * G;
    const y0 = w.y1 * G;
    const x1 = w.x2 * G;
    const y1 = w.y2 * G;
    return w.y1 === w.y2 ? [x0, y0 - t, x1, y1 + t] : [x0 - t, y0, x1 + t, y1];
}

function inHull(hull, px, py) {
    if (hull.length < 3) return false;
    let sign = 0;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
        if (cross !== 0) {
            const s = Math.sign(cross);
            if (sign === 0) sign = s;
            else if (s !== sign) return false;
        }
    }
    return true;
}

function boxHull(cam, [x0, y0, x1, y1], zBase, height) {
    const pts = [];
    const zs = cam.view === 'plan' ? [zBase] : [zBase, zBase + height];
    for (const z of zs) for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) pts.push(cam.project(x, y, z));
    return convexHull(pts);
}

/** Profundidad relativa (mayor = más cerca de la cámara) del punto más cercano del rectángulo al puntero. */
function depthOf(cam, rect, wx, wy) {
    const cx = Math.min(Math.max(wx, rect[0]), rect[2]);
    const cy = Math.min(Math.max(wy, rect[1]), rect[3]);
    const [X, Y] = Camera.rotate(cx, cy, cam.rot);
    return X + Y;
}

/** Muro del nivel activo bajo el puntero (sx, sy). */
export function pickWall(app, sx, sy) {
    const { cam, store } = app;
    const level = store.level();
    const base = store.ui.level * store.config.levelHeight;
    const [wx, wy] = cam.unproject(sx, sy, base + 150);
    let best = null;
    for (const w of level.walls) {
        const rect = wallRect(w);
        const hull = boxHull(cam, rect, base, (w.h ?? 12) * 25);
        if (!inHull(hull, sx, sy)) continue;
        const depth = depthOf(cam, rect, wx, wy);
        if (!best || depth > best.depth) best = { wall: w, depth };
    }
    return best?.wall ?? null;
}

/** Posición a lo largo del muro (unidades de 12,5 cm, fraccionaria) bajo el puntero, a media altura. */
export function alongPosition(app, wall, sx, sy) {
    const base = app.store.ui.level * app.store.config.levelHeight;
    const [wx, wy] = app.cam.unproject(sx, sy, base + 100);
    const horizontal = wall.y1 === wall.y2;
    return ((horizontal ? wx : wy) - (horizontal ? wall.x1 : wall.y1) * G) / G;
}

function inPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Techo (o su hastial) bajo el puntero, en la pestaña Techo: el más cercano a la cámara. */
function pickRoof(app, sx, sy) {
    const { cam, store } = app;
    const parts = store.analysis?.roof?.parts ?? [];
    if (cam.view === 'plan') {
        const [wx, wy] = cam.unproject(sx, sy, 0);
        const hits = parts.filter((p) => {
            const g = p.geometry;
            const r = roofOuter(g);
            return wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1;
        });
        hits.sort((a, b) => b.level - a.level || area(a) - area(b));
        return hits[0] ? { type: 'roof', id: hits[0].id } : null;
    }
    const depth = (p) => {
        const g = p.geometry;
        const [X, Y] = Camera.rotate((g.rect.x0 + g.rect.x1) / 2, (g.rect.y0 + g.rect.y1) / 2, cam.rot);
        return p.level * 10000 + X + Y;
    };
    for (const part of [...parts].sort((a, b) => depth(b) - depth(a))) {
        const proj = (pts) => pts.map((q) => cam.project(q[0], q[1], q[2]));
        for (const gb of part.geometry.gables ?? []) {
            if (gb.enabled && inPoly(proj(gb.pts), sx, sy)) return { type: 'gable', id: gb.id };
        }
        for (const pl of part.geometry.planes ?? []) {
            if (inPoly(proj(pl.pts), sx, sy)) return { type: 'roof', id: part.id };
        }
    }
    return null;
}

const area = (p) => (p.geometry.rect.x1 - p.geometry.rect.x0) * (p.geometry.rect.y1 - p.geometry.rect.y0);

/** Elemento bajo el puntero: vano, muro, madera, losa, escalera, habitación (piso) o techo. */
export function pickAt(app, sx, sy) {
    const { store, cam } = app;
    if (store.ui.level === 2) return pickRoof(app, sx, sy);
    const wall = pickWall(app, sx, sy);
    if (wall) {
        const along = alongPosition(app, wall, sx, sy);
        const level = store.level();
        const opening = level.openings.find((o) => o.wall === wall.id && along >= o.pos && along <= o.pos + o.w);
        if (opening) return { type: 'opening', id: opening.id, wall: wall.id };
        return { type: 'wall', id: wall.id };
    }
    if (store.ui.level === 1 && store.analysis?.timber) {
        const z = store.config.levelHeight;
        const [wx, wy] = cam.unproject(sx, sy, z + 20);
        for (const f of store.analysis.timber.fields ?? []) {
            const r = f.rect;
            if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return { type: 'timber', id: f.id };
        }
        for (const b of store.analysis.timber.beams ?? []) {
            const near = Math.abs(b.x1 - b.x2) < 0.01 ? Math.abs(wx - b.x1) < 12 && wy >= Math.min(b.y1, b.y2) - 6 && wy <= Math.max(b.y1, b.y2) + 6 : Math.abs(wy - b.y1) < 12 && wx >= Math.min(b.x1, b.x2) - 6 && wx <= Math.max(b.x1, b.x2) + 6;
            if (near) return { type: 'timber', id: b.id };
        }
    }
    if (store.analysis?.floors) {
        if (store.ui.level === 1) {
            const [wx, wy] = cam.unproject(sx, sy, store.config.levelHeight + 8);
            for (const sl of store.analysis.floors.slabs ?? []) {
                const r = sl.rect;
                if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return { type: 'slab', id: sl.id };
            }
        }
        if (store.ui.level === 0) {
            // los peldaños suben: se prueba a media altura de la escalera
            const [wx, wy] = cam.unproject(sx, sy, store.config.levelHeight / 2);
            for (const st of store.analysis.floors.stairs ?? []) {
                const b = st.bbox;
                if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return { type: 'stair', id: st.id };
            }
        }
    }
    if (store.ui.level <= 1) {
        // Piso de una habitación cerrada (se elige para verla y cambiarle el tamaño desde las esquinas).
        const [wx, wy] = cam.unproject(sx, sy, store.ui.level * store.config.levelHeight);
        const ux = wx / G;
        const uy = wy / G;
        for (const room of store.analysis?.levels?.[store.ui.level]?.rooms ?? []) {
            if (room.fill?.some(([x, y, w, h]) => ux >= x && ux < x + w && uy >= y && uy < y + h)) return { type: 'room', id: room.id };
        }
    }
    return null;
}
