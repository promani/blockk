/*
 * Colores del dibujo (editor, miniaturas y planos): se leen de las variables --dibujo-* de assets/styles/tema.css.
 * Si una falta o no es un hexadecimal, se usa el valor de abajo.
 */
const DEFAULTS = {
    sky: '#dcebfb', ground: '#cde7b0', block: '#f3f1ec', cut: '#ffcb5c', u: '#7fc93c', roof: '#d9552c',
    glass: '#62bdf0', door: '#b8692e', wood: '#e3a04c', slab: '#a3b1c5',
    floors: ['#ffd49a', '#9fd8f5', '#d3bdff', '#b6e699', '#ffb3b3', '#ffec8f', '#93e0cc', '#ffc2e2'],
};
const VARS = {
    sky: '--dibujo-fondo', ground: '--dibujo-terreno', block: '--dibujo-bloque', cut: '--dibujo-corte', u: '--dibujo-bloque-u',
    roof: '--dibujo-techo', glass: '--dibujo-vidrio', door: '--dibujo-puerta', wood: '--dibujo-madera', slab: '--dibujo-losa',
};

/** '#abc' o '#aabbcc' → '#aabbcc'; cualquier otra cosa → null. */
function hex(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
    return null;
}

function read() {
    let css = null;
    try {
        css = window.getComputedStyle(document.documentElement);
    } catch { /* sin documento: valores por defecto */ }
    const get = (name, fallback) => (css && hex(css.getPropertyValue(name))) || fallback;
    const out = {};
    for (const [k, name] of Object.entries(VARS)) out[k] = get(name, DEFAULTS[k]);
    out.floors = DEFAULTS.floors.map((c, i) => get(`--dibujo-piso-${i + 1}`, c));
    return out;
}

let cache = null;
/** Colores del dibujo (se leen una vez por página). */
export function drawTheme() {
    cache ??= read();
    return cache;
}

function rgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Mezcla dos colores hexadecimales (t = 0 → a, 1 → b). */
export function mix(a, b, t) {
    const [x, y] = [rgb(a), rgb(b)];
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
