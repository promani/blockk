/*
 * ¿Cuánto de la escalera queda dentro de una habitación de la planta baja? Fracción (0…1) de su caja en planta (cm)
 * cubierta por el piso de un mismo ambiente. Al moverla no puede bajar: así no atraviesa un muro ni sale de la casa.
 * (No se exige 1: una escalera en U puede llevar su propio muro entre los tramos, que no es piso de ningún ambiente.)
 */
const G = 12.5;

export function stairCoverage(analysis, box) {
    const [x0, y0, x1, y1] = [box.x / G, box.y / G, (box.x + box.w) / G, (box.y + box.h) / G];
    const area = (x1 - x0) * (y1 - y0);
    let best = 0;
    for (const rm of analysis?.levels?.[0]?.rooms ?? []) {
        let covered = 0;
        for (const [x, y, w, h] of rm.fill ?? []) {
            const ix = Math.min(x1, x + w) - Math.max(x0, x);
            const iy = Math.min(y1, y + h) - Math.max(y0, y);
            if (ix > 0 && iy > 0) covered += ix * iy;
        }
        best = Math.max(best, area > 0 ? covered / area : 0);
    }
    return best;
}

/** Caja de la escalera `id` corrida (dx, dy) unidades de 12,5 cm, o null si el análisis todavía no la tiene. */
export function stairBox(analysis, id, dx = 0, dy = 0) {
    const b = analysis?.floors?.stairs?.find((s) => s.id === id)?.bbox;
    return b ? { x: b.x + dx * G, y: b.y + dy * G, w: b.w, h: b.h } : null;
}

export const STAIR_BLOCKED = 'La escalera no entra ahí: tiene que quedar dentro de una habitación de la planta baja, sin atravesar muros.';
