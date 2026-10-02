/** Nombres de ambientes: sugerencias y el punto donde se ancla el nombre de un ambiente. */
import { h } from '../lib/dom.js';

export const ROOM_NAMES = ['Estar', 'Comedor', 'Cocina', 'Estar-comedor', 'Dormitorio', 'Dormitorio principal', 'Baño', 'Toilette', 'Vestidor', 'Placard', 'Pasillo', 'Hall', 'Escritorio', 'Lavadero', 'Despensa', 'Depósito', 'Garaje', 'Galería', 'Alfresco', 'Patio'];

/** Lista de sugerencias para un `<input list="room-names">`. */
export const roomNamesList = () => h('datalist', { id: 'room-names' }, ROOM_NAMES.map((n) => h('option', { value: n })));

/** Celda (x, y en unidades) del ambiente más cercana a su centro: ahí se ancla el nombre. */
export function roomAnchor(room) {
    const cx = room.bbox.x + room.bbox.w / 2;
    const cy = room.bbox.y + room.bbox.h / 2;
    let best = null;
    for (const [x, y, w, hh] of room.fill ?? []) {
        const px = Math.min(Math.max(Math.floor(cx), x), x + w - 1);
        const py = Math.min(Math.max(Math.floor(cy), y), y + hh - 1);
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
        if (!best || d < best.d) best = { x: px, y: py, d };
    }
    return best ? { x: best.x, y: best.y } : { x: Math.floor(cx), y: Math.floor(cy) };
}
