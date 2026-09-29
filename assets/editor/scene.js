/**
 * Convierte el despiece del servidor (hiladas → corridas → piezas) en una lista plana de cajas 3D
 * listas para dibujar, y resuelve el orden de pintado (algoritmo del pintor) para cada giro de vista.
 *
 * Códigos de pieza: 0 bloque · 1 bloque cortado · 2 bloque U · 3 U cortado.
 * Códigos adicionales de la escena: 4 hoja de puerta · 5 vidrio · 6 tirante · 7 placa de entrepiso · 8 viga.
 */

export const KIND = { BLOCK: 0, CUT: 1, U: 2, UCUT: 3, DOOR: 4, GLASS: 5, JOIST: 6, DECK: 7, BEAM: 8, STEP: 9, SLAB: 10, ROOF: 11 };

const G = 12.5;
const COURSE_H = 25;

export function buildScene(project, analysis, config) {
    const levels = [];
    for (let li = 0; li < project.levels.length; li++) {
        const base = li * config.levelHeight;
        const boxes = [];
        const courses = analysis.levels[li]?.courses ?? [];
        addMasonry(boxes, courses, base, li);
        addOpenings(boxes, project.levels[li], base, li, config);
        levels.push({ index: li, boxes, base, used: (analysis.levels[li]?.used ?? false) });
    }
    const timber = buildTimber(analysis.timber, config);
    const floors = buildFloors(analysis.floors, config);
    const roofs = buildRoofs(analysis.roof);
    const all = [...levels.flatMap((l) => l.boxes), ...timber.boxes, ...floors, ...roofs];
    return { levels, timber, all, sorted: new Map() };
}

function addMasonry(boxes, courses, base, li) {
    // Intervalos cubiertos por la hilada siguiente, para no dibujar caras superiores tapadas.
    const coverage = courses.map((runs) => {
        const map = new Map();
        for (const run of runs) {
            const key = `${run.axis}:${run.line}`;
            const list = map.get(key) ?? [];
            for (const p of run.pieces) list.push([p[0], p[1]]);
            map.set(key, list);
        }
        for (const [key, list] of map) {
            list.sort((a, b) => a[0] - b[0]);
            const merged = [];
            for (const iv of list) {
                const last = merged.at(-1);
                if (last && iv[0] <= last[1] + 0.01) last[1] = Math.max(last[1], iv[1]);
                else merged.push([iv[0], iv[1]]);
            }
            map.set(key, merged);
        }
        return map;
    });

    courses.forEach((runs, c) => {
        const z0 = base + c * COURSE_H;
        for (const run of runs) {
            const half = run.t / 2;
            const cover = coverage[c + 1]?.get(`${run.axis}:${run.line}`) ?? [];
            run.pieces.forEach((p, i) => {
                const [a, b, kind] = p;
                const horizontal = run.axis === 'x';
                boxes.push({
                    x0: horizontal ? a : run.line - half,
                    x1: horizontal ? b : run.line + half,
                    y0: horizontal ? run.line - half : a,
                    y1: horizontal ? run.line + half : b,
                    z0,
                    z1: z0 + COURSE_H,
                    zs: z0,
                    kind,
                    axis: run.axis,
                    adjA: i > 0 && Math.abs(run.pieces[i - 1][1] - a) < 0.01,
                    adjB: i < run.pieces.length - 1 && Math.abs(run.pieces[i + 1][0] - b) < 0.01,
                    top: !cover.some((iv) => iv[0] <= a + 0.01 && iv[1] >= b - 0.01),
                    level: li,
                    course: c,
                });
            });
        }
    });
}

