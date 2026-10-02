/**
 * Comparación de dos casas de «Mis casas» (/comparar?a=&b=), lado a lado y con la diferencia de la segunda contra la
 * primera. Sólo entre casas guardadas por este navegador: el proyecto de cada una se pide con su id y el motor las
 * calcula (/api/analyze), igual que en el Cómputo. No guarda nada.
 */
import { $, h, add, clear } from '../lib/dom.js';
import { fmt, int } from '../lib/format.js';
import { analyze } from '../lib/api.js';
import { getHouse } from '../lib/houses.js';

const root = $('#compare-root');
const ID = /^[a-f0-9]{24}$/;

/** Cifras de una casa, agrupadas: [{title, rows: [{key, label, value, d (decimales), unit}]}]. */
function figures(a) {
    const t = a.telemetry;
    const bom = a.bom;
    const lines = bom.lines ?? [];
    const sum = (test, field = 'qty') => lines.filter(test).reduce((acc, l) => acc + l[field], 0);
    const groups = [...new Set(lines.map((l) => l.group))];
    const issues = (severity) => a.issues.filter((i) => i.severity === severity).length;
    return [
        { title: 'Superficie', rows: [
            { key: 'net', label: 'Superficie útil', value: t.total.netM2, d: 1, unit: 'm²' },
            { key: 'gross', label: 'Superficie cubierta (a ejes)', value: t.total.grossM2, d: 1, unit: 'm²' },
            { key: 'levels', label: 'Plantas', value: t.total.levelsUsed, d: 0, unit: '' },
            { key: 'walls', label: 'Muros', value: bom.total.wallLengthM, d: 1, unit: 'm' },
        ] },
        { title: 'Superficie útil por tipo de ambiente', rows: (t.byType ?? []).map((x) => ({ key: `type:${x.type ?? ''}`, label: x.label, value: x.m2, d: 1, unit: 'm²', note: x.rooms > 1 ? `${x.rooms} ambientes` : '' })) },
        { title: 'Bloques a comprar', rows: [
            ...bom.total.blocks.map((b) => ({ key: `block:${b.code}`, label: `${b.kind === 'U' ? 'Bloque U' : 'Bloque'} de ${fmt(b.tCm, b.tCm % 1 ? 1 : 0)} cm`, value: b.order, d: 0, unit: 'u' })),
            { key: 'blocks', label: 'Bloques en total', value: t.total.blocks, d: 0, unit: 'u', strong: true },
            { key: 'pallets', label: 'Pallets', value: t.total.pallets, d: 0, unit: '' },
            { key: 'scrap', label: 'Descarte de material', value: t.total.scrapPct, d: 1, unit: '%' },
        ] },
        { title: 'Otros materiales', rows: [
            { key: 'adhesive', label: 'Mortero adhesivo', value: t.total.adhesiveBags, d: 0, unit: 'bolsas' },
            { key: 'concrete', label: 'Hormigón (dinteles, pilares, losas)', value: sum((l) => l.unit === 'm³' && l.group !== 'Mampostería HCCA'), d: 2, unit: 'm³' },
            { key: 'rebar', label: 'Hierro', value: sum((l) => l.unit === 'kg'), d: 0, unit: 'kg' },
            { key: 'timber', label: 'Madera (tirantes, cabios, vigas)', value: sum((l) => l.unit === 'm' && /madera|pino|tirante|cabio|cenefa|cumbrera/i.test(`${l.group} ${l.desc}`)), d: 1, unit: 'm' },
            { key: 'roof', label: 'Cubierta', value: t.roof?.coverM2 ?? 0, d: 1, unit: 'm²' },
            { key: 'slab', label: 'Losa de piso', value: t.slabM2 ?? 0, d: 1, unit: 'm²' },
        ] },
        { title: `Costo de referencia (${bom.currency})`, rows: [
            ...groups.map((g) => ({ key: `cost:${g}`, label: g, value: sum((l) => l.group === g, 'subtotal'), d: 0, unit: '' })),
            { key: 'cost', label: 'Total', value: t.total.cost, d: 0, unit: '', strong: true },
            { key: 'costM2', label: 'Por m² útil', value: t.total.netM2 > 0 ? t.total.cost / t.total.netM2 : 0, d: 0, unit: '' },
        ] },
        { title: 'Revisión', rows: [
            { key: 'errors', label: 'Errores', value: issues('error'), d: 0, unit: '' },
            { key: 'warns', label: 'Advertencias', value: issues('warn'), d: 0, unit: '' },
        ] },
    ];
}

const num = (row) => (row ? `${row.d ? fmt(row.value, row.d) : int(row.value)}${row.unit ? ` ${row.unit}` : ''}` : '—');

