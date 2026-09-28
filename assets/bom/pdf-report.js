/** Ficha de obra en PDF vectorial (se genera íntegramente en el navegador). */
import { Pdf } from '../lib/pdf.js';
import { fmt, int, cm } from '../lib/format.js';

const GRAPHITE = [30, 41, 59];
const GREEN = [139, 197, 63];
const MUTED = [85, 96, 112];
const LIGHT = [247, 249, 255];
const M = 40; // margen

export function buildPdf(project, analysis, config) {
    const { bom, telemetry, issues } = analysis;
    const pdf = new Pdf().addPage();
    const W = pdf.pageWidth;

    let y = header(pdf, 'Ficha de obra — cómputo y despiece', project.name);

    // Resumen
    const tot = telemetry.total;
    const facts = [
        ['Superficie útil', `${fmt(tot.netM2, 1)} m²`],
        ['Niveles / altura', `${tot.levelsUsed} / ${fmt(tot.heightM, 2)} m`],
        ['Bloques a comprar', int(tot.blocks)],
        ['Pallets', int(tot.pallets)],
        ['Descarte de material', `${fmt(bom.total.scrapPct, 2)} %`],
        ['Bloques con corte', `${fmt(bom.total.cutBlocksPct, 1)} %`],
    ];
    const colW = (W - 2 * M) / 3;
    facts.forEach(([k, v], i) => {
        const cx = M + (i % 3) * colW;
        const cy = y + Math.floor(i / 3) * 44;
        pdf.rect(cx, cy, colW - 8, 38, { fill: LIGHT, stroke: [213, 219, 230] });
        pdf.text(cx + 8, cy + 14, k, { size: 8, color: MUTED });
        pdf.text(cx + 8, cy + 31, v, { size: 14, bold: true });
    });
    y += 96;

    y = table(pdf, y, 'Mampostería HCCA (total de obra)', [
        { title: 'Cód.', w: 40 },
        { title: 'Descripción', w: 230 },
        { title: 'A comprar', w: 64, align: 'right' },
        { title: 'Vol. m³', w: 54, align: 'right' },
        { title: 'Pallets', w: 90, align: 'right' },
    ], bom.total.blocks.map((b) => [b.code, b.label, int(b.order), fmt(b.volumeM3, 2), `${b.pallets.full} + ${b.pallets.loose} u`]));

    y = table(pdf, y + 10, `Cotización referencial (${bom.currency}) — precios de ejemplo`, [
        { title: 'Descripción', w: 262 },
        { title: 'Cantidad', w: 80, align: 'right' },
        { title: 'P. unit.', w: 66, align: 'right' },
        { title: 'Subtotal', w: 70, align: 'right' },
    ], [
        ...bom.lines.map((l) => [l.desc, `${fmt(l.qty, Number.isInteger(l.qty) ? 0 : 2)} ${l.unit}`, fmt(l.unitPrice, 2), fmt(l.subtotal, 2)]),
        ['TOTAL', '', '', fmt(bom.totalCost, 2)],
    ], { boldLast: true });

    // Plantas
    telemetry.levels.forEach((lv, i) => {
        if (!lv.used) return;
        pdf.addPage();
        let py = header(pdf, `Planta — ${config.levelNames[i]}`, project.name);
        const area = { x: M, y: py, w: W - 2 * M, h: 500 };
        drawPlan(pdf, project.levels[i], analysis.levels[i], area, project.north);
        py = area.y + area.h + 14;
        pdf.text(M, py, `Superficie útil ${fmt(lv.netM2, 2)} m² · muros ${fmt(lv.wallLengthM, 2)} m · ${lv.courses.regular} hiladas + 1 hilada de bloque U = ${lv.courses.total} (${fmt(lv.heightM, 2)} m)`, { size: 9, color: MUTED });
        pdf.text(M, py + 14, 'Referencias: muro macizo = grafito · vanos en blanco (puerta con arco de giro, ventana con doble línea) · retícula 12,5 cm · norte según rosa.', { size: 8, color: MUTED });
    });

    // Cortes y observaciones
    pdf.addPage();
    y = header(pdf, 'Optimización de cortes y observaciones', project.name);
    for (const b of bom.total.blocks.filter((x) => x.cutBlocks > 0)) {
        y = table(pdf, y, `${b.label} — ${b.cutBlocks} bloques a cortar, descarte ${fmt(b.scrapPct, 2)} %`, [
            { title: 'Patrón de corte (cm)', w: 250 },
            { title: 'Bloques', w: 80, align: 'right' },
            { title: 'Sobrante (cm)', w: 100, align: 'right' },
        ], b.patterns.map((p) => [p.pattern.map((v) => cm(v)).join(' + '), int(p.blocks), cm(p.restCm)]));
        y += 10;
    }
    const notes = issues.filter((i) => i.severity !== 'info');
    y = table(pdf, y, `Observaciones de validación (${notes.length})`, [{ title: 'Detalle', w: 480 }], notes.length ? notes.map((i) => [`${i.severity === 'error' ? '[ERROR] ' : '[AVISO] '}${i.level === 1 ? '[PA] ' : ''}${i.message}`]) : [['Sin observaciones.']]);
    pdf.text(M, Math.min(y + 24, pdf.pageHeight - 60), 'Predimensionado del editor: no reemplaza el cálculo estructural (CIRSOC 501 / Eurocódigo 6). Precios de ejemplo, no constituyen una cotización.', { size: 8, color: MUTED });

    return pdf.toBlob();
}

