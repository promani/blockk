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
        // Los tirantes se dibujan hasta la cara interior de los muros (el apoyo queda dentro de la mampostería).
        const ix0 = f.rect.x + 10;
        const ix1 = f.rect.x + f.rect.w - 10;
        const iy0 = f.rect.y + 10;
        const iy1 = f.rect.y + f.rect.h - 10;
        for (const j of f.joists) {
            const horizontal = Math.abs(j.y1 - j.y2) < 0.01;
            // los tirantes de borde quedan dentro del muro: no se ven
            if (horizontal ? j.y1 - s.b / 2 < iy0 || j.y1 + s.b / 2 > iy1 : j.x1 - s.b / 2 < ix0 || j.x1 + s.b / 2 > ix1) continue;
            boxes.push({
                x0: horizontal ? Math.max(ix0, Math.min(j.x1, j.x2)) : j.x1 - s.b / 2,
                x1: horizontal ? Math.min(ix1, Math.max(j.x1, j.x2)) : j.x1 + s.b / 2,
                y0: horizontal ? j.y1 - s.b / 2 : Math.max(iy0, Math.min(j.y1, j.y2)),
                y1: horizontal ? j.y1 + s.b / 2 : Math.min(iy1, Math.max(j.y1, j.y2)),
                z0: top - 2 - s.d,
                z1: top - 2,
                zs: top - 2 - s.d,
                kind: KIND.JOIST,
                axis: horizontal ? 'x' : 'y',
                adjA: false,
                adjB: false,
                top: true,
                level: 1,
                field: f.id,
            });
        }
        // Placa de entrepiso: una sola pieza con el hueco de la escalera, retirada del eje hasta la cara interior de los muros,
        // con su cara superior al nivel del piso de arriba (así la escalera llega justo, sin escalón).
        boxes.push(plate(f.rect, f.deckHoles, top - 2, top, KIND.DECK, { field: f.id, deck: true }));
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
        // Losa: una sola placa con el hueco de la escalera; su cara superior es el piso del Nivel 2.
        boxes.push(plate(sl.rect, sl.holes, top - sl.thickness, top, KIND.SLAB, { slab: sl.id }));
    }

    return boxes;
}

/** Placa horizontal (losa o entrepiso) de una pieza, retirada 10 cm hasta la cara interior de los muros, con huecos. */
function plate(r, holes, z0, z1, kind, extra) {
    const inset = 10;
    return {
        x0: r.x + inset, x1: r.x + r.w - inset, y0: r.y + inset, y1: r.y + r.h - inset, z0, z1, zs: z0,
        kind, axis: 'x', adjA: false, adjB: false, top: true, level: 1, plate: true, holes: holes ?? [], ...extra,
    };
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
 * Orden de pintado: primero lo más bajo (por capas de igual cota) y, dentro de cada capa, lo que está detrás antes que lo que
 * está delante. «Detrás» se decide pieza contra pieza (orden topológico): ordenar sólo por la esquina mínima falla cuando una
 * pieza larga toca a una corta en una esquina, y la de atrás tapaba a la de adelante (faltaba una cara en las esquinas).
 */
export function sortedItems(scene, boxes, rot, cacheKey) {
    const key = `${cacheKey}:${rot}`;
    if (scene.sorted.has(key)) return scene.sorted.get(key);
    const all = boxes.map((b) => {
        const [x0, x1, y0, y1] = rotatedBounds(b, rot);
        return { b, x0, x1, y0, y1 };
    });
    all.sort((p, q) => p.b.zs - q.b.zs || p.x0 + p.y0 - (q.x0 + q.y0) || p.x0 - q.x0);
    const items = [];
    for (let i = 0; i < all.length;) {
        let j = i + 1;
        while (j < all.length && Math.abs(all[j].b.zs - all[i].b.zs) < 0.01) j++;
        for (const it of layerOrder(all.slice(i, j))) items.push(it);
        i = j;
    }
    scene.sorted.set(key, items);
    return items;
}

const EPS = 0.01;
/** ¿P queda detrás de Q (la cámara mira desde +x' +y')? Sólo para cajas de una misma capa que no se superponen. */
function behind(P, Q) {
    const ox = P.x0 < Q.x1 - EPS && Q.x0 < P.x1 - EPS;
    const oy = P.y0 < Q.y1 - EPS && Q.y0 < P.y1 - EPS;
    if (P.x1 <= Q.x0 + EPS && (oy || P.y1 <= Q.y0 + EPS)) return true;
    return P.y1 <= Q.y0 + EPS && (ox || P.x1 <= Q.x0 + EPS);
}

/** Orden topológico de una capa (vecinos por grilla), desempatando por la esquina mínima. */
function layerOrder(items) {
    const n = items.length;
    if (n < 2) return items;
    let tall = 0;
    for (const it of items) tall = Math.max(tall, it.b.z1 - it.b.z0);
    const margin = 2 * tall + 20; // sólo se pueden tapar en pantalla cajas cercanas
    const cell = Math.max(100, margin);
    const grid = new Map();
    const cellsOf = (it, m) => {
        const out = [];
        for (let gx = Math.floor((it.x0 - m) / cell); gx <= Math.floor((it.x1 + m) / cell); gx++) {
            for (let gy = Math.floor((it.y0 - m) / cell); gy <= Math.floor((it.y1 + m) / cell); gy++) out.push(`${gx},${gy}`);
        }
        return out;
    };
    items.forEach((it, idx) => {
        for (const c of cellsOf(it, 0)) {
            const list = grid.get(c);
            if (list) list.push(idx);
            else grid.set(c, [idx]);
        }
    });
    const indeg = new Int32Array(n);
    const next = Array.from({ length: n }, () => []);
    const seen = new Int32Array(n).fill(-1);
    for (let p = 0; p < n; p++) {
        const P = items[p];
        for (const c of cellsOf(P, margin)) {
            for (const q of grid.get(c) ?? []) {
                if (q <= p || seen[q] === p) continue;
                seen[q] = p;
                const Q = items[q];
                if (behind(P, Q)) { next[p].push(q); indeg[q]++; } else if (behind(Q, P)) { next[q].push(p); indeg[p]++; }
            }
        }
    }
    // Kahn con montículo: entre las cajas libres sale primero la de menor esquina (orden anterior = índice).
    const heap = [];
    const push = (v) => {
        heap.push(v);
        let i = heap.length - 1;
        while (i > 0) {
            const up = (i - 1) >> 1;
            if (heap[up] <= heap[i]) break;
            [heap[up], heap[i]] = [heap[i], heap[up]];
            i = up;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < heap.length && heap[l] < heap[m]) m = l;
                if (r < heap.length && heap[r] < heap[m]) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]];
                i = m;
            }
        }
        return top;
    };
    for (let i = 0; i < n; i++) if (!indeg[i]) push(i);
    const out = [];
    const done = new Uint8Array(n);
    while (heap.length) {
        const v = pop();
        done[v] = 1;
        out.push(items[v]);
        for (const w of next[v]) if (--indeg[w] === 0) push(w);
    }
    if (out.length < n) for (let i = 0; i < n; i++) if (!done[i]) out.push(items[i]); // ciclo (no debería ocurrir)
    return out;
}