/** Diferencia de la segunda contra la primera: «+12,5 m² (+18 %)»; sin cambio, «=». Lo que falta en una cuenta como 0. */
function delta(ra, rb) {
    const ref = ra ?? rb;
    const a = ra?.value ?? 0;
    const b = rb?.value ?? 0;
    const diff = b - a;
    const eps = 0.5 * 10 ** -ref.d;
    if (Math.abs(diff) < eps) return h('td', { class: 'cmp-same' }, '=');
    const sign = diff > 0 ? '+' : '−';
    const abs = `${sign}${ref.d ? fmt(Math.abs(diff), ref.d) : int(Math.abs(diff))}${ref.unit ? ` ${ref.unit}` : ''}`;
    const rel = a > 0 ? ` (${sign}${fmt(Math.abs((diff / a) * 100), 0)} %)` : '';
    return h('td', { class: diff > 0 ? 'cmp-up' : 'cmp-down' }, abs, h('span', { class: 'cmp-rel' }, rel));
}

function head(house, letter) {
    const s = house.summary;
    return h('article', { class: 'card cmp-house' },
        h('img', { class: 'house-thumb', alt: `Planta de ${house.name}`, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(house.svg)}` }),
        h('div', { class: 'cmp-house-body' },
            h('span', { class: 'tag' }, letter),
            h('h2', {}, house.name),
            h('p', { class: 'muted small' }, `${fmt(s.superficieUtilM2, 1)} m² útiles · ${s.niveles} planta${s.niveles > 1 ? 's' : ''} · ${int(s.bloques)} bloques`)));
}

function draw(A, B) {
    const fa = figures(A.analysis);
    const fb = figures(B.analysis);
    const body = [];
    fa.forEach((group, gi) => {
        const other = fb[gi];
        // filas de las dos casas, en el orden de la primera y después las que sólo tiene la segunda
        const keys = [...group.rows.map((r) => r.key), ...other.rows.map((r) => r.key).filter((k) => !group.rows.some((r) => r.key === k))];
        // el total de cada grupo va último aunque la segunda casa sume renglones
        keys.sort((x, y) => Number(['blocks', 'pallets', 'scrap', 'cost', 'costM2'].includes(x)) - Number(['blocks', 'pallets', 'scrap', 'cost', 'costM2'].includes(y)));
        if (!keys.length) return;
        body.push(h('tr', { class: 'group' }, h('td', { colspan: '4' }, group.title === other.title ? group.title : `${group.title} / ${other.title}`)));
        for (const key of keys) {
            const ra = group.rows.find((r) => r.key === key);
            const rb = other.rows.find((r) => r.key === key);
            const ref = ra ?? rb;
            body.push(h('tr', { class: ref.strong ? 'cmp-strong' : null, dataset: { row: key } },
                h('td', { class: 'l' }, ref.label),
                h('td', { class: ra ? null : 'cmp-none', title: ra?.note || null }, num(ra)),
                h('td', { class: rb ? null : 'cmp-none', title: rb?.note || null }, num(rb)),
                delta(ra, rb)));
        }
    });
    clear(root);
    add(root,
        h('div', { class: 'page-head' }, h('h1', {}, 'Comparar dos casas'), h('p', { class: 'muted' }, 'La diferencia es la de la segunda casa (B) contra la primera (A). Los precios son los de referencia de cada proyecto.')),
        h('div', { class: 'cmp-heads' }, head(A, 'A'), head(B, 'B')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table cmp-table' },
            h('thead', {}, h('tr', {}, h('th', { class: 'l' }, 'Concepto'), h('th', {}, `A · ${A.name}`), h('th', {}, `B · ${B.name}`), h('th', {}, 'Diferencia (B − A)'))),
            h('tbody', {}, body))));
}

function fail(text) {
    clear(root);
    add(root, h('div', { class: 'page-head' }, h('h1', {}, 'Comparar dos casas')), h('p', { class: 'empty-note' }, text), h('p', {}, h('a', { class: 'btn btn-primary', href: '/galeria' }, 'Ir a «Mis casas»')));
}

async function load(id) {
    const house = await getHouse(id);
    const result = await analyze(house.project);
    return { ...house, analysis: result.analysis };
}

(async () => {
    const params = new URLSearchParams(location.search);
    const [a, b] = [params.get('a') ?? '', params.get('b') ?? ''];
    if (!ID.test(a) || !ID.test(b) || a === b) {
        fail('Para comparar, elegí dos casas distintas en «Mis casas» de la Galería.');
        return;
    }
    try {
        const [A, B] = await Promise.all([load(a), load(b)]);
        draw(A, B);
        const swap = $('#compare-swap');
        swap.hidden = false;
        swap.addEventListener('click', () => { location.href = `/comparar?a=${b}&b=${a}`; });
    } catch (e) {
        fail(e.status === 404 ? 'Alguna de las dos casas no está entre las guardadas por este navegador (pudo haberse eliminado).' : `No se pudo armar la comparación: ${e.message}`);
    }
})();
