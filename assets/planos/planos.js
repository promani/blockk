/*
 * Planos de obra en PDF, generados en el navegador a partir del análisis del motor (la misma fuente que el cómputo):
 * portada con la isométrica, una planta por nivel, la planta de techos, un alzado por muro (hilada por hilada, con cada
 * pieza y sus cortes) y la lista de materiales.
 */
import { Pdf, A4_LANDSCAPE } from '../lib/pdf.js';
import { fmt, int, cm } from '../lib/format.js';
import { header, table, drawPlan } from '../bom/pdf-report.js';
import { drawTheme, mix } from '../lib/theme.js';

const M = 40;
const MUTED = [85, 96, 112];
const LINE = [213, 219, 230];
const GRAPHITE = [30, 41, 59];

const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Muros de un nivel tal como los arma el motor: los tramos de cada hilada sobre una misma línea que se superponen son
 * el mismo muro. Numerados M1, M2… (primero los horizontales de arriba a abajo, después los verticales de izquierda a
 * derecha).
 */
export function wallsOf(analysis, li) {
    const groups = [];
    (analysis.levels[li]?.courses ?? []).forEach((runs, c) => {
        for (const r of runs) {
            let g = groups.find((q) => q.axis === r.axis && q.line === r.line && r.a < q.b + r.t && r.b > q.a - r.t);
            if (!g) {
                g = { axis: r.axis, line: r.line, t: r.t, a: r.a, b: r.b, rows: [] };
                groups.push(g);
            }
            g.a = Math.min(g.a, r.a);
            g.b = Math.max(g.b, r.b);
            g.t = Math.max(g.t, r.t);
            (g.rows[c] ??= []).push(r);
        }
    });
    groups.sort((p, q) => (p.axis === q.axis ? p.line - q.line || p.a - q.a : p.axis === 'x' ? -1 : 1));
    return groups.map((g, i) => {
        const pieces = g.rows.flat().filter(Boolean).flatMap((r) => r.pieces);
        const cuts = new Map();
        const uCuts = new Map();
        let whole = 0;
        let uWhole = 0;
        for (const [p0, p1, kind] of pieces) {
            const len = Math.round((p1 - p0) * 100) / 100;
            if (kind === 0) whole++;
            else if (kind === 1) cuts.set(len, (cuts.get(len) ?? 0) + 1);
            else if (kind === 2) uWhole++;
            else uCuts.set(len, (uCuts.get(len) ?? 0) + 1);
        }
        return {
            ...g,
            level: li,
            code: `N${li + 1}-M${i + 1}`,
            courses: g.rows.filter(Boolean).length,
            pieces: pieces.length,
            whole,
            uWhole,
            cuts: [...cuts].sort((p, q) => q[0] - p[0]),
            uCuts: [...uCuts].sort((p, q) => q[0] - p[0]),
        };
    });
}

const wallTitle = (w) => `${w.axis === 'x' ? 'horizontal' : 'vertical'}, eje ${w.axis === 'x' ? 'y' : 'x'} = ${fmt(w.line / 100, 2)} m · ${fmt((w.b - w.a) / 100, 2)} m · ${cm(w.t)} cm`;

/** Lista de planos (lo que va a tener el PDF), para mostrarla antes de generarlo. */
export function planList(project, analysis, config) {
    const levels = analysis.telemetry.levels.map((lv, i) => ({ ...lv, i })).filter((lv) => lv.used);
    const walls = levels.flatMap((lv) => wallsOf(analysis, lv.i));
    const items = [{ kind: 'cover', title: 'Portada', detail: 'Isométrica de la casa, datos principales e índice' }];
    for (const lv of levels) items.push({ kind: 'plan', level: lv.i, title: `Planta — ${config.levelNames[lv.i]}`, detail: `${fmt(lv.netM2, 1)} m² útiles · ${fmt(lv.wallLengthM, 1)} m de muros` });
    if (analysis.roof?.parts?.length) items.push({ kind: 'roofs', title: 'Planta de techos', detail: `${analysis.roof.parts.length} techo${analysis.roof.parts.length > 1 ? 's' : ''}, con la caída del agua` });
    for (const w of walls) items.push({ kind: 'wall', wall: w, title: `Muro ${w.code}`, detail: `${wallTitle(w)} · ${int(w.pieces)} piezas (${w.cuts.reduce((s, [, n]) => s + n, 0) + w.uCuts.reduce((s, [, n]) => s + n, 0)} con corte)` });
    items.push({ kind: 'materials', title: 'Lista de materiales', detail: 'Bloques por espesor, pallets y el resto del cómputo' });
    return items;
}

