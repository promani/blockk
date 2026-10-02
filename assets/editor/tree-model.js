import { TREE_SIZES } from './site.js';

/*
 * Forma de los árboles: tronco, ramas y racimos de hojas en 3D (cm, con la base del tronco en el origen). Las ramas se
 * abren girando el ángulo áureo (137,5°, la filotaxis de Fibonacci) y los racimos se reparten sobre la copa como las
 * semillas de un girasol (espiral de Fibonacci sobre la esfera). Cada árbol tiene su propia variación, fija según su id.
 */

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Generador pseudoaleatorio con semilla (mulberry32): el mismo árbol se ve siempre igual. */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash(str) {
    let h = 2166136261;
    for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
}

const cache = new Map();

/**
 * @returns {{ size: object, branches: {a: number[], b: number[], w: number}[], leaves: {x: number, y: number, z: number, r: number, nx: number, ny: number, nz: number}[] }}
 */
export function treeModel(t) {
    const key = `${t.id}:${t.size}`;
    if (cache.has(key)) return cache.get(key);
    const d = TREE_SIZES[t.size] ?? TREE_SIZES.M;
    const rand = rng(hash(t.id));
    const zc = d.h - d.r; // centro de la copa
    const branches = [];
    const leaves = [];

    // Racimos de hojas: espiral de Fibonacci sobre una esfera algo achatada abajo, con un poco de desorden.
    const n = { S: 22, M: 34, L: 48 }[t.size] ?? 34;
    const rLeaf = d.r * (t.size === 'L' ? 0.26 : 0.3);
    for (let i = 0; i < n; i++) {
        const v = 1 - (2 * (i + 0.5)) / n; // -1 … 1 (abajo → arriba)
        if (v < -0.5) continue; // la panza de la copa queda abierta: ahí se ven las ramas
        const ring = Math.sqrt(1 - v * v);
        const a = i * GOLDEN;
        const k = 0.72 + rand() * 0.2;
        const nx = Math.cos(a) * ring;
        const ny = Math.sin(a) * ring;
        const nz = v;
        leaves.push({ x: nx * d.r * k, y: ny * d.r * k, z: zc + nz * d.r * k * (nz < 0 ? 0.75 : 0.95), r: rLeaf * (0.8 + rand() * 0.4), nx, ny, nz });
    }

    // Tronco y ramas: cada rama se abre en 2 o 3, rotando el ángulo áureo, y apunta a los racimos más cercanos.
    const top = [0, 0, d.trunkH];
    branches.push({ a: [0, 0, 0], b: top, w: d.trunk });
    // las puntas quedan adentro de la copa (las tapan las hojas): nada de ramas peladas asomando
    const inside = (p) => {
        const v = [p[0], p[1], (p[2] - zc) / 0.9];
        const dist = Math.hypot(...v);
        const max = d.r * 0.78;
        if (dist <= max) return p;
        return [(v[0] * max) / dist, (v[1] * max) / dist, zc + ((v[2] * max) / dist) * 0.9];
    };
    const grow = (from, dir, len, w, depth, turn) => {
        const to = inside([from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len]);
        branches.push({ a: from, b: to, w });
        if (depth === 0) return;
        const kids = depth > 1 ? 3 : 2;
        for (let i = 0; i < kids; i++) {
            const az = turn + i * GOLDEN * 2 + (rand() - 0.5) * 0.4;
            const tilt = 0.45 + rand() * 0.35; // apertura respecto de la rama madre
            const nd = [dir[0] * Math.cos(tilt) + Math.cos(az) * Math.sin(tilt), dir[1] * Math.cos(tilt) + Math.sin(az) * Math.sin(tilt), dir[2] * Math.cos(tilt) + 0.15];
            const m = Math.hypot(...nd);
            grow(to, nd.map((c) => c / m), len * (0.62 + rand() * 0.12), w * 0.6, depth - 1, az + GOLDEN);
        }
    };
    // ramas principales desde lo alto del tronco, una cada ángulo áureo
    const mains = { S: 3, M: 4, L: 5 }[t.size] ?? 4;
    const reach = d.h - d.trunkH - d.r * 0.35;
    for (let i = 0; i < mains; i++) {
        const az = i * GOLDEN + rand() * 0.5;
        const up = 0.62 + rand() * 0.2;
        const dir = [Math.cos(az) * Math.sqrt(1 - up * up), Math.sin(az) * Math.sqrt(1 - up * up), up];
        const start = [0, 0, d.trunkH - (i / mains) * d.trunkH * 0.25];
        grow(start, dir, reach * 0.5, d.trunk * 0.7, t.size === 'S' ? 1 : 2, az);
    }
    // el eje sigue hasta el centro de la copa
    branches.push({ a: top, b: [0, 0, zc + d.r * 0.2], w: d.trunk * 0.7 });

    const model = { size: d, branches, leaves };
    cache.set(key, model);
    return model;
}
