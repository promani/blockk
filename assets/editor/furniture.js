/**
 * Muebles simples: gabaritos de tamaño real (cama, mesa, mesada, artefactos de baño) para ver si un ambiente alcanza.
 * El catálogo viene del servidor (`config.furniture`); acá sólo se resuelve la huella según el giro. No entran al
 * cómputo ni a la Revisión, y se pueden apagar desde «Configuraciones generales».
 */
const G = 12.5;

/** En la isométrica ninguna caja pasa de 1 m: un placard de 2 m taparía el ambiente que se quiere medir. */
const MAX_BOX_H = 100;

/** Huella del mueble ya girado: ancho y fondo en cm, alto de la caja que se dibuja y su ficha del catálogo (o null si no existe). */
export function footprint(cfg, f) {
    const def = cfg.furniture?.[f.kind];
    if (!def) return null;
    const turned = f.rot % 2 === 1;
    return { w: turned ? def.d : def.w, d: turned ? def.w : def.d, h: Math.min(def.h, MAX_BOX_H), def };
}

/** Rectángulo de mundo [x0, y0, x1, y1] en cm (o null). */
export function furnitureRect(cfg, f) {
    const s = footprint(cfg, f);
    return s ? [f.x * G, f.y * G, f.x * G + s.w, f.y * G + s.d] : null;
}

/** Borde de la cabecera o del respaldo [x0, y0, x1, y1]: arriba sin giro, y gira con el mueble en sentido horario. */
export function backEdge([x0, y0, x1, y1], rot) {
    return [[x0, y0, x1, y0], [x1, y0, x1, y1], [x0, y1, x1, y1], [x0, y0, x0, y1]][rot & 3];
}

/** El mueble girado 90° en sentido horario alrededor de su centro (la esquina vuelve a caer en la retícula). */
export function turnFurniture(cfg, f) {
    const s = footprint(cfg, f);
    if (!s) return {};
    return { rot: (f.rot + 1) % 4, x: Math.max(0, Math.round(f.x + (s.w - s.d) / 2 / G)), y: Math.max(0, Math.round(f.y + (s.d - s.w) / 2 / G)) };
}

/** Grupos del catálogo, en orden: [[grupo, [[id, ficha], …]], …]. */
export function furnitureGroups(cfg) {
    const groups = new Map();
    for (const [id, def] of Object.entries(cfg.furniture ?? {})) {
        if (!groups.has(def.group)) groups.set(def.group, []);
        groups.get(def.group).push([id, def]);
    }
    return [...groups];
}

export const furnitureOn = (ui) => ui?.showFurniture !== false;
export const treesOn = (ui) => ui?.showTrees !== false;
