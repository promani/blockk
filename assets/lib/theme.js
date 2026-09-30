/*
 * Estilos del sitio: colores de la interfaz y del dibujo del editor. Se eligen en /estilos, se guardan en el navegador
 * (localStorage) y se aplican en todas las pantallas. El layout aplica las variables CSS antes de pintar (script en
 * base.html.twig) para que no parpadee.
 */
export const THEME_KEY = 'blockk.theme.v1';
export const THEME_CSS_KEY = 'blockk.theme.css.v1';

export const PRESETS = {
    vivo: {
        name: 'Vivo',
        accent: '#78c23a', dark: '#1b2a41', surface: '#f4f8ff', panel: '#ffffff',
        sky: '#dcebfb', ground: '#cde7b0', block: '#f3f1ec', cut: '#ffcb5c', u: '#7fc93c', roof: '#d9552c',
        glass: '#62bdf0', door: '#b8692e', wood: '#e3a04c', slab: '#a3b1c5',
        floors: ['#ffd49a', '#9fd8f5', '#d3bdff', '#b6e699', '#ffb3b3', '#ffec8f', '#93e0cc', '#ffc2e2'],
    },
    clasico: {
        name: 'Clásico',
        accent: '#8bc53f', dark: '#1e293b', surface: '#f7f9ff', panel: '#ffffff',
        sky: '#e9eef6', ground: '#e1e9d6', block: '#e7ebf1', cut: '#f4d99a', u: '#9fd15c', roof: '#c4633f',
        glass: '#a9d3ef', door: '#b9834f', wood: '#d9a05b', slab: '#aab3bf',
        floors: ['#fbe3b8', '#bfe3ee', '#dccdf3', '#cfe9bd', '#f8c9c9', '#f3eaa6', '#b9e0d6', '#f1cfe0'],
    },
    tierra: {
        name: 'Tierra',
        accent: '#d9822b', dark: '#33271f', surface: '#fbf6ef', panel: '#ffffff',
        sky: '#f1e6d6', ground: '#d6e0b8', block: '#efe6d6', cut: '#f2b35a', u: '#9bbf4a', roof: '#b4462a',
        glass: '#7fb8d6', door: '#8c5226', wood: '#c98a45', slab: '#b9ad9c',
        floors: ['#f7d7a8', '#c9e2d4', '#e6cfc0', '#d9e6b0', '#f2bfae', '#f5e3a1', '#bcd9cf', '#ecc9d8'],
    },
    nocturno: {
        name: 'Contraste',
        accent: '#00b37a', dark: '#0b1020', surface: '#eef2f8', panel: '#ffffff',
        sky: '#cfd9ea', ground: '#b9dc9a', block: '#ffffff', cut: '#ffb020', u: '#00b37a', roof: '#e0402a',
        glass: '#3aa8ff', door: '#a0521c', wood: '#e39b3a', slab: '#8d9bb0',
        floors: ['#ffc56e', '#7fcff7', '#c3a6ff', '#9ee07a', '#ff9d9d', '#ffe46a', '#6fdcc0', '#ffa9d6'],
    },
};
export const DEFAULT_PRESET = 'vivo';

/** Campos editables en /estilos. */
export const FIELDS = [
    ['Interfaz', [['accent', 'Acento (botones, pestañas)'], ['dark', 'Barra superior y texto'], ['surface', 'Fondo de las páginas'], ['panel', 'Paneles y tarjetas']]],
    ['Dibujo', [['sky', 'Fondo del lienzo'], ['ground', 'Terreno'], ['block', 'Bloque'], ['cut', 'Bloque cortado'], ['u', 'Bloque U (dinteles y corona)'], ['roof', 'Techo'], ['glass', 'Vidrio'], ['door', 'Puertas'], ['wood', 'Madera'], ['slab', 'Losas y escalera']]],
];

const HEX = /^#[0-9a-f]{6}$/i;

function stored() {
    try {
        return JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null');
    } catch {
        return null;
    }
}

/** Tema vigente: el preset guardado con los colores que se hayan cambiado a mano. */
export function currentTheme() {
    const s = stored();
    const base = PRESETS[s?.preset] ?? PRESETS[DEFAULT_PRESET];
    const out = { ...base, floors: [...base.floors], preset: PRESETS[s?.preset] ? s.preset : DEFAULT_PRESET };
    for (const [k, v] of Object.entries(s?.colors ?? {})) {
        if (k === 'floors' && Array.isArray(v) && v.length === base.floors.length && v.every((c) => HEX.test(c))) out.floors = [...v];
        else if (k in base && HEX.test(v)) out[k] = v;
    }
    return out;
}

let cache = null;
/** Tema para el dibujo (se relee sólo cuando cambia). */
export function drawTheme() {
    cache ??= currentTheme();
    return cache;
}

function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]) {
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}
/** Mezcla dos colores (t = 0 → a, 1 → b). */
export function mix(a, b, t) {
    const [x, y] = [rgb(a), rgb(b)];
    return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Variables CSS que salen del tema (los tonos derivados se calculan). */
export function cssVars(t) {
    return {
        '--green': t.accent,
        '--green-600': mix(t.accent, '#000000', 0.2),
        '--green-800': mix(t.accent, '#000000', 0.55),
        '--green-100': mix(t.accent, '#ffffff', 0.85),
        '--graphite': t.dark,
        '--graphite-700': mix(t.dark, '#ffffff', 0.15),
        '--surface': t.surface,
        '--panel': t.panel,
        '--border': mix(t.dark, t.surface, 0.82),
        '--muted': mix(t.dark, t.surface, 0.35),
    };
}

export function applyCss(t, root = document.documentElement) {
    for (const [k, v] of Object.entries(cssVars(t))) root.style.setProperty(k, v);
}

/** Guarda el preset y los colores cambiados, y aplica el tema en esta página. */
export function saveTheme(preset, colors = {}) {
    try {
        localStorage.setItem(THEME_KEY, JSON.stringify({ preset, colors }));
    } catch { /* sin persistencia */ }
    cache = null;
    const t = currentTheme();
    try {
        localStorage.setItem(THEME_CSS_KEY, JSON.stringify(cssVars(t)));
    } catch { /* ok */ }
    applyCss(t);
    return t;
}

export function resetTheme() {
    try {
        localStorage.removeItem(THEME_KEY);
        localStorage.removeItem(THEME_CSS_KEY);
    } catch { /* ok */ }
    cache = null;
    const t = currentTheme();
    applyCss(t);
    return t;
}
