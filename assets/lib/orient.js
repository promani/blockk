/*
 * Lados de la planta (arriba, derecha, abajo, izquierda) y su punto cardinal según el norte del proyecto
 * (Configuraciones generales → «El norte queda hacia»). Los códigos N/E/S/W de techos y escaleras son lados de la
 * planta: N = arriba, E = derecha, S = abajo, W (u O) = izquierda.
 */
const ANGLE = { N: 0, E: 90, S: 180, W: 270, O: 270 };
const ARROW = { N: '↑', E: '→', S: '↓', W: '←', O: '←' };
const PLAN = { N: 'arriba', E: 'derecha', S: 'abajo', W: 'izquierda', O: 'izquierda' };
const CARDINAL = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];

/** Punto cardinal real de un lado de la planta; `north` es hacia dónde queda el norte en el plano (0 = arriba). */
export function cardinal(side, north = 0) {
    const a = (((ANGLE[side] - (Number(north) || 0)) % 360) + 360) % 360;
    return CARDINAL[Math.round(a / 45) % 8];
}

/** «↑ Arriba (norte)». */
export function sideLabel(side, north = 0, arrow = true) {
    const p = PLAN[side];
    return `${arrow ? `${ARROW[side]} ` : ''}${p[0].toUpperCase()}${p.slice(1)} (${cardinal(side, north)})`;
}