/** Genera el PDF. `iso` = { url, w, h } (JPEG de la isométrica) o null. */
export function buildPlanos(project, analysis, config, iso) {
    const items = planList(project, analysis, config);
    const pdf = new Pdf();
    // número de página de cada plano (la lista de materiales puede ocupar más de una)
    items.forEach((it, i) => { it.page = i + 1; });

    cover(pdf, project, analysis, config, items, iso);
    for (const it of items) {
        if (it.kind === 'plan') planPage(pdf, project, analysis, config, it);
        else if (it.kind === 'roofs') roofsPage(pdf, project, analysis, config);
        else if (it.kind === 'wall') wallPage(pdf, project, analysis, config, it.wall);
        else if (it.kind === 'materials') materialsPage(pdf, project, analysis);
    }
    return pdf.toBlob();
}

function footer(pdf, project, page) {
    pdf.text(M, pdf.pageHeight - 18, `${project.name} · Blockk Studio · predimensionado: no reemplaza el cálculo de un profesional`, { size: 7, color: MUTED });
    pdf.text(pdf.pageWidth - M, pdf.pageHeight - 18, `Hoja ${page}`, { size: 7, color: MUTED, align: 'right' });
}

function cover(pdf, project, analysis, config, items, iso) {
    pdf.addPage(A4_LANDSCAPE);
    const W = pdf.pageWidth;
    let y = header(pdf, 'Planos de obra', project.name);
    pdf.text(M, y + 18, project.name, { size: 22, bold: true });
    y += 34;
    const imgW = 500;
    const imgH = iso ? (imgW * iso.h) / iso.w : 0;
    if (iso) {
        pdf.rect(M, y, imgW, imgH, { stroke: LINE });
        pdf.image(M, y, imgW, imgH, iso.url, iso.w, iso.h);
    }
    const t = analysis.telemetry.total;
    const facts = [
        ['Superficie útil', `${fmt(t.netM2, 1)} m²`],
        ['Niveles · altura', `${t.levelsUsed} · ${fmt(t.heightM, 2)} m`],
        ['Bloques a comprar', int(t.blocks)],
        ['Pallets', int(t.pallets)],
        ['Muros', int(items.filter((i) => i.kind === 'wall').length)],
        ['Bloque', config.blockSystem?.label ?? ''],
    ];
    const x = M + imgW + 24;
    let fy = y;
    for (const [k, v] of facts) {
        pdf.text(x, fy + 10, k, { size: 8, color: MUTED });
        pdf.text(x, fy + 25, String(v), { size: 13, bold: true });
        fy += 34;
    }
    fy += 18;
    pdf.text(x, fy, 'Índice', { size: 10, bold: true });
    fy += 14;
    const maxRows = Math.floor((pdf.pageHeight - 40 - fy) / 11);
    const list = items.length > maxRows ? [...items.slice(0, maxRows - 1), { title: `… y ${items.length - maxRows + 1} hojas más`, page: '' }] : items;
    for (const it of list) {
        pdf.text(x, fy, it.title, { size: 8 });
        pdf.text(W - M, fy, String(it.page), { size: 8, color: MUTED, align: 'right' });
        fy += 11;
    }
    pdf.text(M, y + imgH + 18, `Generado el ${new Date().toLocaleDateString('es-AR')} con el motor de Blockk Studio. Las medidas son a ejes de muro; las piezas, las del despiece del cómputo.`, { size: 8, color: MUTED });
    footer(pdf, project, 1);
}

function planPage(pdf, project, analysis, config, it) {
    pdf.addPage(A4_LANDSCAPE);
    const y = header(pdf, it.title, project.name);
    const area = { x: M, y, w: pdf.pageWidth - 2 * M, h: pdf.pageHeight - y - 60 };
    drawPlan(pdf, project.levels[it.level], analysis.levels[it.level], area, project.north ?? 0);
    pdf.text(M, area.y + area.h + 14, `${it.detail} · muro macizo en grafito · vanos en blanco (puerta con su giro, ventana con doble línea) · cotas exteriores a ejes`, { size: 8, color: MUTED });
    footer(pdf, project, it.page);
}