function header(pdf, title, subtitle) {
    const W = pdf.pageWidth;
    pdf.rect(0, 0, W, 58, { fill: GRAPHITE });
    pdf.rect(M, 16, 26, 26, { fill: GREEN });
    pdf.text(M + 36, 34, 'Blockk Studio', { size: 15, bold: true, color: [255, 255, 255] });
    pdf.text(W - M, 24, title, { size: 11, bold: true, color: [255, 255, 255], align: 'right' });
    pdf.text(W - M, 40, `${subtitle} · ${new Date().toLocaleDateString('es-AR')}`, { size: 9, color: [203, 213, 225], align: 'right' });
    return 78;
}

/** Tabla simple con corte de página y encabezado repetido. Devuelve la nueva coordenada y. */
function table(pdf, y, caption, cols, rows, { boldLast = false } = {}) {
    const rowH = 15;
    const draw = (yy) => {
        pdf.text(M, yy + 10, caption, { size: 10, bold: true });
        yy += 16;
        pdf.rect(M, yy, cols.reduce((a, c) => a + c.w, 0), rowH, { fill: GRAPHITE });
        let x = M;
        for (const c of cols) {
            pdf.text(c.align === 'right' ? x + c.w - 5 : x + 5, yy + 10.5, c.title, { size: 8, bold: true, color: [255, 255, 255], align: c.align === 'right' ? 'right' : 'left' });
            x += c.w;
        }
        return yy + rowH;
    };
    if (y > pdf.pageHeight - 90) {
        pdf.addPage();
        y = 40;
    }
    y = draw(y);
    rows.forEach((r, idx) => {
        if (y > pdf.pageHeight - 50) {
            pdf.addPage();
            y = draw(40);
        }
        const last = boldLast && idx === rows.length - 1;
        if (idx % 2 === 1) pdf.rect(M, y, cols.reduce((a, c) => a + c.w, 0), rowH, { fill: LIGHT });
        let x = M;
        cols.forEach((c, ci) => {
            const text = fit(pdf, String(r[ci] ?? ''), c.w - 10, last);
            pdf.text(c.align === 'right' ? x + c.w - 5 : x + 5, y + 10.5, text, { size: 8.5, bold: last, align: c.align === 'right' ? 'right' : 'left' });
            x += c.w;
        });
        y += rowH;
    });
    pdf.line(M, y, M + cols.reduce((a, c) => a + c.w, 0), y, { width: 0.5, color: [213, 219, 230] });

    return y + 8;
}

/** Recorta con "…" el texto que no entra en el ancho disponible. */
function fit(pdf, text, maxW, bold) {
    if (pdf.textWidth(text, 8.5, bold) <= maxW) return text;
    let t = text;
    while (t.length > 1 && pdf.textWidth(`${t}…`, 8.5, bold) > maxW) t = t.slice(0, -1);
    return `${t}…`;
}

