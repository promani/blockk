/** Nombres de ambientes: sugerencias y el punto donde se ancla el nombre de un ambiente. */
import { h } from '../lib/dom.js';

export const ROOM_NAMES = ['Estar', 'Comedor', 'Cocina', 'Estar-comedor', 'Dormitorio', 'Dormitorio principal', 'Baño', 'Toilette', 'Vestidor', 'Placard', 'Pasillo', 'Hall', 'Escritorio', 'Lavadero', 'Despensa', 'Depósito', 'Garaje', 'Galería', 'Alfresco', 'Patio'];

/** Lista de sugerencias para un `<input list="room-names">`. */
export const roomNamesList = () => h('datalist', { id: 'room-names' }, ROOM_NAMES.map((n) => h('option', { value: n })));

/** Opciones de un selector de tipo de ambiente (`config.roomTypes`); `guessed` es el tipo que se deduce del nombre. */
export const roomTypeItems = (cfg, guessed = null) => [['', guessed && cfg.roomTypes?.[guessed] ? `Según el nombre (${cfg.roomTypes[guessed]})` : 'Sin tipo'], ...Object.entries(cfg.roomTypes ?? {})];

/**
 * Nombre que queda al elegir un tipo: el del tipo si el ambiente no tenía nombre o tenía el de otro tipo (o una de las
 * sugerencias); un nombre escrito a mano se conserva.
 */
export function nameForType(cfg, type, name) {
    const label = cfg.roomTypes?.[type];
    const generic = name === '' || ROOM_NAMES.includes(name) || Object.values(cfg.roomTypes ?? {}).includes(name);
    return label && generic ? label : name;
}

/** Aplica un tipo a un nombre de ambiente del proyecto (vacío: lo quita y vuelve a deducirse del nombre). */
export function setLabelType(cfg, label, type) {
    if (type) Object.assign(label, { type, name: nameForType(cfg, type, label.name) });
    else delete label.type;
}

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