/** Contorno de los muros (hiladas 1 y 2) de un nivel, para planos chicos de referencia. */
function wallRects(analysis, li) {
    const out = new Map();
    for (const c of [0, 1]) {
        for (const r of analysis.levels[li]?.courses?.[c] ?? []) {
            const h = r.t / 2;
            const rc = r.axis === 'x' ? [r.a, r.line - h, r.b, r.line + h] : [r.line - h, r.a, r.line + h, r.b];
            out.set(rc.join(','), rc);
        }
    }
    return [...out.values()];
}

/** Encuadre de rectángulos [x0, y0, x1, y1] (cm) en un área de la hoja. */
function fitter(rects, area, pad) {
    const minX = Math.min(...rects.map((r) => r[0]));
    const maxX = Math.max(...rects.map((r) => r[2]));
    const minY = Math.min(...rects.map((r) => r[1]));
    const maxY = Math.max(...rects.map((r) => r[3]));
    const s = Math.min((area.w - 2 * pad) / (maxX - minX || 1), (area.h - 2 * pad) / (maxY - minY || 1));
    const ox = area.x + (area.w - (maxX - minX) * s) / 2 - minX * s;
    const oy = area.y + (area.h - (maxY - minY) * s) / 2 - minY * s;
    return { X: (v) => ox + v * s, Y: (v) => oy + v * s, s };
}

function roofsPage(pdf, project, analysis, config) {
    pdf.addPage(A4_LANDSCAPE);
    const y = header(pdf, 'Planta de techos', project.name);
    const parts = analysis.roof.parts;
    const top = analysis.telemetry.levels.map((lv, i) => (lv.used ? i : -1)).filter((i) => i >= 0);
    const walls = top.flatMap((li) => wallRects(analysis, li));
    const outers = parts.map((p) => {
        const o = p.geometry.outer ?? p.geometry.rect;
        return [o.x0, o.y0, o.x1, o.y1];
    });
    const area = { x: M, y, w: pdf.pageWidth - 2 * M, h: pdf.pageHeight - y - 70 };
    pdf.rect(area.x, area.y, area.w, area.h, { stroke: LINE });
    const { X, Y } = fitter([...walls, ...outers], area, 30);
    const roof = rgb(drawTheme().roof);
    const light = rgb(mix(drawTheme().roof, '#ffffff', 0.75));
    const arrow = (x, y, dx, dy) => {
        const len = 26;
        const ex = x + dx * len;
        const ey = y + dy * len;
        pdf.line(x, y, ex, ey, { width: 1.2, color: roof });
        pdf.polygon([[ex + dx * 6, ey + dy * 6], [ex - dy * 4, ey + dx * 4], [ex + dy * 4, ey - dx * 4]], { fill: roof });
    };
    parts.forEach((p, i) => {
        const [x0, y0, x1, y1] = outers[i];
        pdf.rect(X(x0), Y(y0), X(x1) - X(x0), Y(y1) - Y(y0), { fill: light, stroke: roof, lineWidth: 1 });
        const cx = X((x0 + x1) / 2);
        const cy = Y((y0 + y1) / 2);
        const g = p.geometry;
        const spec = project.roofs?.find((r) => r.id === p.id);
        if (g.ridge) {
            pdf.line(X(g.ridge.from[0]), Y(g.ridge.from[1]), X(g.ridge.to[0]), Y(g.ridge.to[1]), { width: 1.6, color: [74, 33, 16] });
            const alongX = g.dir === 'x';
            const off = 0.25 * (alongX ? Y(y1) - Y(y0) : X(x1) - X(x0));
            for (const sgn of [-1, 1]) arrow(alongX ? cx : cx + sgn * off, alongX ? cy + sgn * off : cy, alongX ? 0 : sgn, alongX ? sgn : 0);
        } else {
            const d = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[g.dir] ?? [0, 1];
            arrow(cx - d[0] * 13, cy + 12 - d[1] * 13, d[0], d[1]);
        }
        const label = `Techo ${i + 1} (${config.levelNames[p.level] ?? ''}) · ${p.type === 'gable' ? 'dos aguas' : 'un agua'} · ${spec?.slope ?? ''} %`;
        const tw = pdf.textWidth(label, 8, true);
        pdf.rect(cx - tw / 2 - 4, cy - 26, tw + 8, 14, { fill: [255, 255, 255], stroke: roof });
        pdf.text(cx, cy - 16, label, { size: 8, bold: true, align: 'center' });
    });
    // ejes de los muros del último nivel por encima: se ve sobre qué apoya cada techo
    for (const r of analysis.levels[top.at(-1)]?.courses?.[0] ?? []) {
        const [ax, ay, bx, by] = r.axis === 'x' ? [r.a, r.line, r.b, r.line] : [r.line, r.a, r.line, r.b];
        pdf.line(X(ax), Y(ay), X(bx), Y(by), { width: 0.6, color: [100, 116, 139], dash: [3, 2] });
    }
    pdf.text(M, area.y + area.h + 14, 'Las flechas marcan hacia dónde cae el agua; la línea gruesa es la cumbrera. Punteados, los ejes de los muros del último nivel. Los techos vuelan el alero sólo donde cae el agua.', { size: 8, color: MUTED });
    footer(pdf, project, pdf.pages.length);
}

