import { $, h, add, clear } from '../lib/dom.js';
import { fmt, int, m3, pct, money, cm } from '../lib/format.js';
import { loadProject, saveProject } from '../lib/storage.js';
import { analyze } from '../lib/api.js';
import { downloadBlob, slug } from '../lib/download.js';
import { toCsv } from '../lib/csv.js';
import { buildPdf } from './pdf-report.js';

const config = JSON.parse($('#blockk-config').textContent);
const root = $('#bom-root');
const PRICE_LABELS = {
    block_m3: ['Bloque HCCA macizo', 'm³'],
    ublock_m3: ['Bloque U HCCA', 'm³'],
    adhesive_bag: ['Mortero adhesivo (bolsa 25 kg)', 'bolsa'],
    leveling_bag: ['Mortero de nivelación (bolsa 25 kg)', 'bolsa'],
    concrete_m3: ['Hormigón para relleno', 'm³'],
    rebar8_kg: ['Hierro Ø8', 'kg'],
    rebar10_kg: ['Hierro Ø10', 'kg'],
    anchor_u: ['Anclaje metálico (planchuela)', 'u'],
    timber_3x8_m: ['Madera 3″×8″', 'm'],
    timber_3x10_m: ['Madera 3″×10″', 'm'],
    osb_sheet: ['Placa OSB 18 mm', 'placa'],
    elastic_band_m: ['Banda elástica de apoyo', 'm'],
    plate_u: ['Placa de reparto de carga', 'u'],
};

let state = { project: null, analysis: null, scope: 'total' };

async function boot() {
    const saved = loadProject();
    if (!saved || !saved.levels.some((l) => l.walls?.length)) {
        add(clear(root), 
            h('h1', {}, 'Cómputo métrico y despiece constructivo'),
            h('div', { class: 'notice' }, 'Todavía no hay muros en el proyecto actual.'),
            h('p', {}, h('a', { class: 'btn btn-primary', href: '/' }, 'Ir al editor'), ' ', h('a', { class: 'btn btn-outline', href: '/galeria' }, 'Elegir una plantilla')),
        );
        for (const id of ['btn-csv', 'btn-pdf']) $(`#${id}`).disabled = true;
        return;
    }
    await recalc(saved);
}

async function recalc(project) {
    try {
        const res = await analyze(project);
        state.project = res.project;
        state.analysis = res.analysis;
        saveProject(res.project);
        render();
    } catch (err) {
        add(clear(root), h('div', { class: 'notice error' }, `No se pudo calcular el cómputo: ${err.message}`));
    }
}

const scopeData = () => (state.scope === 'total' ? state.analysis.bom.total : state.analysis.bom.levels[state.scope]);

function kpi(label, value, note = null, ok = null) {
    return h('div', { class: 'kpi card' }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label), note ? h('div', { class: `t ${ok === true ? 'ok' : ok === false ? 'bad' : ''}` }, note) : null);
}