/** Planta del nivel como vectores: muros (unión de las hiladas 1 y 2), vanos, ambientes y cotas generales. */
function drawPlan(pdf, level, analysis, area, north) {
    const rects = new Map();
    for (const c of [0, 1]) {
        for (const run of analysis.courses[c] ?? []) {
            const half = run.t / 2;
            const r = run.axis === 'x' ? [run.a, run.line - half, run.b, run.line + half] : [run.line - half, run.a, run.line + half, run.b];
            rects.set(r.join(','), r);
        }
    }
    const list = [...rects.values()];
    if (!list.length) return;
    const minX = Math.min(...list.map((r) => r[0]));
    const maxX = Math.max(...list.map((r) => r[2]));
    const minY = Math.min(...list.map((r) => r[1]));
    const maxY = Math.max(...list.map((r) => r[3]));
    const pad = 34;
    const s = Math.min((area.w - 2 * pad) / (maxX - minX), (area.h - 2 * pad) / (maxY - minY));
    const ox = area.x + (area.w - (maxX - minX) * s) / 2 - minX * s;
    const oy = area.y + (area.h - (maxY - minY) * s) / 2 - minY * s;
    const X = (v) => ox + v * s;
    const Y = (v) => oy + v * s;

    pdf.rect(area.x, area.y, area.w, area.h, { stroke: [213, 219, 230] });
    for (const [x0, y0, x1, y1] of list) pdf.rect(X(x0), Y(y0), (x1 - x0) * s, (y1 - y0) * s, { fill: GRAPHITE });

    for (const o of level.openings) {
        const w = level.walls.find((q) => q.id === o.wall);
        if (!w) continue;
        const horizontal = w.y1 === w.y2;
        const from = (horizontal ? w.x1 : w.y1) * 12.5 + o.pos * 12.5;
        const len = o.w * 12.5;
        const line = (horizontal ? w.y1 : w.x1) * 12.5;
        const t = w.t;
        if (horizontal) {
            pdf.rect(X(from), Y(line - t / 2 - 0.2), len * s, (t + 0.4) * s, { fill: [255, 255, 255] });
            if (o.kind === 'window') for (const off of [-t / 4, 0, t / 4]) pdf.line(X(from), Y(line + off), X(from + len), Y(line + off), { width: 0.6 });
            else pdf.line(X(from), Y(line), X(from), Y(line + (o.flip ? -len : len)), { width: 0.8 });
        } else {
            pdf.rect(X(line - t / 2 - 0.2), Y(from), (t + 0.4) * s, len * s, { fill: [255, 255, 255] });
            if (o.kind === 'window') for (const off of [-t / 4, 0, t / 4]) pdf.line(X(line + off), Y(from), X(line + off), Y(from + len), { width: 0.6 });
            else pdf.line(X(line), Y(from), X(line + (o.flip ? -len : len)), Y(from), { width: 0.8 });
        }
    }

    for (const r of analysis.rooms) {
        const cx = X((r.bbox.x + r.bbox.w / 2) * 12.5);
        const cy = Y((r.bbox.y + r.bbox.h / 2) * 12.5);
        pdf.text(cx, cy, r.name, { size: 8, bold: true, align: 'center' });
        pdf.text(cx, cy + 10, `${fmt(r.netM2, 2)} m²`, { size: 8, color: MUTED, align: 'center' });
    }

    // cotas generales (a ejes)
    const dimY = Y(maxY) + 16;
    pdf.line(X(minX), dimY, X(maxX), dimY, { width: 0.6, color: MUTED });
    pdf.text((X(minX) + X(maxX)) / 2, dimY + 11, `${fmt((maxX - minX) / 100, 2)} m (exterior)`, { size: 8, color: MUTED, align: 'center' });
    const dimX = X(maxX) + 16;
    pdf.line(dimX, Y(minY), dimX, Y(maxY), { width: 0.6, color: MUTED });
    pdf.text(dimX + 4, (Y(minY) + Y(maxY)) / 2, `${fmt((maxY - minY) / 100, 2)} m`, { size: 8, color: MUTED });

    // norte
    const th = (north * Math.PI) / 180;
    const nx = area.x + area.w - 30;
    const ny = area.y + 34;
    pdf.line(nx, ny, nx + Math.sin(th) * 20, ny - Math.cos(th) * 20, { width: 1.6, color: [180, 35, 24] });
    pdf.text(nx + Math.sin(th) * 26, ny - Math.cos(th) * 26 + 3, 'N', { size: 9, bold: true, color: [180, 35, 24], align: 'center' });
}
