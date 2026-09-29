/**
 * Imán a paredes. Al dibujar cerca de un muro existente (del nivel activo o del de abajo) el punto salta a su eje o a su extremo,
 * de modo que se puede construir "contiguo" (compartiendo pared) o "sobre" una pared del nivel inferior sin apuntar con precisión.
 */
const G = 12.5;
const PIXELS = 16; // radio de atracción en pantalla

/** Muros candidatos: los del nivel activo y, en el Nivel 2, los del nivel de abajo (guía para construir encima). */
export function snapWalls(store) {
    // En la pestaña Techo se ajusta a los muros del nivel sobre el que se apoya el techo.
    const li = store.ui.level === 2 ? Math.min(store.ui.roofLevel ?? store.topLevel, store.topLevel) : store.ui.level;
    const list = store.project.levels[li].walls.map((w) => ({ w, level: li }));
    if (li === 1) for (const w of store.project.levels[0].walls) list.push({ w, level: 0 });

    return list;
}

function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    const cx = ax + t * dx;
    const cy = ay + t * dy;

    return { d: Math.hypot(px - cx, py - cy), cx, cy };
}

/**
 * @returns {{gx: number, gy: number, hit: null | {wall: object, kind: 'end' | 'axis', level: number}}}
 */
export function magnet(app, wx, wy, gx, gy, step = 1) {
    const { store, cam } = app;
    const reach = PIXELS / cam.zoom; // cm
    let best = null;
    for (const { w, level } of snapWalls(store)) {
        const ax = w.x1 * G;
        const ay = w.y1 * G;
        const bx = w.x2 * G;
        const by = w.y2 * G;
        for (const [ex, ey, ux, uy] of [[ax, ay, w.x1, w.y1], [bx, by, w.x2, w.y2]]) {
            const d = Math.hypot(wx - ex, wy - ey);
            if (d <= reach && (!best || d < best.d - 0.01)) best = { d, gx: ux, gy: uy, hit: { wall: w, kind: 'end', level } };
        }
        const { d } = distToSegment(wx, wy, ax, ay, bx, by);
        if (d <= reach * 0.8 && (!best || d < best.d - 0.01 || (best.hit.kind === 'axis' && d < best.d))) {
            const horizontal = w.y1 === w.y2;
            const along = horizontal ? Math.round(wx / G / step) * step : Math.round(wy / G / step) * step;
            const lo = horizontal ? w.x1 : w.y1;
            const hi = horizontal ? w.x2 : w.y2;
            const a = Math.max(lo, Math.min(hi, along));
            if (!best || d + 0.5 < best.d) best = { d, gx: horizontal ? a : w.x1, gy: horizontal ? w.y1 : a, hit: { wall: w, kind: 'axis', level } };
        }
    }

    return best ? { gx: best.gx, gy: best.gy, hit: best.hit } : { gx, gy, hit: null };
}

/** Coordenadas (unidades) de las líneas de muros vecinos, para alinear el borde de una sala nueva con ellas. */
export function wallLines(store) {
    const xs = new Set();
    const ys = new Set();
    for (const { w } of snapWalls(store)) {
        if (w.y1 === w.y2) { ys.add(w.y1); xs.add(w.x1); xs.add(w.x2); } else { xs.add(w.x1); ys.add(w.y1); ys.add(w.y2); }
    }

    return { xs: [...xs], ys: [...ys] };
}

/** Línea más cercana a `v` dentro de `tol` unidades, o null. */
export function nearestLine(lines, v, tol = 2) {
    let best = null;
    for (const l of lines) if (Math.abs(l - v) <= tol && (best === null || Math.abs(l - v) < Math.abs(best - v))) best = l;

    return best;
}