function render() {
    const { project, analysis } = state;
    const { bom, telemetry, issues } = analysis;
    const tot = bom.total;
    const errors = issues.filter((i) => i.severity === 'error');
    const scrapOk = tot.scrapPct < 4;

    add(clear(root), 
        h('header', { class: 'page-head' },
            h('h1', {}, 'Cómputo métrico y despiece constructivo'),
            h('p', { class: 'lead' }, `${project.name} · ${fmt(telemetry.total.netM2, 1)} m² útiles · ${telemetry.total.levelsUsed} nivel(es) · ${fmt(telemetry.total.heightM, 2)} m de altura autoportante`)),
        errors.length ? h('div', { class: 'notice error' }, `El modelo tiene ${errors.length} error(es) de validación constructiva; el cómputo puede no ser ejecutable. `, h('a', { href: '/' }, 'Corregir en el editor')) : null,
        h('section', { class: 'kpis', 'aria-label': 'Indicadores' },
            kpi('Descarte de material', pct(tot.scrapPct), scrapOk ? 'Objetivo < 4 % ✓' : 'Objetivo < 4 % ✗', scrapOk),
            kpi('Bloques con corte', pct(tot.cutBlocksPct), `${int(tot.cutBlocks)} de ${int(tot.stock)} bloques`),
            kpi('Bloques a comprar', int(telemetry.total.blocks), `incl. ${bom.reservePct} % de reserva`),
            kpi('Pallets', int(telemetry.total.pallets), 'completos + sueltos'),
            kpi('Mortero adhesivo', `${int(tot.mortar.adhesiveBags)} bolsas`, `${fmt(tot.mortar.adhesiveKg, 0)} kg`),
            kpi('Costo de referencia', money(bom.totalCost, bom.currency), 'precios editables')),
        section('Desglose por nivel y mampostería', [scopeTabs(), blocksTable(scopeData()), materialsTable(scopeData()),
            h('p', { class: 'small muted' }, state.scope === 'total' ? 'El total de obra optimiza los cortes con todas las piezas juntas: los remanentes se reaprovechan también entre niveles.' : 'Cada nivel se optimiza por separado; la suma puede superar al total de obra.')]),
        section('Optimización de cortes', [comparison(bom), patterns(tot)]),
        section('Estructura de madera del entrepiso', [timber(analysis.timber)]),
        section('Cotización y comparativa de materiales', [prices(project), quote(bom), sendToDistributor()]),
        section('Criterios y alcance', [h('ul', { class: 'small muted' },
            h('li', {}, 'Cantidades obtenidas del despiece real pieza por pieza (hiladas, traba ≥ 12,5 cm, dinteles y corona en bloque U).'),
            h('li', {}, 'Remanentes de corte reaprovechados sobre bloques enteros de 62,5 cm (sierra widia, sin pérdida por trazo).'),
            h('li', {}, 'Mortero adhesivo: 1,5 a 2,5 kg/m² según espesor (capa de 2 a 3 mm). Primera hilada con mortero cementicio de nivelación.'),
            h('li', {}, 'Pallets con capacidades referenciales (1,44 a 1,80 m³ según espesor); confirmar con el distribuidor HCCA.'),
            h('li', {}, 'Controles de predimensionado del editor: no reemplazan el cálculo estructural (CIRSOC 501 / Eurocódigo 6). Precios de ejemplo, no son una cotización.'))]),
    );
}

const section = (title, children) => h('section', { class: 'section' }, h('h2', {}, title), ...children);

function scopeTabs() {
    const { bom } = state.analysis;
    const tabs = [['total', 'Total de obra']];
    bom.levels.forEach((l, i) => { if (l.used) tabs.push([i, config.levelNames[i]]); });
    return h('div', { class: 'tabs', role: 'group', 'aria-label': 'Nivel' }, tabs.map(([key, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.scope === key), onclick: () => { state.scope = key; render(); } }, label)));
}

/** Encabezado de tabla: un '<' inicial alinea la columna a la izquierda (texto). */
const th = (...labels) => h('thead', {}, h('tr', {}, labels.map((l) => (l.startsWith('<') ? h('th', { scope: 'col', class: 'l' }, l.slice(1)) : h('th', { scope: 'col' }, l)))));
const tl = (...c) => h('td', { class: 'l' }, ...c);

function blocksTable(s) {
    const rows = s.blocks.map((b) => h('tr', {},
        h('td', {}, h('span', { class: 'pill' }, b.code)),
        tl(b.label),
        h('td', {}, int(b.pieces)), h('td', {}, int(b.full)), h('td', {}, int(b.cutPieces)),
        h('td', {}, int(b.cutBlocks)), h('td', {}, int(b.stock)), h('td', {}, int(b.reserve)),
        h('td', {}, h('b', {}, int(b.order))), h('td', {}, m3(b.volumeM3)),
        h('td', {}, `${b.pallets.full} + ${b.pallets.loose} u = ${b.pallets.total}`)));
    const sum = (k) => s.blocks.reduce((a, b) => a + b[k], 0);
    return h('div', { class: 'tablewrap' }, h('table', { class: 'table' },
        h('caption', {}, 'Bloques HCCA (despiece)'),
        th('<Cód.', '<Descripción', 'Piezas', 'Enteras', 'Cortadas', 'Bloques cortados', 'Stock', 'Reserva', 'A comprar', 'Volumen', 'Pallets'),
        h('tbody', {}, rows),
        h('tfoot', {}, h('tr', {}, h('th', { colspan: 2, scope: 'row' }, 'Total'), h('td', {}, int(sum('pieces'))), h('td', {}, int(sum('full'))), h('td', {}, int(sum('cutPieces'))), h('td', {}, int(sum('cutBlocks'))), h('td', {}, int(sum('stock'))), h('td', {}, int(sum('reserve'))), h('td', {}, int(sum('order'))), h('td', {}, m3(s.blocks.reduce((a, b) => a + b.volumeM3, 0))), h('td', {}, int(s.blocks.reduce((a, b) => a + b.pallets.total, 0)))))));
}