function addOpenings(boxes, level, base, li, config) {
    for (const o of level.openings ?? []) {
        const w = level.walls.find((x) => x.id === o.wall);
        if (!w) continue;
        const horizontal = w.y1 === w.y2;
        const from = (horizontal ? w.x1 : w.y1) * G + o.pos * G;
        const len = o.w * G;
        const line = (horizontal ? w.y1 : w.x1) * G;
        const z0 = base + o.sill * COURSE_H;
        const z1 = base + (o.sill + o.h) * COURSE_H;
        const door = o.kind === 'door';
        const half = door ? 1.75 : 0.9;
        boxes.push({
            x0: horizontal ? from : line - half,
            x1: horizontal ? from + len : line + half,
            y0: horizontal ? line - half : from,
            y1: horizontal ? line + half : from + len,
            z0: door ? z0 : z0 + 2,
            z1: door ? z1 - 2 : z1 - 2,
            zs: z0,
            kind: door ? KIND.DOOR : KIND.GLASS,
            axis: horizontal ? 'x' : 'y',
            adjA: false,
            adjB: false,
            top: true,
            level: li,
            course: o.sill,
            opening: o.id,
        });
    }
}

function buildTimber(timber, config) {
    const boxes = [];
    if (!timber) return { boxes, fields: [] };
    const top = config.levelHeight;
    const dims = config.timberSections;
    for (const f of timber.fields ?? []) {
        const s = dims[f.section] ?? { b: 7.5, d: 20 };
        for (const j of f.joists) {
            const horizontal = Math.abs(j.y1 - j.y2) < 0.01;
            boxes.push({
                x0: horizontal ? Math.min(j.x1, j.x2) : j.x1 - s.b / 2,
                x1: horizontal ? Math.max(j.x1, j.x2) : j.x1 + s.b / 2,
                y0: horizontal ? j.y1 - s.b / 2 : Math.min(j.y1, j.y2),
                y1: horizontal ? j.y1 + s.b / 2 : Math.max(j.y1, j.y2),
                z0: top,
                z1: top + s.d,
                zs: top,
                kind: KIND.JOIST,
                axis: horizontal ? 'x' : 'y',
                adjA: false,
                adjB: false,
                top: true,
                level: 1,
                field: f.id,
            });
        }
        // Placa de entrepiso (sin los huecos de escalera), retirada del eje hasta la cara interior de los muros.
        const inset = 10;
        const r = f.rect;
        for (const part of f.deckParts ?? [{ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }]) {
            boxes.push({
                x0: part.x0 + (Math.abs(part.x0 - r.x) < 0.01 ? inset : 0),
                x1: part.x1 - (Math.abs(part.x1 - (r.x + r.w)) < 0.01 ? inset : 0),
                y0: part.y0 + (Math.abs(part.y0 - r.y) < 0.01 ? inset : 0),
                y1: part.y1 - (Math.abs(part.y1 - (r.y + r.h)) < 0.01 ? inset : 0),
                z0: top + s.d,
                z1: top + s.d + 2,
                zs: top,
                kind: KIND.DECK,
                axis: 'x',
                adjA: true,
                adjB: true,
                top: true,
                level: 1,
                field: f.id,
                deck: true,
            });
        }
    }
    for (const b of timber.beams ?? []) {
        const s = dims[b.section] ?? { b: 7.5, d: 25 };
        const horizontal = Math.abs(b.y1 - b.y2) < 0.01;
        boxes.push({
            x0: horizontal ? Math.min(b.x1, b.x2) : b.x1 - s.b / 2,
            x1: horizontal ? Math.max(b.x1, b.x2) : b.x1 + s.b / 2,
            y0: horizontal ? b.y1 - s.b / 2 : Math.min(b.y1, b.y2),
            y1: horizontal ? b.y1 + s.b / 2 : Math.max(b.y1, b.y2),
            z0: top,
            z1: top + s.d,
            zs: top,
            kind: KIND.BEAM,
            axis: horizontal ? 'x' : 'y',
            adjA: false,
            adjB: false,
            top: true,
            level: 1,
            beam: b.id,
        });
    }

    return { boxes, fields: timber.fields ?? [] };
}

