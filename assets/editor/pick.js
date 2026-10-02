/** Selección por geometría en pantalla: envolvente convexa de cada muro (iso) o rectángulo (planta). */
import { Camera } from './camera.js';
import { convexHull } from './renderer.js';
import { roofOuter } from './scene.js';
import { TREE_SIZES } from './site.js';
import { furnitureRect, footprint, furnitureOn, treesOn } from './furniture.js';

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

/**
 * Profundidad real del primer punto de la caja que toca el rayo del puntero (mayor = más cerca de la cámara), o null si
 * no la toca. En isométrica, a lo largo del rayo z y X+Y crecen juntos hacia la cámara: basta el mayor z dentro de la
 * caja. En planta gana la caja más alta.
 */
function rayDepth(cam, sx, sy, [x0, y0, x1, y1], z0, z1) {
    if (cam.view === 'plan') {
        const [x, y] = cam.unproject(sx, sy, 0);
        return x >= x0 && x <= x1 && y >= y0 && y <= y1 ? z1 : null;
    }
    const [ax, ay] = cam.unproject(sx, sy, z0);
    const [bx, by] = cam.unproject(sx, sy, z1);
    let lo = 0;
    let hi = 1;
    for (const [a, b, min, max] of [[ax, bx, x0, x1], [ay, by, y0, y1]]) {
        const d = b - a;
        if (Math.abs(d) < 1e-9) {
            if (a < min || a > max) return null;
            continue;
        }
        let t0 = (min - a) / d;
        let t1 = (max - a) / d;
        if (t0 > t1) [t0, t1] = [t1, t0];
        lo = Math.max(lo, t0);
        hi = Math.min(hi, t1);
    }
    if (lo > hi) return null;
    const z = z0 + (z1 - z0) * hi;
    const [x, y] = cam.unproject(sx, sy, z);
    const [X, Y] = Camera.rotate(x, y, cam.rot);
    return X + Y + 2 * z;
}

/** Muro del nivel activo bajo el puntero (sx, sy). */
export function pickWall(app, sx, sy) {
    return pickWallHit(app, sx, sy)?.wall ?? null;
}

/** Igual que pickWall, con la profundidad del muro (para compararla con otros elementos). */
function pickWallHit(app, sx, sy) {
    const { cam, store } = app;
    const level = store.level();
    const base = store.ui.level * store.config.levelHeight;
    const [wx, wy] = cam.unproject(sx, sy, base + 150);
    let best = null;
    for (const w of level.walls) {
        const rect = wallRect(w);
        const hull = boxHull(cam, rect, base, (w.h ?? 12) * 25);
        if (!inHull(hull, sx, sy)) continue;
        const depth = rayDepth(cam, sx, sy, rect, base, base + (w.h ?? 12) * 25) ?? depthOf(cam, rect, wx, wy);
        if (!best || depth > best.depth) best = { wall: w, depth };
    }
    return best;
}

/** Pilar del nivel activo bajo el puntero, con su profundidad. */
function pickColumnHit(app, sx, sy) {
    const { cam, store } = app;
    const base = store.ui.level * store.config.levelHeight;
    const top = base + store.config.levelHeight;
    const [wx, wy] = cam.unproject(sx, sy, base + 150);
    let best = null;
    for (const c of store.level().columns ?? []) {
        const half = c.size / 2;
        const rect = [c.x * G - half, c.y * G - half, c.x * G + half, c.y * G + half];
        if (!inHull(boxHull(cam, rect, base, top - base), sx, sy)) continue;
        const depth = rayDepth(cam, sx, sy, rect, base, top) ?? depthOf(cam, rect, wx, wy);
        if (!best || depth > best.depth) best = { id: c.id, depth };
    }
    return best;
}

/** Mueble del nivel activo bajo el puntero, con su profundidad. */
function pickFurnitureHit(app, sx, sy) {
    const { cam, store } = app;
    if (!furnitureOn(store.ui)) return null;
    const base = store.ui.level * store.config.levelHeight;
    let best = null;
    for (const f of store.level().furniture ?? []) {
        const rect = furnitureRect(store.config, f);
        if (!rect) continue;
        const h = footprint(store.config, f).h;
        if (!inHull(boxHull(cam, rect, base, h), sx, sy)) continue;
        const [wx, wy] = cam.unproject(sx, sy, base + h);
        const depth = rayDepth(cam, sx, sy, rect, base, base + h) ?? depthOf(cam, rect, wx, wy);
        if (!best || depth > best.depth) best = { id: f.id, depth };
    }
    return best;
}