function materialsTable(s) {
    const row = (name, qty, unit, note = '') => h('tr', {}, h('td', {}, name), h('td', {}, qty), tl(unit), tl(note));
    return h('div', { class: 'tablewrap' }, h('table', { class: 'table', style: 'margin-top:14px' },
        h('caption', {}, 'Morteros, hormigón, armadura y accesorios'),
        th('<Concepto', 'Cantidad', '<Unidad', '<Detalle'),
        h('tbody', {},
            row('Superficie de mampostería', fmt(s.wallAreaM2, 2), 'm²', `${fmt(s.wallLengthM, 2)} m de muros (a ejes)`),
            row('Mortero adhesivo de junta delgada', int(s.mortar.adhesiveBags), 'bolsas 25 kg', `${fmt(s.mortar.adhesiveKg, 1)} kg`),
            row('Mortero cementicio de nivelación (1.ª hilada)', int(s.mortar.levelingBags), 'bolsas 25 kg', `${fmt(s.mortar.levelingKg, 1)} kg`),
            row('Hormigón in situ (relleno de bloques U)', fmt(s.concreteM3, 2), 'm³', 'dinteles, vigas y corona'),
            row('Hierro Ø8 mm (dinteles y vigas U)', fmt(s.rebar.d8Kg, 1), 'kg', `${fmt(s.rebar.d8M, 1)} m · 2 barras corridas`),
            row('Hierro Ø10 mm (encadenado superior)', fmt(s.rebar.d10Kg, 1), 'kg', `${fmt(s.rebar.d10M, 1)} m · 2 barras corridas`),
            row('Anclajes metálicos (T y cruces)', int(s.anchors), 'u', 'uno cada 2 hiladas'))));
}

function comparison(bom) {
    const c = bom.comparison;
    return h('div', { class: 'cmpgrid' },
        kpi('Con reaprovechamiento de remanentes', `${int(c.engineStock)} bloques`, 'Blockk (despiece real)', true),
        kpi('Sin reaprovechar (un bloque por corte)', `${int(c.noReuseStock)} bloques`, `Ahorro: ${int(c.savedBlocks)} bloques (${pct(c.savedPct)})`, true),
        kpi('Cómputo rápido por superficie (+5 %)', `${int(c.quickAreaStock)} bloques`, `${c.quickAreaStock >= c.engineStock ? '+' : ''}${int(c.quickAreaStock - c.engineStock)} u respecto del despiece`));
}

function patterns(tot) {
    const blocks = tot.blocks.filter((b) => b.cutBlocks > 0);
    if (!blocks.length) return h('p', { class: 'muted' }, 'No hay piezas que cortar.');
    return h('div', {}, blocks.map((b) => h('div', { class: 'tablewrap', style: 'margin-top:12px' }, h('table', { class: 'table' },
        h('caption', {}, `${b.label} — ${int(b.cutBlocks)} bloques a cortar · descarte ${pct(b.scrapPct, 2)}`),
        th('<Patrón de corte (cm)', 'Bloques', 'Sobrante (cm)'),
        h('tbody', {}, b.patterns.map((p) => h('tr', {}, h('td', { class: 'pattern l' }, p.pattern.map((v) => cm(v)).join(' + ')), h('td', {}, int(p.blocks)), h('td', {}, cm(p.restCm)))))))));
}

function timber(t) {
    if (!t.fields.length && !t.beams.length) return h('p', { class: 'muted' }, 'No hay estructura de entrepiso. Dibujala con las herramientas Entrepiso (E) y Viga de madera (T) sobre la Planta Baja.');
    const b = t.bom;
    const rows = [];
    for (const [section, byLen] of Object.entries(b.pieces)) {
        for (const [len, qty] of Object.entries(byLen)) rows.push(h('tr', {}, h('td', {}, `Tirante/viga ${config.timberSections[section].label}`), h('td', {}, `${fmt(len / 100, 2)} m`), h('td', {}, int(qty))));
    }
    return h('div', {},
        h('div', { class: 'tablewrap' }, h('table', { class: 'table' }, h('caption', {}, 'Tirantes y vigas por largo comercial'), th('<Pieza', 'Largo', 'Cantidad'), h('tbody', {}, rows))),
        h('div', { class: 'tablewrap', style: 'margin-top:12px' }, h('table', { class: 'table' }, h('caption', {}, 'Campos de tirantes'), th('<Entrepiso', '<Sección', 'Luz libre', 'Tirantes', 'Entre ejes', 'Largo'),
            h('tbody', {}, t.fields.map((f, i) => h('tr', {}, h('td', {}, `Campo ${i + 1} (${f.dir === 'x' ? 'tirantes en X' : 'tirantes en Y'})`), tl(f.section.replace('x', '″×') + '″'), h('td', {}, `${fmt(f.clearSpanCm / 100, 2)} m`), h('td', {}, int(f.count)), h('td', {}, `${fmt(f.spacingCm, 1)} cm`), h('td', {}, `${fmt(f.lengthCm / 100, 2)} m`)))))),
        h('div', { class: 'tablewrap', style: 'margin-top:12px' }, h('table', { class: 'table' }, h('caption', {}, 'Complementos'), th('<Concepto', 'Cantidad', '<Unidad'),
            h('tbody', {},
                h('tr', {}, h('td', {}, 'Placas de entrepiso OSB 18 mm (1,22 × 2,44 m, +10 %)'), h('td', {}, int(b.osbSheets)), tl(`placas · ${fmt(b.osbM2, 2)} m²`)),
                h('tr', {}, h('td', {}, 'Cenefas de cierre de tirantes'), h('td', {}, fmt(Object.values(b.cenefaMl).reduce((a, v) => a + v, 0), 1)), tl('m')),
                h('tr', {}, h('td', {}, 'Banda elástica de apoyo'), h('td', {}, int(b.elasticBandMl)), tl('m')),
                h('tr', {}, h('td', {}, 'Placas de reparto de carga (vigas puntuales)'), h('td', {}, int(b.plates)), tl('u'))))));
}

