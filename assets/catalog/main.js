import { $, h, clear } from '../lib/dom.js';
import { fmt, int, m2, m3 } from '../lib/format.js';
import { calcPanel } from '../lib/api.js';

/* Calculadora rápida de paño y mortero: el cálculo lo hace el servidor (misma fuente que el cómputo). */
const form = $('#calc-form');
const out = $('#calc-result');
let timer = null;

async function run() {
    const f = Object.fromEntries(new FormData(form));
    try {
        const r = await calcPanel({ length: f.length, height: f.height, t: f.t, openings: f.openings || 0, waste: f.waste || 0 });
        clear(out).append(h('div', { class: 'calc-out' },
            h('span', {}, 'Superficie neta'), h('b', {}, m2(r.areaM2)),
            h('span', {}, 'Hiladas'), h('b', {}, int(r.courses)),
            h('span', {}, 'Bloques por hilada'), h('b', {}, fmt(r.blocksPerCourse, 2)),
            h('span', {}, `Bloques (con ${r.wastePct} % de reserva)`), h('b', {}, int(r.blocks)),
            h('span', {}, 'Volumen'), h('b', {}, m3(r.volumeM3)),
            h('span', {}, `Pallets (${r.pallets.capacity} u)`), h('b', {}, `${r.pallets.full} completos${r.pallets.loose ? ` + ${r.pallets.loose} u` : ''} → ${r.pallets.total}`),
            h('span', {}, 'Mortero adhesivo'), h('b', {}, `${fmt(r.adhesiveKg, 1)} kg · ${r.adhesiveBags} bolsas`)));
    } catch (err) {
        clear(out).append(h('p', { class: 'muted' }, `Revisá las medidas: ${err.message}`));
    }
}

form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 200);
});
form.addEventListener('submit', (e) => e.preventDefault());
run();