/**
 * Hastiales que apoyan sobre el muro, en coordenadas del alzado: u a lo largo del muro (cm) y v sobre la corona del
 * muro (cm). Cada hilada con su comienzo, fin y juntas.
 */
function gablesOn(analysis, w) {
    const out = [];
    for (const part of analysis.roof?.parts ?? []) {
        if (part.level !== w.level) continue;
        for (const g of part.geometry.gables ?? []) {
            if (g.enabled === false || g.plane?.axis !== w.axis || Math.abs(g.plane.at - w.line) > 1) continue;
            const ui = w.axis === 'x' ? 0 : 1;
            const z0 = Math.min(...g.pts.map((q) => q[2]));
            const pts = g.pts.map((q) => [q[ui], q[2] - z0]);
            const us = pts.map((q) => q[0]);
            if (Math.max(...us) <= w.a || Math.min(...us) >= w.b) continue;
            // alto del polígono en u (el borde de arriba)
            const topAt = (u) => {
                let best = 0;
                for (let i = 0; i < pts.length; i++) {
                    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
                    if (u < Math.min(a[0], b[0]) - 1e-6 || u > Math.max(a[0], b[0]) + 1e-6) continue;
                    const v = a[0] === b[0] ? Math.max(a[1], b[1]) : a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]);
                    best = Math.max(best, v);
                }
                return best;
            };
            // largo de cada pieza (ticks de 0,5 mm → cm), repartidas en orden por hilada
            const lens = (g.pieces ?? []).map((p) => p / 20);
            let k = 0;
            // piezas [u0, u1, tipo] de cada hilada: las del servidor (con vanos y dinteles) o armadas desde las juntas
            const courses = (g.courses ?? []).map((c) => {
                if (c.spans) return { v0: c.v0, pieces: c.spans };
                const n = c.joints.length + 1;
                const len = lens.slice(k, k + n);
                k += n;
                const ends = [c.u0, ...c.joints, c.u0 + len.reduce((a, b) => a + b, 0)];
                return { v0: c.v0, pieces: ends.slice(0, -1).map((a, i) => [a, ends[i + 1], 0]) };
            });
            const windows = (g.windows ?? []).filter((x) => x.ok).map((x) => ({ u0: x.u0, u1: x.u1, v0: x.z0 - z0, v1: x.z1 - z0 }));
            out.push({ pts, courses, windows, topAt, top: Math.max(...pts.map((q) => q[1])), blocks: (g.blocks ?? 0) + (g.uPieces?.length ?? 0), cutPieces: g.cutPieces ?? 0 });
        }
    }
    return out;
}

