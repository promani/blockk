/**
 * Contexto de trabajo: qué está haciendo el usuario (herramienta activa o elemento elegido). El Resumen y la Revisión del
 * panel derecho muestran sólo lo que sirve para eso.
 */
const G = 12.5;
const OPENING_TOOLS = new Set(['opening']);
const FLOOR_TOOLS = new Set(['piso', 'slab', 'floor', 'beam', 'stair']);

export const CONTEXT_TITLE = {
    general: '',
    openings: 'Ventanas y puertas',
    wall: 'Muro',
    room: 'Habitación',
    roof: 'Techos',
    floor: 'Pisos y escaleras',
};

/** { kind, id? } del contexto actual. */
export function contextOf(store) {
    const sel = store.ui.selection;
    if (sel) {
        if (sel.type === 'opening') return { kind: 'openings', id: sel.id };
        if (sel.type === 'wall') return { kind: 'wall', id: sel.id };
        if (sel.type === 'room') return { kind: 'room', id: sel.id };
        if (sel.type === 'roof' || sel.type === 'gable') return { kind: 'roof', id: sel.id };
        if (['slab', 'stair', 'timber'].includes(sel.type)) return { kind: 'floor', id: sel.id };
    }
    if (store.ui.level === 2) return { kind: 'roof' };
    if (OPENING_TOOLS.has(store.ui.tool)) return { kind: 'openings' };
    if (FLOOR_TOOLS.has(store.ui.tool)) return { kind: 'floor' };
    return { kind: 'general' };
}

/** Muros que encierran una habitación (tocan los bordes de su relleno). */
export function roomWalls(room, walls) {
    return walls.filter((w) => {
        const horizontal = w.y1 === w.y2;
        const line = horizontal ? w.y1 : w.x1;
        return room.fill?.some(([x, y, fw, fh]) => (horizontal
            ? (y === line || y + fh === line) && x < w.x2 && x + fw > w.x1
            : (x === line || x + fw === line) && y < w.y2 && y + fh > w.y1));
    });
}

/** Orientación cardinal (N, E, S, O) de la cara exterior de un muro, según el norte del proyecto; null si es interior. */
export function facing(ext, north) {
    if (!Array.isArray(ext)) return null;
    const bearing = (Math.atan2(ext[0], -ext[1]) * 180) / Math.PI;
    const rel = (((bearing - north) % 360) + 360) % 360;
    return ['N', 'E', 'S', 'O'][Math.round(rel / 90) % 4];
}

/** m² de un vano. */
export const openingM2 = (o) => (o.w * G * o.h * 25) / 10000;

/** ¿La observación corresponde al contexto? */
export function issueMatches(issue, ctx, store) {
    const p = store.project;
    const level = store.ui.level;
    switch (ctx.kind) {
        case 'openings': {
            if (ctx.id) return issue.ref === ctx.id;
            return String(issue.code).startsWith('opening') && issue.level === level;
        }
        case 'wall': {
            const lv = p.levels[level];
            const refs = new Set([ctx.id, ...lv.openings.filter((o) => o.wall === ctx.id).map((o) => o.id)]);
            return refs.has(issue.ref);
        }
        case 'room': {
            const room = store.analysis?.levels?.[level]?.rooms?.find((r) => r.id === ctx.id);
            if (!room) return false;
            // recomendaciones del tipo de ambiente: apuntan a un punto de adentro
            if (String(issue.code).startsWith('room.')) return issue.level === level && (room.fill ?? []).some(([x, y, w, h]) => issue.x >= x && issue.x < x + w && issue.y >= y && issue.y < y + h);
            const lv = p.levels[level];
            const walls = roomWalls(room, lv.walls).map((w) => w.id);
            const refs = new Set([...walls, ...lv.openings.filter((o) => walls.includes(o.wall)).map((o) => o.id)]);
            return refs.has(issue.ref);
        }
        case 'roof': {
            if (ctx.id) return issue.ref === String(ctx.id).split(':')[0];
            return issue.level === 2 || String(issue.code).startsWith('roof');
        }
        case 'floor': {
            if (ctx.id) return issue.ref === ctx.id;
            return /^(stair|slab|floor|timber|support\.partition)/.test(String(issue.code));
        }
        default:
            return true;
    }
}
