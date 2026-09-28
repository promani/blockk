const nf = new Map();
function formatter(d) {
    if (!nf.has(d)) nf.set(d, new Intl.NumberFormat('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }));
    return nf.get(d);
}

/** Número con formato es-AR y `d` decimales fijos. */
export const fmt = (n, d = 2) => formatter(d).format(Number.isFinite(n) ? n : 0);
/** Entero con separador de miles. */
export const int = (n) => formatter(0).format(Math.round(Number.isFinite(n) ? n : 0));
export const m2 = (n) => `${fmt(n, 2)} m²`;
export const m3 = (n) => `${fmt(n, 2)} m³`;
export const pct = (n, d = 1) => `${fmt(n, d)} %`;
export const money = (n, currency = 'USD') => `${currency} ${fmt(n, 2)}`;
/** cm → "1,25 m". */
export const cmToM = (cm) => `${fmt(cm / 100, 2)} m`;
/** Largo en cm con hasta 2 decimales sin ceros de más: 62,5 → "62,5". */
export const cm = (v) => formatter(2).format(Math.round(v * 100) / 100).replace(/,?0+$/, '');