function wallPage(pdf, project, analysis, config, w) {
    pdf.addPage(A4_LANDSCAPE);
    const W = pdf.pageWidth;
    let y = header(pdf, `Muro ${w.code} — ${config.levelNames[w.level]}`, project.name);
    pdf.text(M, y + 8, `Muro ${w.code}: ${wallTitle(w)} · ${w.courses} hiladas · ${int(w.pieces)} piezas`, { size: 10, bold: true });
    y += 22;

    const colW = 200;
    const area = { x: M, y, w: W - 2 * M - colW - 20, h: pdf.pageHeight - y - 100 };
    const len = w.b - w.a;
    const rows = Math.max(w.rows.length, 1);
    const wallCm = rows * 25;
    const gables = gablesOn(analysis, w);
    const hCm = wallCm + Math.max(0, ...gables.map((g) => g.top));
    const s = Math.min((area.w - 30) / len, area.h / hCm);
    const x0 = area.x + 22;
    const base = area.y + hCm * s;
    const Z = (v) => base - (wallCm + v) * s;
    const X = (v) => x0 + (v - w.a) * s;
    const t = drawTheme();
    const fills = [rgb(t.block), rgb(t.cut), rgb(t.u), rgb(mix(t.u, '#ffffff', 0.35))];

    // hiladas: cada pieza con su color (entera, cortada, U, U cortada) y la medida de los cortes
    w.rows.forEach((runs, c) => {
        if (!runs) return;
        const yTop = base - (c + 1) * 25 * s;
        pdf.text(area.x + 14, yTop + 12.5 * s + 2.5, String(c + 1), { size: 6, color: MUTED, align: 'right' });
        for (const r of runs) {
            for (const [p0, p1, kind] of r.pieces) {
                pdf.rect(X(p0), yTop, (p1 - p0) * s, 25 * s, { fill: fills[kind] ?? fills[0], stroke: GRAPHITE, lineWidth: 0.35 });
                if ((kind === 1 || kind === 3) && (p1 - p0) * s > 16) pdf.text(X((p0 + p1) / 2), yTop + 12.5 * s + 2.2, cm(p1 - p0), { size: 6, align: 'center' });
            }
        }
    });
    // hastiales sobre el muro: el triángulo con sus hiladas y juntas (los bloques se cortan en diagonal en obra)
    for (const g of gables) {
        pdf.polygon(g.pts.map(([u, v]) => [X(u), Z(v)]), { fill: rgb(mix(t.cut, '#ffffff', 0.45)), stroke: GRAPHITE, lineWidth: 0.6 });
        for (const k of g.courses) {
            const v1 = k.v0 + 25;
            for (const [a, b, type] of k.pieces) {
                // cada pieza recortada por la pendiente; los U del dintel en su color
                const q = [[a, k.v0], [b, k.v0], [b, Math.min(v1, g.topAt(b))], [a, Math.min(v1, g.topAt(a))]];
                pdf.polygon(q.map(([u, v]) => [X(u), Z(v)]), { fill: type === 2 ? fills[2] : null, stroke: GRAPHITE, lineWidth: 0.35 });
            }
        }
        for (const v of g.windows) {
            pdf.rect(X(v.u0), Z(v.v1), (v.u1 - v.u0) * s, (v.v1 - v.v0) * s, { fill: [255, 255, 255], stroke: GRAPHITE, lineWidth: 0.6 });
            pdf.text(X((v.u0 + v.u1) / 2), Z((v.v0 + v.v1) / 2) + 2, `ventana ${fmt((v.u1 - v.u0) / 100, 2)} m`, { size: 6, color: MUTED, align: 'center' });
        }
        // la leyenda va al centro o, si hay ventanas, a un costado (en la mitad libre del hastial)
        const us = g.pts.map((q) => q[0]);
        const cx = g.windows.length ? Math.min(...us) + (Math.max(...us) - Math.min(...us)) * 0.27 : (Math.min(...us) + Math.max(...us)) / 2;
        pdf.text(X(cx), Z(Math.min(g.top * 0.3, g.topAt(cx) * 0.4)) + 3, `hastial · ${g.blocks} bloques`, { size: 6.5, align: 'center' });
    }
    // cota total y ubicación de los vanos (de la primera hilada que los tenga)
    const dimY = base + 16;
    pdf.line(X(w.a), dimY, X(w.b), dimY, { width: 0.6, color: MUTED });
    for (const v of [w.a, w.b]) pdf.line(X(v), dimY - 4, X(v), dimY + 4, { width: 0.6, color: MUTED });
    pdf.text((X(w.a) + X(w.b)) / 2, dimY + 12, `${fmt(len / 100, 2)} m (a ejes de los muros que cruza: ${fmt(w.a / 100, 2)} → ${fmt(w.b / 100, 2)} m)`, { size: 8, color: MUTED, align: 'center' });
    const voids = w.rows.flat().filter(Boolean).flatMap((r) => r.voids ?? []);
    const seen = new Set();
    for (const [v0, v1] of voids) {
        const k = `${v0}:${v1}`;
        if (seen.has(k)) continue;
        seen.add(k);
        pdf.text(X((v0 + v1) / 2), dimY - 7, `vano ${fmt((v1 - v0) / 100, 2)} m`, { size: 6.5, color: MUTED, align: 'center' });
    }
    // leyenda
    let lx = area.x;
    const ly = dimY + 28;
    for (const [label, fill] of [['Bloque entero', fills[0]], ['Bloque cortado (medida en cm)', fills[1]], ['Bloque U', fills[2]], ['Bloque U cortado', fills[3]]]) {
        pdf.rect(lx, ly - 7, 10, 8, { fill, stroke: GRAPHITE, lineWidth: 0.35 });
        pdf.text(lx + 14, ly, label, { size: 7.5 });
        lx += pdf.textWidth(label, 7.5) + 34;
    }
    pdf.text(area.x, ly + 14, w.axis === 'x' ? 'Alzado visto desde abajo del plano (de izquierda a derecha, x creciente).' : 'Alzado visto desde la izquierda del plano (de izquierda a derecha, y creciente).', { size: 7.5, color: MUTED });

    // plano de ubicación
    const kx = W - M - colW;
    const key = { x: kx, y, w: colW, h: 150 };
    pdf.rect(key.x, key.y, key.w, key.h, { stroke: LINE });
    const rects = wallRects(analysis, w.level);
    if (rects.length) {
        const f = fitter(rects, key, 14);
        for (const [a0, b0, a1, b1] of rects) pdf.rect(f.X(a0), f.Y(b0), f.X(a1) - f.X(a0), f.Y(b1) - f.Y(b0), { fill: [203, 213, 225] });
        const h = w.t / 2;
        const me = w.axis === 'x' ? [w.a, w.line - h, w.b, w.line + h] : [w.line - h, w.a, w.line + h, w.b];
        pdf.rect(f.X(me[0]) - 1, f.Y(me[1]) - 1, f.X(me[2]) - f.X(me[0]) + 2, f.Y(me[3]) - f.Y(me[1]) + 2, { fill: rgb('#e4572e') });
        // flecha: desde dónde se mira el alzado
        const mx = f.X((me[0] + me[2]) / 2);
        const my = f.Y((me[1] + me[3]) / 2);
        if (w.axis === 'x') pdf.polygon([[mx, my + 6], [mx - 4, my + 13], [mx + 4, my + 13]], { fill: GRAPHITE });
        else pdf.polygon([[mx - 6, my], [mx - 13, my - 4], [mx - 13, my + 4]], { fill: GRAPHITE });
    }
    pdf.text(kx, key.y + key.h + 12, 'Ubicación (en rojo) y desde dónde se mira', { size: 7, color: MUTED });

    // lista de piezas del muro
    let ty = key.y + key.h + 32;
    const line = (a, b, bold = false) => {
        if (ty > pdf.pageHeight - 40) return;
        pdf.text(kx, ty, a, { size: 8, bold });
        pdf.text(kx + colW, ty, b, { size: 8, bold, align: 'right' });
        ty += 12;
    };
    pdf.text(kx, ty, 'Piezas del muro', { size: 10, bold: true });
    ty += 14;
    line('Bloques enteros', int(w.whole));
    if (w.cuts.length) line('Bloques cortados', int(w.cuts.reduce((s2, [, n]) => s2 + n, 0)), true);
    for (const [l, n] of w.cuts) line(`   de ${cm(l)} cm`, `× ${n}`);
    if (w.uWhole || w.uCuts.length) line('Bloques U enteros', int(w.uWhole));
    if (w.uCuts.length) line('Bloques U cortados', int(w.uCuts.reduce((s2, [, n]) => s2 + n, 0)), true);
    for (const [l, n] of w.uCuts) line(`   de ${cm(l)} cm`, `× ${n}`);
    for (const g of gables) line('Hastial (bloques, cortes en diagonal)', `${int(g.blocks)} (${int(g.cutPieces)} cortados)`, true);
    line('Total de piezas', int(w.pieces + gables.reduce((a, g) => a + g.blocks, 0)), true);
    footer(pdf, project, pdf.pages.length);
}

function materialsPage(pdf, project, analysis) {
    const { bom } = analysis;
    pdf.addPage();
    let y = header(pdf, 'Lista de materiales', project.name);
    y = table(pdf, y, 'Bloques (total de obra)', [
        { title: 'Cód.', w: 40 },
        { title: 'Descripción', w: 325 },
        { title: 'A comprar', w: 70, align: 'right' },
        { title: 'Pallets', w: 80, align: 'right' },
    ], bom.total.blocks.map((b) => [b.code, b.label, int(b.order), `${b.pallets.full} + ${b.pallets.loose} u`]));
    const rest = bom.lines.filter((l) => !String(l.code ?? '').match(/^[BU]\d/));
    table(pdf, y + 10, 'Resto del cómputo', [
        { title: 'Descripción', w: 395 },
        { title: 'Cantidad', w: 120, align: 'right' },
    ], rest.map((l) => [l.desc, `${fmt(l.qty, Number.isInteger(l.qty) ? 0 : 2)} ${l.unit}`]));
    footer(pdf, project, pdf.pages.length);
}