/** Cada techo entra a la lista de cajas (su envolvente) para ordenarse junto con muros y pisos según la vista. */
function buildRoofs(roof) {
    const boxes = [];
    for (const part of roof?.parts ?? []) {
        const g = part.geometry;
        const o = g.overhang ?? 0;
        boxes.push({
            x0: g.rect.x0 - o, x1: g.rect.x1 + o, y0: g.rect.y0 - o, y1: g.rect.y1 + o,
            z0: g.zTop, z1: g.zTop + (g.riseCm ?? 0), zs: g.zTop,
            kind: KIND.ROOF, axis: 'x', adjA: false, adjB: false, top: true, level: 2, roof: part,
        });
    }

    return boxes;
}

/** Peldaños y descansos de escaleras (nivel 0) y losas de piso (nivel 1). */
function buildFloors(floors, config) {
    const boxes = [];
    const base = (o) => ({ axis: 'x', adjA: true, adjB: true, top: true, ...o });
    for (const st of floors?.stairs ?? []) {
        for (const p of st.steps) boxes.push(base({ x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, z0: p.z - st.riseCm, z1: p.z, zs: p.z - st.riseCm, kind: KIND.STEP, level: 0, stair: st.id }));
        for (const p of st.landings) boxes.push(base({ x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, z0: p.z - 12, z1: p.z, zs: p.z - 12, kind: KIND.STEP, level: 0, stair: st.id }));
    }
    const top = config.levelHeight;
    for (const sl of floors?.slabs ?? []) {
        const r = sl.rect;
        const inset = 10;
        for (const part of sl.parts) {
            boxes.push(base({
                x0: part.x0 + (Math.abs(part.x0 - r.x) < 0.01 ? inset : 0),
                x1: part.x1 - (Math.abs(part.x1 - (r.x + r.w)) < 0.01 ? inset : 0),
                y0: part.y0 + (Math.abs(part.y0 - r.y) < 0.01 ? inset : 0),
                y1: part.y1 - (Math.abs(part.y1 - (r.y + r.h)) < 0.01 ? inset : 0),
                z0: top,
                z1: top + sl.thickness,
                zs: top,
                kind: KIND.SLAB,
                level: 1,
                slab: sl.id,
            }));
        }
    }

    return boxes;
}

/** Caja rotada al marco de la vista: [x0', x1', y0', y1'] tras girar `rot` × 90° alrededor del origen. */
export function rotatedBounds(b, rot) {
    switch (rot & 3) {
        case 0: return [b.x0, b.x1, b.y0, b.y1];
        case 1: return [-b.y1, -b.y0, b.x0, b.x1];
        case 2: return [-b.x1, -b.x0, -b.y1, -b.y0];
        default: return [b.y0, b.y1, -b.x1, -b.x0];
    }
}

/** Caras verticales que ve la cámara según el giro: +x' y +y' del marco girado. */
export function visibleFaces(rot) {
    return {
        xp: [{ a: 'x', max: true }, { a: 'y', max: false }, { a: 'x', max: false }, { a: 'y', max: true }][rot & 3],
        yp: [{ a: 'y', max: true }, { a: 'x', max: true }, { a: 'y', max: false }, { a: 'x', max: false }][rot & 3],
    };
}

/**
 * Orden de pintado: primero lo más bajo, luego lo más lejano de la cámara (menor x'+y' tras girar).
 * Para cajas alineadas a una retícula esto reproduce la oclusión correcta de un modelo de muros.
 */
export function sortedItems(scene, boxes, rot, cacheKey) {
    const key = `${cacheKey}:${rot}`;
    if (scene.sorted.has(key)) return scene.sorted.get(key);
    const items = boxes.map((b) => {
        const [x0, x1, y0, y1] = rotatedBounds(b, rot);
        return { b, x0, x1, y0, y1 };
    });
    items.sort((p, q) => (p.b.zs !== q.b.zs ? p.b.zs - q.b.zs : p.x0 + p.y0 - (q.x0 + q.y0) || p.x0 - q.x0));
    scene.sorted.set(key, items);
    return items;
}

