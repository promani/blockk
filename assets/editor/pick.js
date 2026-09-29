/** Selección por geometría en pantalla: envolvente convexa de cada muro (iso) o rectángulo (planta). */
import { Camera } from './camera.js';
import { convexHull } from './renderer.js';

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
        const hull = boxHull(cam, rect, base, store.config.levelHeight);
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

/** Elemento bajo el puntero: vano, muro, madera, losa o escalera. */
export function pickAt(app, sx, sy) {
    const { store, cam } = app;
    const wall = pickWall(app, sx, sy);
    if (wall) {
        const along = alongPosition(app, wall, sx, sy);
        const level = store.level();
        const opening = level.openings.find((o) => o.wall === wall.id && along >= o.pos && along <= o.pos + o.w);
        if (opening) return { type: 'opening', id: opening.id, wall: wall.id };
        return { type: 'wall', id: wall.id };
    }
    if (store.ui.level === 0 && store.analysis?.timber) {
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
    return null;
}