function prices(project) {
    const p = project.settings.prices;
    const inputs = Object.entries(PRICE_LABELS).map(([key, [label, unit]]) => h('tr', {},
        h('td', {}, label), tl(`${project.settings.currency}/${unit}`),
        h('td', {}, h('input', { class: 'price', type: 'number', min: 0, step: 0.01, value: p[key], 'aria-label': `Precio de ${label}`, onchange: (e) => setPrice(key, Number(e.target.value)) }))));
    return h('details', { class: 'card', style: 'padding:6px 14px 12px;margin-bottom:14px' },
        h('summary', { style: 'cursor:pointer;font-weight:700;padding:6px 0' }, 'Precios de referencia (editables)'),
        h('div', { class: 'actions-row' },
            h('label', { class: 'field-inline' }, 'Moneda', h('input', { type: 'text', maxlength: 8, value: project.settings.currency, style: 'width:80px', onchange: (e) => setSettings({ currency: e.target.value }) })),
            h('label', { class: 'field-inline' }, 'Reserva por rotura (%)', h('input', { type: 'number', min: 0, max: 30, value: project.settings.reservePct, style: 'width:80px', onchange: (e) => setSettings({ reservePct: Number(e.target.value) }) }))),
        h('div', { class: 'tablewrap' }, h('table', { class: 'table' }, th('<Concepto', '<Unidad', 'Precio'), h('tbody', {}, inputs))),
        h('p', { class: 'small muted' }, 'Valores de ejemplo: reemplazalos por los de tu distribuidor HCCA.'));
}

async function setPrice(key, value) {
    if (!Number.isFinite(value) || value < 0) return;
    await recalc({ ...state.project, settings: { ...state.project.settings, prices: { ...state.project.settings.prices, [key]: value } } });
}

async function setSettings(patch) {
    await recalc({ ...state.project, settings: { ...state.project.settings, ...patch } });
}

function quote(bom) {
    const groups = [...new Set(bom.lines.map((l) => l.group))];
    const body = [];
    for (const g of groups) {
        body.push(h('tr', { class: 'group' }, h('td', { colspan: 6 }, g)));
        for (const l of bom.lines.filter((x) => x.group === g)) {
            body.push(h('tr', {}, tl(l.code), tl(l.desc, l.note ? h('div', { class: 'small muted' }, l.note) : null), h('td', {}, `${fmt(l.qty, Number.isInteger(l.qty) ? 0 : 2)} ${l.unit}`), h('td', {}, fmt(l.unitPrice, 2)), h('td', {}, fmt(l.subtotal, 2)), h('td', {})));
        }
    }
    return h('div', { class: 'tablewrap' }, h('table', { class: 'table' },
        h('caption', {}, `Cotización referencial (${bom.currency})`),
        th('<Cód.', '<Descripción', 'Cantidad', 'P. unit.', 'Subtotal', ''),
        h('tbody', {}, body),
        h('tfoot', {}, h('tr', {}, h('th', { colspan: 4, scope: 'row' }, 'TOTAL'), h('td', {}, money(bom.totalCost, bom.currency)), h('td', {})))));
}

