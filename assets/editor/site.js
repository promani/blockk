/**
 * Terreno: zonas (pileta, patio, jardín, camino) y árboles. No son parte de la casa ni entran al cómputo: están para
 * pensar la disposición del espacio.
 */
export const ZONE_KINDS = {
    pool: { label: 'Pileta', fill: 'rgba(96,185,232,.88)', stroke: '#2b86b3', inner: 'rgba(255,255,255,.55)' },
    patio: { label: 'Patio / deck', fill: 'rgba(214,190,150,.9)', stroke: '#9a7b4f', inner: 'rgba(120,90,50,.25)' },
    garden: { label: 'Jardín', fill: 'rgba(150,200,120,.9)', stroke: '#5b8f3a', inner: 'rgba(60,110,40,.2)' },
    path: { label: 'Camino', fill: 'rgba(196,201,210,.95)', stroke: '#7b8494', inner: 'rgba(255,255,255,.35)' },
};

/** Tamaños de árbol (cm): altura total, radio de la copa, grosor y altura del tronco. */
export const TREE_SIZES = {
    S: { label: 'Chico (3 m)', h: 300, r: 100, trunk: 8, trunkH: 110 },
    M: { label: 'Mediano (5 m)', h: 500, r: 175, trunk: 12, trunkH: 160 },
    L: { label: 'Grande (8 m)', h: 800, r: 275, trunk: 18, trunkH: 250 },
};

export const zoneLabel = (z) => z.name || ZONE_KINDS[z.kind]?.label || 'Zona';