/** Árbol bajo el puntero (su copa), con una profundidad comparable a la de los muros. */
function pickTreeHit(app, sx, sy) {
    const { cam, store } = app;
    let best = null;
    for (const t of store.project.trees ?? []) {
        const d = TREE_SIZES[t.size] ?? TREE_SIZES.M;
        const cx = t.x * G;
        const cy = t.y * G;
        let depth;
        if (cam.view === 'plan') {
            const [wx, wy] = cam.unproject(sx, sy, 0);
            if (Math.hypot(wx - cx, wy - cy) > d.r) continue;
            depth = 1e6;
        } else {
            const [px, py] = cam.project(cx, cy, d.h - d.r);
            const [qx, qy] = cam.project(cx + 1, cy, d.h - d.r);
            if (Math.hypot(sx - px, sy - py) > d.r * Math.hypot(qx - px, qy - py) * 1.18) continue;
            const [X, Y] = Camera.rotate(cx, cy, cam.rot);
            depth = X + Y + 2 * (d.h - d.r);
        }
        if (!best || depth > best.depth) best = { id: t.id, depth };
    }
    return best;
}

/** Nombre de ambiente bajo el puntero (sólo en planta, donde se dibujan). */
function pickLabel(app, sx, sy) {
    const { cam, store } = app;
    if (cam.view !== 'plan') return null;
    for (const lb of store.level().labels ?? []) {
        const [lx, ly] = cam.project((lb.x + 0.5) * G, (lb.y + 0.5) * G, 0);
        if (Math.abs(sx - lx) <= Math.max(28, lb.name.length * 3.6 + 10) && Math.abs(sy - ly) <= 16) return { type: 'label', id: lb.id };
    }
    return null;
}

/**
 * Escalera bajo el puntero: se prueba cada peldaño y descanso como caja en pantalla (no un plano a media altura, que
 * deja afuera los peldaños de abajo y de arriba). Devuelve la más cercana a la cámara.
 */
function pickStairHit(app, sx, sy) {
    const { cam, store } = app;
    const [wx, wy] = cam.unproject(sx, sy, 150);
    let best = null;
    for (const st of store.analysis?.floors?.stairs ?? []) {
        for (const b of [...st.steps, ...st.landings]) {
            const rect = [b.x0, b.y0, b.x1, b.y1];
            const h = Math.max(12, st.riseCm);
            if (!inHull(boxHull(cam, rect, Math.max(0, b.z - h), h), sx, sy)) continue;
            const depth = rayDepth(cam, sx, sy, rect, Math.max(0, b.z - h), b.z) ?? depthOf(cam, rect, wx, wy);
            if (!best || depth > best.depth) best = { id: st.id, depth };
        }
    }
    return best;
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
    if (store.ui.level <= 1) {
        const named = pickLabel(app, sx, sy);
        if (named) return named;
    }
    const hit = pickWallHit(app, sx, sy);
    const column = pickColumnHit(app, sx, sy);
    const tree = store.ui.level <= 1 && treesOn(store.ui) ? pickTreeHit(app, sx, sy) : null;
    if (tree && (!hit || tree.depth > hit.depth) && (!column || tree.depth > column.depth)) return { type: 'tree', id: tree.id };
    if (column && (!hit || column.depth > hit.depth)) return { type: 'column', id: column.id };
    const furniture = pickFurnitureHit(app, sx, sy);
    if (furniture && (!hit || furniture.depth > hit.depth)) return { type: 'furniture', id: furniture.id };
    // En la planta baja, una escalera delante de la pared del fondo gana sobre la pared (y una pared delante, sobre ella).
    const stair = store.ui.level === 0 ? pickStairHit(app, sx, sy) : null;
    if (stair && (!hit || stair.depth > hit.depth)) return { type: 'stair', id: stair.id };
    const wall = hit?.wall;
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
    }
    if (store.ui.level <= 1) {
        // Piso de una habitación cerrada (se elige para verla y cambiarle el tamaño desde las esquinas).
        const [wx, wy] = cam.unproject(sx, sy, store.ui.level * store.config.levelHeight);
        const ux = wx / G;
        const uy = wy / G;
        for (const room of store.analysis?.levels?.[store.ui.level]?.rooms ?? []) {
            if (room.fill?.some(([x, y, w, h]) => ux >= x && ux < x + w && uy >= y && uy < y + h)) return { type: 'room', id: room.id };
        }
        for (const z of [...(store.project.zones ?? [])].reverse()) {
            const [zx, zy] = cam.unproject(sx, sy, 0.4);
            if (zx >= z.x * G && zx <= (z.x + z.w) * G && zy >= z.y * G && zy <= (z.y + z.h) * G) return { type: 'zone', id: z.id };
        }
    }
    return null;
}