/** Resumen de texto para canalizar la cotización a un distribuidor (correo o WhatsApp). */
function summaryText() {
    const { project, analysis } = state;
    const { bom, telemetry } = analysis;
    const lines = [
        `Solicitud de cotización HCCA — ${project.name}`,
        `${fmt(telemetry.total.netM2, 1)} m² útiles, ${telemetry.total.levelsUsed} nivel(es).`,
        '',
        ...bom.total.blocks.map((b) => `- ${b.label}: ${int(b.order)} u (${b.pallets.full} pallets + ${b.pallets.loose} u)`),
        `- Mortero adhesivo de junta delgada: ${int(bom.total.mortar.adhesiveBags)} bolsas de 25 kg`,
        `- Mortero cementicio de nivelación: ${int(bom.total.mortar.levelingBags)} bolsas de 25 kg`,
        '',
        'Consulto disponibilidad, flete y plazo de entrega. Gracias.',
    ];
    return lines.join('\n');
}

function sendToDistributor() {
    const text = summaryText();
    return h('div', { class: 'actions-row' },
        h('a', { class: 'btn btn-primary', href: `mailto:?subject=${encodeURIComponent(`Cotización HCCA — ${state.project.name}`)}&body=${encodeURIComponent(text)}` }, 'Solicitar cotización por correo'),
        h('a', { class: 'btn btn-outline', target: '_blank', rel: 'noopener', href: `https://wa.me/?text=${encodeURIComponent(text)}` }, 'Enviar por WhatsApp'),
        h('button', { type: 'button', class: 'btn btn-outline', onclick: async () => { await navigator.clipboard?.writeText(text); } }, 'Copiar resumen'));
}

/* ------------------------------------------------------------------ exportaciones (en el cliente) */
function csvRows(sep) {
    const { project, analysis } = state;
    const { bom } = analysis;
    const n = (v, d = 2) => (sep === ';' ? fmt(v, d).replaceAll('.', '') : String(Math.round(v * 10 ** d) / 10 ** d));
    const rows = [
        ['Blockk Studio — Cómputo métrico HCCA'],
        ['Proyecto', project.name],
        ['Moneda', bom.currency],
        ['Reserva por rotura (%)', bom.reservePct],
        [],
        ['MAMPOSTERÍA', 'Nivel', 'Código', 'Descripción', 'Piezas', 'Enteras', 'Cortadas', 'Bloques cortados', 'Stock', 'Reserva', 'A comprar', 'Volumen m3', 'Pallets completos', 'Sueltas', 'Pallets total'],
    ];
    const add = (label, scope) => {
        for (const b of scope.blocks) rows.push(['', label, b.code, b.label, b.pieces, b.full, b.cutPieces, b.cutBlocks, b.stock, b.reserve, b.order, n(b.volumeM3), b.pallets.full, b.pallets.loose, b.pallets.total]);
    };
    add('Total de obra', bom.total);
    bom.levels.forEach((l, i) => { if (l.used) add(config.levelShort[i], l); });
    rows.push([], ['OPTIMIZACIÓN DE CORTES', 'Código', 'Patrón (cm)', 'Bloques', 'Sobrante (cm)']);
    for (const b of bom.total.blocks) for (const p of b.patterns) rows.push(['', b.code, p.pattern.join(' + '), p.blocks, p.restCm]);
    rows.push([], ['INDICADORES', 'Valor'], ['Descarte de material (%)', n(bom.total.scrapPct)], ['Bloques con corte (%)', n(bom.total.cutBlocksPct)], ['Bloques sin reaprovechar remanentes', bom.comparison.noReuseStock], ['Bloques con reaprovechamiento', bom.comparison.engineStock]);
    rows.push([], ['COTIZACIÓN REFERENCIAL', 'Grupo', 'Código', 'Descripción', 'Cantidad', 'Unidad', 'Precio unitario', 'Subtotal', 'Detalle']);
    for (const l of bom.lines) rows.push(['', l.group, l.code, l.desc, n(l.qty), l.unit, n(l.unitPrice), n(l.subtotal), l.note]);
    rows.push(['TOTAL', '', '', '', '', '', '', n(bom.totalCost)]);
    return rows;
}

$('#btn-csv').addEventListener('click', () => {
    if (!state.analysis) return;
    const sep = $('#csv-sep').value;
    downloadBlob(new Blob([toCsv(csvRows(sep), sep)], { type: 'text/csv;charset=utf-8' }), `${slug(state.project.name)}-computo.csv`);
});

$('#btn-pdf').addEventListener('click', () => {
    if (!state.analysis) return;
    downloadBlob(buildPdf(state.project, state.analysis, config), `${slug(state.project.name)}-ficha-obra.pdf`);
});

boot();
