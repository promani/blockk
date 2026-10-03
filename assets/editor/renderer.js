/**
 * Dibujo del lienzo (Canvas 2D). Dos vistas con el mismo modelo:
 *  - isométrica 30°/30°, con oclusión por algoritmo del pintor sobre cajas de cada pieza;
 *  - planta cenital 2D con simbología de puertas y ventanas y rótulos de ambientes.
 * El dibujo es bajo demanda (rAF sólo cuando hay cambios): 60 FPS sin GPU dedicada.
 */
import { Camera } from './camera.js';
import { KIND, sortedItems, visibleFaces } from './scene.js';
import { fmt } from '../lib/format.js';
import { drawTheme, mix } from '../lib/theme.js';
import { planeEq, planeHoles, gableHoles, withHoles } from './roofclip.js';
import { ZONE_KINDS, TREE_SIZES, zoneLabel } from './site.js';
import { treeModel } from './tree-model.js';
import { backEdge, furnitureOn, treesOn } from './furniture.js';

const G = 12.5;

/** Frente del terreno, desde la línea del lote hacia afuera: vereda de baldosas, franja de pasto y calzada (cm). */
const STREET = { walk: 125, verge: 325, road: 700 };

/** Opacidad del repaso de un árbol sobre lo que tapa: las ramas se insinúan y las hojas casi no tapan (se enciman muchas). */
const BRANCH_OVER = 0.45;
const LEAF_OVER = 0.12;

/** Colores de piso por ambiente (del tema): el mismo ambiente conserva su color al editar. */
export const roomColor = (room) => {
    const floors = drawTheme().floors;
    return floors[(room.id - 1) % floors.length];
};

function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Caras de cada tipo de caja (tapa, frente y costado sombreados) a partir de los colores del tema. */
let paletteFor = null;
let palette = null;
function PAL() {
    const t = drawTheme();
    if (paletteFor === t) return palette;
    const base = {
        [KIND.BLOCK]: t.block,
        [KIND.CUT]: t.cut,
        [KIND.U]: t.u,
        [KIND.UCUT]: mix(t.u, '#ffffff', 0.35),
        [KIND.DOOR]: t.door,
        [KIND.GLASS]: t.glass,
        [KIND.FRAME]: '#f7f8fa',
        [KIND.JOIST]: t.wood,
        [KIND.DECK]: mix(t.wood, '#ffffff', 0.45),
        [KIND.BEAM]: mix(t.wood, '#000000', 0.12),
        [KIND.STEP]: mix(t.slab, '#ffffff', 0.5),
        [KIND.SLAB]: t.slab,
        [KIND.COLUMN]: mix(t.slab, '#000000', 0.18),
        [KIND.FURNITURE]: '#b9c4d4', // neutro y distinto del bloque: un mueble es un gabarito, no decoración
    };
    palette = Object.fromEntries(Object.entries(base).map(([k, hex]) => [k, { top: shade(hex, 1.03), yp: shade(hex, 0.88), xp: shade(hex, 0.74) }]));
    paletteFor = t;
    return palette;
}

/** Debajo de esta superficie el rótulo del ambiente lleva sólo el nombre. */
const SMALL_ROOM_M2 = 4;

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = 1;
        this.shadow = document.createElement('canvas');
        this.shadowCtx = this.shadow.getContext('2d');
        // Capa estática (suelo + modelo + sombras): sólo se redibuja si cambia la cámara o el modelo,
        // no con cada movimiento del mouse (previews de herramientas, resaltes).
        this.layer = document.createElement('canvas');
        this.layerCtx = this.layer.getContext('2d');
        this.layerKey = '';
    }

    resize(w, h, dpr) {
        this.dpr = dpr;
        this.layerKey = '';
        for (const c of [this.canvas, this.shadow, this.layer]) {
            c.width = Math.round(w * dpr);
            c.height = Math.round(h * dpr);
        }
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
    }

    /** f: { cam, project, analysis, scene, ui, sun, sceneKey, overlay(ctx, cam) } */
    draw(f) {
        const { dpr } = this;
        const { cam } = f;
        const key = `${f.sceneKey}|${cam.cx.toFixed(3)}|${cam.cy.toFixed(3)}|${cam.zoom.toFixed(5)}|${cam.view}|${cam.rot}|${cam.w}|${cam.h}|${dpr}`;
        if (key !== this.layerKey || !f.sceneKey) {
            const main = this.ctx;
            this.ctx = this.layerCtx;
            this.drawStatic(f);
            this.ctx = main;
            this.layerKey = key;
        }
        const { ctx } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.layer, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        f.overlay?.(ctx, cam);
        this.drawCompass(f);
    }

    drawStatic(f) {
        this.frame = f;
        const { ctx, dpr } = this;
        const { cam } = f;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cam.w, cam.h);
        // Con el terreno a la vista, lo de afuera del lote es del mismo color, con pasto; sin terreno, el fondo liso.
        const showLot = f.ui?.showLot !== false;
        ctx.fillStyle = showLot ? drawTheme().ground : drawTheme().sky;
        ctx.fillRect(0, 0, cam.w, cam.h);
        if (showLot) this.drawGrass(f);
        if (showLot && f.project) this.drawStreet(f);
        this.drawGround(f);
        this.drawBackdrop(f);
        if (f.project) {
            this.drawZones(f);
            if (cam.view === 'plan') this.drawPlan(f);
            else this.drawIso(f);
        }
    }

    // ---------- terreno: zonas y árboles ----------
    /** Zonas del terreno (pileta, patio, jardín, camino): superficies planas sobre el suelo. */
    drawZones(f) {
        const { ctx } = this;
        const { cam, project, ui } = f;
        for (const z of project.zones ?? []) {
            const st = ZONE_KINDS[z.kind] ?? ZONE_KINDS.patio;
            const quad = (inset) => [[z.x * G + inset, z.y * G + inset], [(z.x + z.w) * G - inset, z.y * G + inset], [(z.x + z.w) * G - inset, (z.y + z.h) * G - inset], [z.x * G + inset, (z.y + z.h) * G - inset]].map(([x, y]) => cam.project(x, y, 0.4));
            const path = (pts) => {
                ctx.beginPath();
                pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.closePath();
            };
            path(quad(0));
            ctx.fillStyle = st.fill;
            ctx.fill();
            const picked = ui?.selection?.type === 'zone' && ui.selection.id === z.id;
            ctx.strokeStyle = picked ? '#2563eb' : st.stroke;
            ctx.lineWidth = picked ? 2.5 : 1.4;
            ctx.stroke();
            // borde interior: el coronamiento de la pileta, la guarda del deck
            if (z.w * G > 80 && z.h * G > 80) {
                path(quad(z.kind === 'pool' ? 22 : 12));
                ctx.strokeStyle = st.inner;
                ctx.lineWidth = z.kind === 'pool' ? 2 : 1;
                ctx.stroke();
            }
        }
    }

    /** Nombres de las zonas en la planta. */
    drawZoneLabels(f) {
        const { ctx } = this;
        const { cam, project } = f;
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const z of project.zones ?? []) {
            // arriba y al centro: una zona dentro de otra (pileta en el deck) no tapa el nombre de la grande
            const [sx, sy0] = cam.project((z.x + z.w / 2) * G, z.y * G, 0);
            const sy = sy0 + 14;
            this.tag(ctx, zoneLabel(z), sx, sy, f.ui?.selection?.type === 'zone' && f.ui.selection.id === z.id);
        }
    }

    /**
     * Árbol en la isométrica: tronco, ramas y racimos de hojas (ver tree-model.js), de atrás hacia adelante para que las
     * ramas se vean entre los huecos de la copa. La sombra va aparte (drawTreeShadows), con el sol.
     */
    drawTree(ctx, cam, b, leafAlpha = 1) {
        const t = { id: b.tree, size: b.treeSize };
        const m = treeModel(t);
        const ox = (b.x0 + b.x1) / 2;
        const oy = (b.y0 + b.y1) / 2;
        const P = (p) => cam.project(ox + p[0], oy + p[1], p[2]);
        const depth = (p) => cam.project(ox + p[0], oy + p[1], 0)[1];
        const unit = cam.zoom;
        const picked = this.frame?.ui?.selection?.type === 'tree' && this.frame.ui.selection.id === b.tree;
        const items = [
            ...m.branches.map((br) => ({ d: depth([(br.a[0] + br.b[0]) / 2, (br.a[1] + br.b[1]) / 2]), br })),
            ...m.leaves.map((lf) => ({ d: depth([lf.x, lf.y]) + lf.z * 0.001, lf })),
        ].sort((p, q) => p.d - q.d);
        ctx.save();
        ctx.lineCap = 'round';
        // la luz viene de arriba a la izquierda de la pantalla
        for (const it of items) {
            if (it.br) {
                const [ax, ay] = P(it.br.a);
                const [bx, by] = P(it.br.b);
                ctx.strokeStyle = '#6b4a2b';
                ctx.lineWidth = Math.max(1, it.br.w * 2 * unit);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
                continue;
            }
            const lf = it.lf;
            const [sx, sy] = P([lf.x, lf.y, lf.z]);
            const rpx = Math.max(1.5, lf.r * unit);
            const light = Math.max(0, Math.min(1, 0.55 + lf.nz * 0.35 + (it.d - depth([0, 0])) / (m.size.r * unit * 6)));
            if (leafAlpha < 1) ctx.globalAlpha = leafAlpha;
            leafCluster(ctx, sx, sy, rpx, light, picked);
            if (leafAlpha < 1) ctx.globalAlpha = BRANCH_OVER;
        }
        ctx.restore();
    }

    /**
     * Árboles delante de la casa. El pintor los dibuja en la capa del suelo y las hiladas de más arriba los tapan aunque
     * estén detrás: acá se repasan traslúcidos sobre lo que tienen detrás (la casa se sigue viendo a través) y, recortado
     * a la silueta del árbol (copa y tronco), se vuelve a pintar lo que está delante de ellos.
     */
    drawTreesOver(ctx, cam, trees, drawn, strokeOn) {
        for (const t of trees) {
            const d = TREE_SIZES[t.b.treeSize] ?? TREE_SIZES.M;
            const ox = (t.b.x0 + t.b.x1) / 2;
            const oy = (t.b.y0 + t.b.y1) / 2;
            const cx = (t.x0 + t.x1) / 2;
            const cy = (t.y0 + t.y1) / 2;
            // En pantalla la x sale de x' − y' (marco girado): sólo importa lo que cae en la franja de la copa.
            const reach = (t.x1 - t.x0) * 0.9;
            const front = [];
            const back = [];
            for (const it of drawn) {
                if (it.x1 - it.y0 < cx - cy - reach || it.x0 - it.y1 > cx - cy + reach) continue;
                if ((cx <= it.x0 + 0.01 && cy < it.y1) || (cy <= it.y0 + 0.01 && cx < it.x1)) front.push(it);
                else if (it.b.zs > 0.5) back.push(it.b); // lo de la capa del suelo se pinta antes que el árbol: no lo tapa
            }
            if (!back.length) continue;
            const [sx, sy] = cam.project(ox, oy, d.h - d.r);
            const [bx, by] = cam.project(ox, oy, 0);
            const lw = Math.max(2, d.trunk * 2 * cam.zoom) + 2;
            ctx.save();
            ctx.beginPath();
            ctx.arc(sx, sy, d.r * cam.zoom * 1.25, 0, Math.PI * 2);
            ctx.rect(bx - lw / 2, sy, lw, by - sy + 2);
            ctx.clip();
            // El repaso va sólo sobre lo que tapó al árbol: fuera de ahí el árbol ya está pintado, opaco.
            ctx.save();
            ctx.beginPath();
            for (const b of back) {
                const hull = convexHull([b.z0, b.z1].flatMap((z) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => cam.project(x, y, z))));
                hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.closePath();
            }
            ctx.clip();
            ctx.globalAlpha = BRANCH_OVER;
            this.drawTree(ctx, cam, t.b, LEAF_OVER);
            ctx.restore();
            for (const it of front) this.drawBox(ctx, cam, it, strokeOn);
            ctx.restore();
        }
    }

    /** Árboles en planta (vistos desde arriba): ramas y racimos translúcidos, los más altos encima. */
    drawPlanTrees(f) {
        const { ctx } = this;
        const { cam, project, ui } = f;
        if (!treesOn(ui)) return;
        for (const t of project.trees ?? []) {
            const m = treeModel(t);
            const ox = t.x * G;
            const oy = t.y * G;
            const picked = ui?.selection?.type === 'tree' && ui.selection.id === t.id;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.strokeStyle = '#6b4a2b';
            for (const br of m.branches) {
                const [ax, ay] = cam.project(ox + br.a[0], oy + br.a[1], 0);
                const [bx, by] = cam.project(ox + br.b[0], oy + br.b[1], 0);
                ctx.lineWidth = Math.max(1, br.w * 2 * cam.zoom);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
            }
            ctx.globalAlpha = 0.8;
            for (const lf of [...m.leaves].sort((p, q) => p.z - q.z)) {
                const [sx, sy] = cam.project(ox + lf.x, oy + lf.y, 0);
                leafCluster(ctx, sx, sy, Math.max(1.5, lf.r * cam.zoom), 0.45 + lf.nz * 0.45, false);
            }
            ctx.globalAlpha = 1;
            const [cx, cy] = cam.project(ox, oy, 0);
            if (picked) {
                ctx.strokeStyle = '#2563eb';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.arc(cx, cy, m.size.r * cam.zoom, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    /**
     * Sombra de los árboles con el sol: cada rama y cada racimo de hojas proyectado al suelo. Es una sombra parcial (la
     * luz pasa entre las hojas): se pinta rayada y más clara que la de la casa.
     */
    drawTreeShadows(f) {
        const { cam, project, ui, sun } = f;
        if (!project.trees?.length || !treesOn(ui) || !sun || !ui?.solar?.show || sun.alt < 3) return;
        const disp = this.sunDisp(project, sun);
        this.treeShadow ??= document.createElement('canvas');
        const c = this.treeShadow;
        if (c.width !== this.shadow.width || c.height !== this.shadow.height) [c.width, c.height] = [this.shadow.width, this.shadow.height];
        const sctx = c.getContext('2d');
        sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        sctx.globalCompositeOperation = 'source-over';
        sctx.clearRect(0, 0, cam.w, cam.h);
        sctx.fillStyle = '#000';
        sctx.strokeStyle = '#000';
        sctx.lineCap = 'round';
        const ground = (x, y, z) => {
            const o = disp(z);
            return cam.project(x + o[0], y + o[1], 0);
        };
        for (const t of project.trees) {
            const m = treeModel(t);
            const ox = t.x * G;
            const oy = t.y * G;
            for (const br of m.branches) {
                const [ax, ay] = ground(ox + br.a[0], oy + br.a[1], br.a[2]);
                const [bx, by] = ground(ox + br.b[0], oy + br.b[1], br.b[2]);
                sctx.lineWidth = Math.max(1, br.w * 2 * cam.zoom);
                sctx.beginPath();
                sctx.moveTo(ax, ay);
                sctx.lineTo(bx, by);
                sctx.stroke();
            }
            // la sombra de una esfera es una elipse estirada hacia donde va la luz: casco de tres anillos
            for (const lf of m.leaves) {
                const pts = [];
                for (let i = 0; i < 10; i++) {
                    const a = (i / 10) * Math.PI * 2;
                    for (const dz of [-0.7, 0, 0.7]) {
                        const rr = lf.r * 0.85 * Math.sqrt(1 - dz * dz);
                        pts.push(ground(ox + lf.x + rr * Math.cos(a), oy + lf.y + rr * Math.sin(a), lf.z + dz * lf.r * 0.85));
                    }
                }
                const hull = convexHull(pts);
                sctx.beginPath();
                hull.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)));
                sctx.closePath();
                sctx.fill();
            }
        }
        // rayado: se recorta la máscara con un patrón de franjas diagonales
        sctx.globalCompositeOperation = 'source-in';
        sctx.fillStyle = this.stripes(sctx);
        sctx.fillRect(0, 0, cam.w, cam.h);
        sctx.globalCompositeOperation = 'source-over';
        const { ctx } = this;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.3;
        ctx.drawImage(c, 0, 0);
        ctx.restore();
    }

    /** Patrón de franjas diagonales para las sombras parciales. */
    stripes(ctx) {
        if (!this.stripeTile) {
            const s = 8;
            const tile = document.createElement('canvas');
            tile.width = s;
            tile.height = s;
            const g = tile.getContext('2d');
            g.fillStyle = 'rgba(15,23,42,.35)';
            g.fillRect(0, 0, s, s);
            g.strokeStyle = '#0f172a';
            g.lineWidth = 2.6;
            g.beginPath();
            for (const o of [-s, 0, s]) {
                g.moveTo(o, s);
                g.lineTo(o + s, 0);
            }
            g.stroke();
            this.stripeTile = tile;
        }
        return ctx.createPattern(this.stripeTile, 'repeat');
    }

    // ---------- suelo, retícula ----------
    drawGround(f) {
        const { ctx } = this;
        const { cam, project, ui } = f;
        const showLot = ui?.showLot !== false;
        const showGrid = ui?.showGrid !== false;
        if (!showLot && !showGrid) return;
        const W = (project?.lot?.w ?? 24) * 100;
        const D = (project?.lot?.d ?? 20) * 100;
        const z = 0;
        const corners = [[0, 0], [W, 0], [W, D], [0, D]].map(([x, y]) => cam.project(x, y, z));
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        if (showLot) {
            ctx.fillStyle = drawTheme().ground;
            ctx.fill();
        }
        if (showGrid) this.drawGrid(cam, W, D, z);
        if (!showLot) return;
        ctx.strokeStyle = 'rgba(30,41,59,.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
    }

    /**
     * Plano de fondo (`ui.backdrop`, sólo en el editor): la imagen apoyada en el suelo, sobre el terreno y debajo del
     * dibujo. En las dos vistas el suelo se proyecta con una transformación afín, así que alcanza con tres esquinas.
     */
    drawBackdrop(f) {
        const b = f.ui?.backdrop;
        if (!b?.img || b.visible === false) return;
        const { ctx, dpr } = this;
        const { cam } = f;
        const w = b.img.naturalWidth;
        const h = b.img.naturalHeight;
        const o = cam.project(b.x, b.y, 0);
        const px = cam.project(b.x + w * b.cmPerPx, b.y, 0);
        const py = cam.project(b.x, b.y + h * b.cmPerPx, 0);
        ctx.save();
        ctx.globalAlpha = b.opacity;
        ctx.setTransform((dpr * (px[0] - o[0])) / w, (dpr * (px[1] - o[1])) / w, (dpr * (py[0] - o[0])) / h, (dpr * (py[1] - o[1])) / h, dpr * o[0], dpr * o[1]);
        ctx.drawImage(b.img, 0, 0);
        ctx.restore();
    }

    /**
     * Pasto alrededor del lote: matas de tres briznas repartidas sobre el suelo. Van ancladas al mundo (se mueven con la
     * vista) y siempre en el mismo lugar: la posición sale de un hash de la celda. Al alejar la vista las celdas se
     * agrandan, así hay una mata cada ~36 px y no una mancha. Las que caen dentro del lote las tapa el terreno.
     */
    drawGrass(f) {
        const { ctx } = this;
        const { cam } = f;
        const ground = drawTheme().ground;
        let cell = 120;
        while (cell * cam.zoom < 36) cell *= 2;
        const corners = [[0, 0], [cam.w, 0], [cam.w, cam.h], [0, cam.h]].map(([x, y]) => cam.unproject(x, y, 0));
        const i0 = Math.floor(Math.min(...corners.map((c) => c[0])) / cell);
        const i1 = Math.ceil(Math.max(...corners.map((c) => c[0])) / cell);
        const j0 = Math.floor(Math.min(...corners.map((c) => c[1])) / cell);
        const j1 = Math.ceil(Math.max(...corners.map((c) => c[1])) / cell);
        // dos tonos: las matas oscuras dan el dibujo y las claras, algo de variación
        const paths = [new window.Path2D(), new window.Path2D()];
        for (let i = i0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) {
                let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(cell, 83492791)) >>> 0;
                const rnd = () => {
                    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
                    return (h >>> 8) / 16777216;
                };
                const [sx, sy] = cam.project((i + rnd()) * cell, (j + rnd()) * cell, 0);
                if (sx < -12 || sy < -12 || sx > cam.w + 12 || sy > cam.h + 12) continue;
                const size = 5 + rnd() * 4;
                const path = paths[rnd() < 0.3 ? 1 : 0];
                for (const k of [-1, 0, 1]) {
                    path.moveTo(sx + k * 1.2, sy);
                    path.lineTo(sx + k * size * 0.55, sy - size * (1 - Math.abs(k) * 0.3));
                }
            }
        }
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = mix(ground, '#1f5a1c', 0.42);
        ctx.stroke(paths[0]);
        ctx.strokeStyle = mix(ground, '#ffffff', 0.38);
        ctx.stroke(paths[1]);
        ctx.restore();
    }

    /**
     * Calle y vereda sobre el frente del terreno (`lot.front`, un lado de la planta): del lado de afuera, la vereda
     * pegada a la línea del lote, una franja de pasto y la calzada, que sigue hasta donde alcanza la vista. Sólo indican hacia dónde da el frente: no entran al cómputo.
     */
    drawStreet(f) {
        const { ctx } = this;
        const { cam, project } = f;
        const W = (project.lot?.w ?? 24) * 100;
        const D = (project.lot?.d ?? 20) * 100;
        const side = project.lot?.front ?? 'S';
        const across = side === 'N' || side === 'S'; // la calle corre a lo ancho (eje x)
        const len = across ? W : D;
        const edge = side === 'S' ? D : side === 'E' ? W : 0;
        const out = side === 'S' || side === 'E' ? 1 : -1;
        // la calle no termina: va de borde a borde de la pantalla (arranca en un múltiplo del paso de las rayas, así no bailan al mover la vista)
        const us = [[0, 0], [cam.w, 0], [cam.w, cam.h], [0, cam.h]].map(([x, y]) => cam.unproject(x, y, 0)[across ? 0 : 1]);
        const u0 = Math.floor(Math.min(...us) / 600) * 600 - 600;
        const u1 = Math.max(...us) + 600;
        const road = STREET.walk + STREET.verge;
        // (u a lo largo de la calle, v hacia afuera desde la línea del frente) → pantalla
        const P = (u, v) => (across ? cam.project(u, edge + out * v, 0) : cam.project(edge + out * v, u, 0));
        const band = (v0, v1, color) => {
            ctx.beginPath();
            [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        };
        const line = (u0, v0, u1, v1) => {
            const [ax, ay] = P(u0, v0);
            const [bx, by] = P(u1, v1);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
        };
        const k = Math.hypot(P(100, 0)[0] - P(0, 0)[0], P(100, 0)[1] - P(0, 0)[1]) / 100; // px por cm a lo largo
        ctx.save();
        band(0, STREET.walk, '#d8d9dc');
        band(road, road + STREET.road, '#7d828c');
        // baldosas de la vereda (juntas cada 62,5 cm) y cordón
        if (62.5 * k >= 5) {
            ctx.strokeStyle = 'rgba(30,41,59,.16)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let u = u0; u <= u1; u += 62.5) line(u, 0, u, STREET.walk);
            line(u0, STREET.walk / 2, u1, STREET.walk / 2);
            ctx.stroke();
        }
        ctx.strokeStyle = '#f3f4f6';
        ctx.lineWidth = Math.max(1.5, 12 * k);
        ctx.beginPath();
        line(u0, road, u1, road);
        ctx.stroke();
        // eje de la calzada, discontinuo
        ctx.strokeStyle = 'rgba(255,255,255,.8)';
        ctx.lineWidth = Math.max(1, 10 * k);
        ctx.setLineDash([300 * k, 300 * k]);
        ctx.beginPath();
        line(u0, road + STREET.road / 2, u1, road + STREET.road / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (cam.view === 'plan') {
            const [sx, sy] = P(len / 2, road + STREET.road / 2);
            ctx.font = '600 12px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            this.tag(ctx, 'Calle', sx, sy);
        }
        ctx.restore();
    }

    drawGrid(cam, W, D, z) {
        const { ctx } = this;
        // Retícula simple: una línea por metro (tenue) y una más marcada cada 5 m. El ajuste real (12,5 cm o el bloque) se ve como
        // puntos alrededor del cursor cuando se dibuja.
        ctx.lineWidth = 1;
        if (100 * cam.zoom * (cam.view === 'plan' ? 1 : 0.87) >= 8) {
            ctx.strokeStyle = 'rgba(30,41,59,.10)';
            ctx.beginPath();
            for (let x = 0; x <= W + 0.1; x += 100) if (x % 500) this.seg(cam, x, 0, x, D, z);
            for (let y = 0; y <= D + 0.1; y += 100) if (y % 500) this.seg(cam, 0, y, W, y, z);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(30,41,59,.26)';
        ctx.beginPath();
        for (let x = 0; x <= W + 0.1; x += 500) this.seg(cam, x, 0, x, D, z);
        for (let y = 0; y <= D + 0.1; y += 500) this.seg(cam, 0, y, W, y, z);
        ctx.stroke();
    }

    seg(cam, x0, y0, x1, y1, z) {
        const a = cam.project(x0, y0, z);
        const b = cam.project(x1, y1, z);
        this.ctx.moveTo(a[0], a[1]);
        this.ctx.lineTo(b[0], b[1]);
    }

    // ---------- isométrica ----------
    drawIso(f) {
        const { ctx } = this;
        const { cam, scene, ui } = f;
        if (!scene) return;
        if (f.sun && ui.solar.show) this.drawShadows(f);

        // Sobre el nivel activo se puede recortar la vista para ver los ambientes.
        const activeLevel = ui.level;
        const strokeOn = cam.zoom > 0.085;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = 'rgba(30,41,59,.30)';

        const list = sortedItems(scene, scene.all, cam.rot, 'all');
        const margin = 40;
        const trees = [];
        const drawn = [];
        this.drawRoomFloors(f, 0, 0);
        let upperFloors = f.project.upper && activeLevel >= 1;
        for (const it of list) {
            const b = it.b;
            if (b.level > activeLevel) continue;
            if ((b.kind === KIND.TREE && !treesOn(ui)) || (b.kind === KIND.FURNITURE && !furnitureOn(ui))) continue;
            if (upperFloors && b.zs >= 300) {
                upperFloors = false;
                this.drawRoomFloors(f, 1, 300);
            }
            // Descarte de cajas fuera de la pantalla (proyectos grandes con zoom cercano).
            const [px, py] = cam.project((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
            const reach = (Math.max(b.x1 - b.x0, b.y1 - b.y0) + (b.z1 - b.z0)) * cam.zoom;
            if (px + reach < -margin || px - reach > cam.w + margin || py + reach < -margin || py - reach > cam.h + margin) continue;
            if (b.level === activeLevel && b.course !== undefined && b.kind <= KIND.UCUT && ui.cut < 12 && b.course >= ui.cut) continue;
            if (b.opening) {
                if (b.level === activeLevel && ui.cut < 12 && b.course >= ui.cut) continue;
            }
            (b.kind === KIND.TREE ? trees : drawn).push(it);
            this.drawBox(ctx, cam, it, strokeOn);
        }
        if (upperFloors) this.drawRoomFloors(f, 1, 300);
        if (trees.length) this.drawTreesOver(ctx, cam, trees, drawn, strokeOn);
    }

    /** Piso de color de cada ambiente cerrado del nivel `li`, a la cota `z`. */
    drawRoomFloors(f, li, z) {
        const { ctx } = this;
        const { cam, analysis } = f;
        const stairHoles = li === 1 ? (analysis.floors?.stairs ?? []).flatMap((st) => [...st.steps, ...st.landings].map((q) => ({ x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1 }))) : [];
        ctx.save();
        // En el Nivel 2 el hueco de la escalera no lleva piso: se recorta una sola vez para todos los ambientes (si cada
        // ambiente sumara el hueco a su contorno, uno que no lo contiene lo pintaría de su color).
        if (stairHoles.length) {
            ctx.beginPath();
            ctx.rect(-1e5, -1e5, 2e5, 2e5);
            for (const hl of stairHoles) {
                [[hl.x0, hl.y0], [hl.x1, hl.y0], [hl.x1, hl.y1], [hl.x0, hl.y1]].map(([a, b]) => cam.project(a, b, z)).forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
                ctx.closePath();
            }
            ctx.clip('evenodd');
        }
        for (const room of analysis.levels[li]?.rooms ?? []) {
            if (!room.fill?.length) continue;
            const color = roomColor(room);
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            for (const [x, y, w, h] of room.fill) {
                const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => cam.project(a * G, b * G, z));
                pts.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
                ctx.closePath();
            }
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Un techo: hastiales de bloque, faldones (del más lejano al más cercano), cabios y cumbrera. */
    drawRoofPart(f, part) {
        const { ctx } = this;
        const { cam } = f;
        const g = part.geometry;
        const parts = f.analysis.roof?.parts ?? [];
        const idx = parts.indexOf(part);
        // Huecos de un faldón (lo que queda debajo de otro techo más alto), llevados a pantalla sobre el mismo faldón.
        const holesOf = (eq) => planeHoles(parts, idx, eq).map((hp) => hp.map(([x, y]) => cam.project(x, y, eq[0] * x + eq[1] * y + eq[2])));
        const P = (pt) => cam.project(pt[0], pt[1], pt[2]);
        const poly = (pts, fill, stroke) => {
            ctx.beginPath();
            pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.stroke();
        };
        // Hastiales primero: los aleros de los faldones los tapan en parte (como en la realidad).
        const cx = (g.rect.x0 + g.rect.x1) / 2;
        const cy = (g.rect.y0 + g.rect.y1) / 2;
        for (const gb of g.gables ?? []) {
            if (!gb.enabled || !gb.plane) continue;
            // El hastial se dibuja en la cara exterior del muro (no en su eje), así tapa el coronamiento como en obra.
            const { axis, at } = gb.plane;
            const d = Math.min(gb.thickness / 2, g.overhang ?? 0) * Math.sign(at - (axis === 'y' ? cx : cy));
            const pts = gb.pts.map(([x, y, z]) => (axis === 'y' ? [x + d, y, z] : [x, y + d, z]));
            const holes = gableHoles(parts, idx, axis, at).map((hp) => hp.map(([u, z]) => (axis === 'y' ? cam.project(at + d, u, z) : cam.project(u, at + d, z))));
            withHoles(ctx, holes, () => this.drawGable(ctx, cam, { ...gb, pts, plane: { ...gb.plane, at: at + d } }, poly));
        }
        // Faldones opacos del más lejano al más cercano, sombreados según hacia dónde miran; cada uno con sus propios cabios.
        const depth = (pl) => pl.pts.reduce((a, p) => { const [X, Y] = Camera.rotate(p[0], p[1], cam.rot); return a + X + Y; }, 0);
        const planes = [...g.planes].sort((a, b) => depth(a) - depth(b));
        for (const pl of planes) {
            const [p0, p1, , p3] = pl.pts;
            const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            const v = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
            let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            if (n[2] < 0) n = n.map((c) => -c);
            const len = Math.hypot(...n) || 1;
            const light = (-0.35 * n[0] - 0.55 * n[1] + 0.76 * n[2]) / len; // luz desde arriba a la izquierda
            const eq = planeEq(pl.pts);
            pl.eq = eq;
            const holes = holesOf(eq);
            if (holes.length) {
                ctx.save();
                for (const hl of holes) {
                    ctx.beginPath();
                    ctx.rect(-1e5, -1e5, 2e5, 2e5);
                    hl.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                    ctx.closePath();
                    ctx.clip('evenodd');
                }
            }
            poly(pl.pts, shade(drawTheme().roof, 0.78 + 0.3 * Math.max(0, light)), shade(drawTheme().roof, 0.62));
            const xs = pl.pts.map((q) => q[0]);
            const ys = pl.pts.map((q) => q[1]);
            const inside = (r) => {
                const mx = (r.from[0] + r.to[0]) / 2;
                const my = (r.from[1] + r.to[1]) / 2;
                return mx >= Math.min(...xs) - 0.5 && mx <= Math.max(...xs) + 0.5 && my >= Math.min(...ys) - 0.5 && my <= Math.max(...ys) + 0.5;
            };
            ctx.save();
            ctx.beginPath();
            pl.pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.clip();
            ctx.strokeStyle = 'rgba(90,40,20,.35)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            for (const r of g.rafters ?? []) {
                if (!inside(r)) continue;
                const a = P(r.from);
                const b = P(r.to);
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
            }
            ctx.stroke();
            ctx.restore();
            if (holes.length) ctx.restore();
        }
        if (g.ridge) {
            const rh = holesOf(planeEq(g.planes[0].pts));
            if (rh.length) {
                withHoles(ctx, rh, () => this.drawRidge(ctx, P, g.ridge));
                return;
            }
            const a = P(g.ridge.from);
            const b = P(g.ridge.to);
            ctx.strokeStyle = '#4a2110';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
        }
    }

    drawRidge(ctx, P, ridge) {
        const a = P(ridge.from);
        const b = P(ridge.to);
        ctx.strokeStyle = '#4a2110';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
    }

    /** Losa o entrepiso de una pieza: sólo la cara superior (sin espesor), agujereada por el hueco de la escalera. */
    drawPlate(ctx, cam, b, strokeOn) {
        const pal = PAL()[b.kind];
        const { x0, x1, y0, y1, z1 } = b;
        const P = (x, y, z) => cam.project(x, y, z);
        const holes = b.holes.map((hl) => ({ x0: Math.max(hl.x0, x0), y0: Math.max(hl.y0, y0), x1: Math.min(hl.x1, x1), y1: Math.min(hl.y1, y1) })).filter((hl) => hl.x1 > hl.x0 && hl.y1 > hl.y0);
        // Bordes del hueco: sólo el contorno de la unión (donde dos tramos de escalera se tocan no hay borde).
        const edges = []; // [axis, at, from, to, max] — axis 'x': cara en x = at, a lo largo de y
        for (const hl of holes) {
            for (const [axis, at, from, to, max] of [['x', hl.x0, hl.y0, hl.y1, false], ['x', hl.x1, hl.y0, hl.y1, true], ['y', hl.y0, hl.x0, hl.x1, false], ['y', hl.y1, hl.x0, hl.x1, true]]) {
                let segs = [[from, to]];
                for (const o of holes) {
                    if (o === hl) continue;
                    const touches = axis === 'x' ? (max ? o.x0 === at : o.x1 === at) : (max ? o.y0 === at : o.y1 === at);
                    if (!touches) continue;
                    const [a, c] = axis === 'x' ? [o.y0, o.y1] : [o.x0, o.x1];
                    segs = segs.flatMap(([s0, s1]) => [[s0, Math.min(s1, a)], [Math.max(s0, c), s1]]).filter(([s0, s1]) => s1 - s0 > 0.01);
                }
                for (const [s0, s1] of segs) edges.push([axis, at, s0, s1, max]);
            }
        }
        ctx.beginPath();
        for (const r of [{ x0, y0, x1, y1 }, ...holes]) {
            [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([x, y]) => P(x, y, z1)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
        }
        ctx.fillStyle = pal.top;
        ctx.fill('evenodd');
        if (strokeOn) {
            ctx.beginPath();
            [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => P(x, y, z1)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            for (const [axis, at, s0, s1] of edges) {
                const [a, c] = axis === 'x' ? [P(at, s0, z1), P(at, s1, z1)] : [P(s0, at, z1), P(s1, at, z1)];
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(c[0], c[1]);
            }
            ctx.stroke();
        }
    }

    /** Hastial de bloque: polígono con las hiladas y las juntas verticales del despiece del servidor. */
    drawGable(ctx, cam, gb, poly) {
        // Misma sombra que la cara de un muro con esa orientación (si no, el hastial se ve blanco, como un hueco).
        const pal = PAL();
        const normal = gb.plane ? (gb.plane.axis === 'y' ? 'x' : 'y') : null;
        const face = (kind) => (normal && visibleFaces(cam.rot).xp.a === normal ? pal[kind].xp : normal ? pal[kind].yp : drawTheme().block);
        poly(gb.pts, face(KIND.BLOCK), 'rgba(30,41,59,.55)');
        if (cam.zoom < 0.07 || !gb.plane || !gb.courses?.length) return;
        // Bloque por bloque, como un muro: cada pieza con su contorno; las cortadas (más cortas o recortadas en diagonal por
        // la pendiente) con el color de corte. Todo recortado al contorno del hastial.
        const { axis, at, z } = gb.plane;
        const P = (u, v) => (axis === 'y' ? cam.project(at, u, z + v) : cam.project(u, at, z + v));
        const uv = gb.pts.map((pt) => [axis === 'y' ? pt[1] : pt[0], pt[2] - z]);
        const topAt = (u) => {
            let best = -Infinity;
            for (let i = 0; i < uv.length; i++) {
                const [a, c] = [uv[i], uv[(i + 1) % uv.length]];
                if (u < Math.min(a[0], c[0]) - 1e-6 || u > Math.max(a[0], c[0]) + 1e-6) continue;
                best = Math.max(best, a[0] === c[0] ? Math.max(a[1], c[1]) : a[1] + ((c[1] - a[1]) * (u - a[0])) / (c[0] - a[0]));
            }
            return best;
        };
        const lens = (gb.pieces ?? []).map((t) => t / 20); // ticks de 0,5 mm → cm
        const full = Math.max(...lens, 0) - 0.5;
        ctx.save();
        ctx.beginPath();
        gb.pts.forEach((pt, i) => {
            const [x, y] = cam.project(pt[0], pt[1], pt[2]);
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
        });
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = 'rgba(30,41,59,.30)';
        ctx.lineWidth = 0.6;
        ctx.lineJoin = 'round';
        let k = 0;
        for (const c of gb.courses) {
            const n = c.joints.length + 1;
            const cut = lens.slice(k, k + n);
            k += n;
            const ends = [c.u0, ...c.joints];
            ends.push(c.u0 + cut.reduce((a, b2) => a + b2, 0));
            const v0 = c.v0;
            const v1 = v0 + 25;
            for (let i = 0; i < ends.length - 1; i++) {
                const [u0, u1] = [ends[i], ends[i + 1]];
                const sloped = topAt(u0) < v1 - 0.5 || topAt(u1) < v1 - 0.5;
                const kind = sloped || (cut[i] ?? full) < full ? KIND.CUT : KIND.BLOCK;
                const q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
                ctx.beginPath();
                q.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.closePath();
                ctx.fillStyle = face(kind);
                ctx.fill();
                ctx.stroke();
            }
        }
        ctx.restore();
        // el borde de arriba (la pendiente) marcado como el contorno de un muro
        ctx.beginPath();
        gb.pts.forEach((pt, i) => {
            const [x, y] = cam.project(pt[0], pt[1], pt[2]);
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
        });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(30,41,59,.55)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
    }

    /** Picaporte: una barrita oscura sobre la cara visible de la hoja. */
    drawHandle(ctx, cam, b, spec) {
        const { at, z } = b.handle;
        const horizontal = b.axis === 'x';
        const plane = spec.a === 'x' ? (spec.max ? b.x1 : b.x0) : (spec.max ? b.y1 : b.y0);
        const pt = (u, zz) => (horizontal ? cam.project(u, plane, zz) : cam.project(plane, u, zz));
        const [ax, ay] = pt(at - 7, z);
        const [bx, by] = pt(at + 7, z);
        ctx.save();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = Math.max(2, 3.5 * cam.zoom);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.restore();
    }

    drawBox(ctx, cam, it, strokeOn) {
        const b = it.b;
        if (b.kind === KIND.ROOF) {
            this.drawRoofPart(this.frame, b.roof);
            return;
        }
        if (b.kind === KIND.TREE) {
            this.drawTree(ctx, cam, b);
            return;
        }
        // Junta de los bloques: se fija en cada caja (el piso y el techo dejan su propio color de trazo en el contexto).
        ctx.strokeStyle = 'rgba(30,41,59,.30)';
        ctx.lineWidth = 0.6;
        ctx.lineJoin = 'round';
        if (b.plate) {
            this.drawPlate(ctx, cam, b, strokeOn);
            return;
        }
        const rot = cam.rot;
        const glass = b.kind === KIND.GLASS;
        const pal = PAL()[b.kind];
        const { x0, x1, y0, y1, z0, z1 } = b;
        const P = (x, y, z) => cam.project(x, y, z);

        const drawFace = (pts, color) => {
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            if (strokeOn) ctx.stroke();
        };

        // Caras del marco girado: +x' y +y' (las que ve la cámara), más la superior.
        const { xp: xpFace, yp: ypFace } = visibleFaces(rot);

        const face = (spec, isXp) => {
            // Las caras perpendiculares al eje son "de extremo": no se pintan donde hay otra pieza pegada.
            if (spec.a === b.axis && (spec.max ? b.adjB : b.adjA)) return;
            const X = spec.max ? x1 : x0;
            const Y = spec.max ? y1 : y0;
            const pts = spec.a === 'x'
                ? [P(X, y0, z0), P(X, y1, z0), P(X, y1, z1), P(X, y0, z1)]
                : [P(x0, Y, z0), P(x1, Y, z0), P(x1, Y, z1), P(x0, Y, z1)];
            drawFace(pts, isXp ? pal.xp : pal.yp);
        };

        if (glass) {
            // sólo la cara larga, sin contorno: las hiladas no se notan en el vidrio
            const long = xpFace.a !== b.axis ? xpFace : ypFace;
            const on = strokeOn;
            strokeOn = false;
            face(long, long === xpFace);
            strokeOn = on;
            return;
        }
        if (b.flat) {
            const on = strokeOn;
            strokeOn = false;
            if (b.top) drawFace([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], pal.top);
            face(ypFace, false);
            face(xpFace, true);
            strokeOn = on;
            if (b.handle) this.drawHandle(ctx, cam, b, xpFace.a !== b.axis ? xpFace : ypFace);
            return;
        }
        if (b.top) {
            drawFace([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], pal.top);
        }
        face(ypFace, false);
        face(xpFace, true);
    }

    // ---------- sombras ----------
    /** Corrimiento en el suelo (cm) de un punto a altura h, según la posición del sol y el norte del proyecto. */
    sunDisp(project, sun) {
        const theta = ((project.north ?? 0) * Math.PI) / 180;
        const north = [Math.sin(theta), -Math.cos(theta)];
        const east = [Math.cos(theta), Math.sin(theta)];
        const az = (sun.az * Math.PI) / 180;
        const toSun = [east[0] * Math.sin(az) + north[0] * Math.cos(az), east[1] * Math.sin(az) + north[1] * Math.cos(az)];
        const k = 1 / Math.tan((sun.alt * Math.PI) / 180);
        return (h) => [-toSun[0] * h * k, -toSun[1] * h * k];
    }

    drawShadows(f) {
        const { cam, project, analysis, ui, sun } = f;
        if (!sun || sun.alt < 3) return;
        const disp = this.sunDisp(project, sun);

        const sctx = this.shadowCtx;
        sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        sctx.clearRect(0, 0, cam.w, cam.h);
        sctx.fillStyle = '#0f172a';
        const levelH = 300;
        const maxLevel = ui.level;
        for (let li = 0; li <= maxLevel; li++) {
            const zBase = li * levelH;
            const seen = new Set();
            for (const c of [0, 1]) {
                for (const run of analysis.levels[li]?.courses?.[c] ?? []) {
                    const half = run.t / 2;
                    const rect = run.axis === 'x' ? [run.a, run.line - half, run.b, run.line + half] : [run.line - half, run.a, run.line + half, run.b];
                    const key = rect.join(',');
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const [rx0, ry0, rx1, ry1] = rect;
                    const pts = [];
                    for (const [px, py] of [[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]]) {
                        const d0 = disp(zBase);
                        const d1 = disp(zBase + levelH);
                        pts.push([px + d0[0], py + d0[1]], [px + d1[0], py + d1[1]]);
                    }
                    const hull = convexHull(pts).map(([x, y]) => cam.project(x, y, 0));
                    sctx.beginPath();
                    hull.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)));
                    sctx.closePath();
                    sctx.fill();
                }
            }
        }
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.globalAlpha = 0.27;
        this.ctx.drawImage(this.shadow, 0, 0);
        this.ctx.restore();
        this.drawTreeShadows(f);
    }

    // ---------- planta ----------
    drawPlan(f) {
        const { ctx } = this;
        const { cam, project, analysis, ui } = f;
        // En la pestaña Techo se ve la planta del último nivel con muros y, encima, el techo.
        const active = ui.level === 2 ? (project.upper ? 1 : 0) : ui.level;

        for (let li = 0; li <= active; li++) {
            const ghost = li < active;
            const courses = analysis.levels[li]?.courses ?? [];
            const rects = new Map();
            for (const c of [0, 1]) {
                for (const run of courses[c] ?? []) {
                    const half = run.t / 2;
                    const r = run.axis === 'x' ? [run.a, run.line - half, run.b, run.line + half] : [run.line - half, run.a, run.line + half, run.b];
                    rects.set(r.join(','), r);
                }
            }
            if (!ghost) this.drawRoomFloors(f, li, 0);
            const fill = ghost ? '#a9b4c4' : '#1e293b';
            const edge = ghost ? '#94a3b8' : '#0f172a';
            ctx.globalAlpha = ghost ? 0.7 : 1;
            // Primero el contorno (1 px) y luego el relleno: sólo queda la línea exterior de la unión.
            ctx.fillStyle = edge;
            for (const [x0, y0, x1, y1] of rects.values()) this.fillRectPlan(cam, x0 - 0.8 / cam.zoom, y0 - 0.8 / cam.zoom, x1 + 0.8 / cam.zoom, y1 + 0.8 / cam.zoom);
            ctx.fillStyle = fill;
            for (const [x0, y0, x1, y1] of rects.values()) this.fillRectPlan(cam, x0, y0, x1, y1);
            ctx.globalAlpha = 1;
            if (!ghost) this.drawPlanFurniture(f, li); // antes que los nombres de los ambientes, que quedan arriba
            if (!ghost && ui.level !== 2) this.drawPlanRooms(f, li);
            this.drawPlanOpenings(f, project.levels[li], ghost);
            this.drawPlanColumns(f, project.levels[li], ghost);
            if (li === 1 && !ghost) this.drawPlanTimber(f, false);
            if (li === 0) this.drawPlanStairs(f, ghost);
            if (li === 1) this.drawPlanSlabs(f);
        }
        this.drawZoneLabels(f);
        this.drawTreeShadows(f);
        this.drawPlanTrees(f);
        if (ui.level === 2) this.drawPlanRoof(f);
    }

    /** Escaleras en planta: peldaños como líneas, descansos rellenos y flecha de subida. */
    drawPlanStairs(f, ghost) {
        const { ctx } = this;
        const { cam, analysis } = f;
        const P = (x, y) => cam.project(x, y, 0);
        ctx.save();
        ctx.globalAlpha = ghost ? 0.6 : 1;
        for (const st of analysis.floors?.stairs ?? []) {
            for (const l of st.landings) {
                ctx.fillStyle = 'rgba(148,163,184,.55)';
                this.fillRectPlan(cam, l.x0, l.y0, l.x1, l.y1);
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 1.4;
                this.strokeRectPlan(cam, l.x0, l.y0, l.x1, l.y1);
            }
            ctx.fillStyle = 'rgba(255,255,255,.55)';
            for (const s of st.steps) this.fillRectPlan(cam, s.x0, s.y0, s.x1, s.y1);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            for (const s of st.steps) this.strokeRectPlan(cam, s.x0, s.y0, s.x1, s.y1);
            // flecha: del primer al último peldaño
            const first = st.steps[0];
            const last = st.steps[st.steps.length - 1];
            if (first && last) {
                const [ax, ay] = P((first.x0 + first.x1) / 2, (first.y0 + first.y1) / 2);
                const [bx, by] = P((last.x0 + last.x1) / 2, (last.y0 + last.y1) / 2);
                ctx.strokeStyle = '#3f6212';
                ctx.fillStyle = '#3f6212';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
                const ang = Math.atan2(by - ay, bx - ax);
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(bx - 9 * Math.cos(ang - 0.45), by - 9 * Math.sin(ang - 0.45));
                ctx.lineTo(bx - 9 * Math.cos(ang + 0.45), by - 9 * Math.sin(ang + 0.45));
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    drawPlanSlabs(f) {
        const { ctx } = this;
        const { cam, analysis } = f;
        ctx.save();
        for (const sl of analysis.floors?.slabs ?? []) {
            ctx.fillStyle = 'rgba(100,116,139,.32)';
            for (const p of sl.parts) this.fillRectPlan(cam, p.x0, p.y0, p.x1, p.y1);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([7, 4]);
            this.strokeRectPlan(cam, sl.rect.x, sl.rect.y, sl.rect.x + sl.rect.w, sl.rect.y + sl.rect.h);
            ctx.setLineDash([]);
            if (cam.zoom > 0.06) {
                ctx.font = '600 11px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#334155';
                const [sx, sy] = cam.project(sl.rect.x + sl.rect.w / 2, sl.rect.y + sl.rect.h / 2, 0);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`Losa ${sl.thickness} cm · ${fmt(sl.areaM2, 1)} m²`, sx, sy);
            }
        }
        ctx.restore();
    }

    /** Techo en planta: faldones, cumbrera (o caída) y pendiente. */
    drawPlanRoof(f) {
        const { ctx } = this;
        const { cam, analysis } = f;
        ctx.save();
        const parts = analysis.roof?.parts ?? [];
        for (const [idx, part] of parts.entries()) {
        const g = part.geometry;
        ctx.lineJoin = 'round';
        for (const pl of g.planes) {
            const holes = planeHoles(parts, idx, planeEq(pl.pts)).map((hp) => hp.map(([x, y]) => cam.project(x, y, 0)));
            withHoles(ctx, holes, () => {
            ctx.beginPath();
            pl.pts.forEach((pt, i) => {
                const [x, y] = cam.project(pt[0], pt[1], 0);
                if (i) ctx.lineTo(x, y);
                else ctx.moveTo(x, y);
            });
            ctx.closePath();
            ctx.fillStyle = 'rgba(196,99,63,.28)';
            ctx.fill();
            ctx.strokeStyle = '#7a3b25';
            ctx.lineWidth = 1.6;
            ctx.stroke();
            });
        }
        if (g.ridge) {
            const a = cam.project(g.ridge.from[0], g.ridge.from[1], 0);
            const b = cam.project(g.ridge.to[0], g.ridge.to[1], 0);
            ctx.strokeStyle = '#4a2110';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
        }
        // flechas de caída, una por faldón (del punto medio del alero hacia el interior)
        ctx.strokeStyle = '#7a3b25';
        ctx.fillStyle = '#7a3b25';
        ctx.lineWidth = 1.5;
        for (const pl of g.planes) {
            const xs = pl.pts.map((p) => p[0]);
            const ys = pl.pts.map((p) => p[1]);
            const zs = pl.pts.map((p) => p[2]);
            const zMax = Math.max(...zs);
            const zMin = Math.min(...zs);
            const hi = pl.pts.filter((p) => p[2] > zMax - 0.5);
            const lo = pl.pts.filter((p) => p[2] < zMin + 0.5);
            if (!hi.length || !lo.length || zMax - zMin < 1) continue;
            const mid = (list) => [list.reduce((a, p) => a + p[0], 0) / list.length, list.reduce((a, p) => a + p[1], 0) / list.length];
            const [hx, hy] = mid(hi);
            const [lx, ly] = mid(lo);
            const [ax, ay] = cam.project(hx, hy, 0);
            const [bx, by] = cam.project(lx, ly, 0);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
            const ang = Math.atan2(by - ay, bx - ax);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - 9 * Math.cos(ang - 0.45), by - 9 * Math.sin(ang - 0.45));
            ctx.lineTo(bx - 9 * Math.cos(ang + 0.45), by - 9 * Math.sin(ang + 0.45));
            ctx.closePath();
            ctx.fill();
            if (cam.zoom > 0.05 && xs.length) {
                ctx.font = '600 11px system-ui, sans-serif';
                ctx.textAlign = 'center';
                const [mx, my] = cam.project((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 0);
                ctx.fillText(`${fmt(pl.areaM2 * (pl.visible ?? 1), 1)} m²`, mx, my - 8);
            }
        }
        }
        ctx.restore();
    }

    strokeRectPlan(cam, x0, y0, x1, y1) {
        const { ctx } = this;
        ctx.beginPath();
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => {
            const [sx, sy] = cam.project(x, y, 0);
            if (i) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
    }

    fillRectPlan(cam, x0, y0, x1, y1) {
        const a = cam.project(x0, y0, 0);
        const b = cam.project(x1, y1, 0);
        const c = cam.project(x1, y0, 0);
        const d = cam.project(x0, y1, 0);
        const { ctx } = this;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fill();
    }

    drawPlanRooms(f, li) {
        // en ambientes chicos (< 4 m²) sólo el nombre: con los m² el rótulo tapa a los vecinos
        const { ctx } = this;
        const { cam, analysis } = f;
        if (cam.zoom < 0.06) return;
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const rooms = analysis.levels[li]?.rooms ?? [];
        // Sin nombre: «Ambiente N» en el centro. Con nombre: el que se escribió, donde se puso (un espacio abierto puede tener varios).
        for (const r of rooms) {
            if (r.labels) continue;
            const [sx, sy] = cam.project((r.bbox.x + r.bbox.w / 2) * G, (r.bbox.y + r.bbox.h / 2) * G, 0);
            if (r.netM2 < SMALL_ROOM_M2) this.tag(ctx, `${r.name}`, sx, sy);
            else this.pill(ctx, `${r.name}`, `${fmt(r.netM2, 2)} m²`, sx, sy);
        }
        const picked = f.ui.selection?.type === 'label' ? f.ui.selection.id : null;
        for (const lb of analysis.levels[li]?.labels ?? []) {
            const [sx, sy] = cam.project((lb.x + 0.5) * G, (lb.y + 0.5) * G, 0);
            const room = rooms.find((q) => q.id === lb.room);
            if (room?.labels === 1 && room.netM2 >= SMALL_ROOM_M2) this.pill(ctx, lb.name, `${fmt(room.netM2, 2)} m²`, sx, sy, lb.id === picked);
            else this.tag(ctx, lb.name, sx, sy, lb.id === picked);
        }
    }

    /** Nombre de un ambiente sin superficie (espacios abiertos con varios nombres). */
    tag(ctx, text, sx, sy, picked = false) {
        const w = ctx.measureText(text).width + 14;
        ctx.fillStyle = 'rgba(255,255,255,.86)';
        ctx.strokeStyle = picked ? '#2563eb' : 'rgba(30,41,59,.25)';
        ctx.lineWidth = picked ? 2 : 1;
        roundRect(ctx, sx - w / 2, sy - 12, w, 24, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1e293b';
        ctx.fillText(text, sx, sy);
    }

    pill(ctx, line1, line2, sx, sy, picked = false) {
        const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 14;
        ctx.fillStyle = 'rgba(255,255,255,.86)';
        ctx.strokeStyle = picked ? '#2563eb' : 'rgba(30,41,59,.25)';
        ctx.lineWidth = picked ? 2 : 1;
        roundRect(ctx, sx - w / 2, sy - 18, w, 36, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1e293b';
        ctx.fillText(line1, sx, sy - 6);
        ctx.fillStyle = '#3f6212';
        ctx.fillText(line2, sx, sy + 8);
    }

    /**
     * Muebles en planta: un rectángulo claro con borde fino, su nombre corto si entra y una línea gruesa en la cabecera
     * o el respaldo. Nada más: son gabaritos para medir el ambiente.
     */
    drawPlanFurniture(f, li) {
        const { ctx } = this;
        const { cam, ui, scene } = f;
        if (!furnitureOn(ui)) return;
        ctx.save();
        ctx.font = '500 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const m of scene?.furniture?.[li] ?? []) {
            const { rect } = m;
            const [ax, ay] = cam.project(rect[0], rect[1], 0);
            const [bx, by] = cam.project(rect[2], rect[3], 0);
            const [x, y, w, h] = [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
            ctx.fillStyle = 'rgba(255,255,255,.82)';
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 1;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
            if (m.back) {
                const [ex0, ey0, ex1, ey1] = backEdge(rect, m.rot);
                const [px, py] = cam.project(ex0, ey0, 0);
                const [qx, qy] = cam.project(ex1, ey1, 0);
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(qx, qy);
                ctx.stroke();
            }
            if (h >= 14 && ctx.measureText(m.short).width <= w - 6) {
                ctx.fillStyle = '#475569';
                ctx.fillText(m.short, x + w / 2, y + h / 2);
            }
        }
        ctx.restore();
    }

    /** Pilares en planta: cuadrado oscuro con una cruz (símbolo del hormigón armado). */
    drawPlanColumns(f, level, ghost) {
        const { ctx } = this;
        const { cam } = f;
        for (const c of level.columns ?? []) {
            const s = c.size / 2;
            const [x0, y0, x1, y1] = [c.x * G - s, c.y * G - s, c.x * G + s, c.y * G + s];
            ctx.globalAlpha = ghost ? 0.7 : 1;
            ctx.fillStyle = ghost ? '#a9b4c4' : '#334155';
            this.fillRectPlan(cam, x0, y0, x1, y1);
            const [a, b] = [cam.project(x0, y0, 0), cam.project(x1, y1, 0)];
            const [d, e] = [cam.project(x1, y0, 0), cam.project(x0, y1, 0)];
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.moveTo(d[0], d[1]);
            ctx.lineTo(e[0], e[1]);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    drawPlanOpenings(f, level, ghost) {
        const { ctx } = this;
        const { cam } = f;
        for (const o of level.openings ?? []) {
            const w = level.walls.find((x) => x.id === o.wall);
            if (!w) continue;
            const horizontal = w.y1 === w.y2;
            const from = (horizontal ? w.x1 : w.y1) * G + o.pos * G;
            const len = o.w * G;
            const line = (horizontal ? w.y1 : w.x1) * G;
            const t = w.t;
            const rect = horizontal ? [from, line - t / 2 - 0.3, from + len, line + t / 2 + 0.3] : [line - t / 2 - 0.3, from, line + t / 2 + 0.3, from + len];
            ctx.globalAlpha = ghost ? 0.7 : 1;
            ctx.fillStyle = '#f7f9ff';
            this.fillRectPlan(cam, ...rect);
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 1.2;
            const P = (x, y) => cam.project(x, y, 0);
            ctx.beginPath();
            if (o.kind === 'window') {
                for (const off of [-t / 4, 0, t / 4]) {
                    const [a, b] = horizontal ? [P(from, line + off), P(from + len, line + off)] : [P(line + off, from), P(line + off, from + len)];
                    ctx.moveTo(a[0], a[1]);
                    ctx.lineTo(b[0], b[1]);
                }
                ctx.stroke();
            } else if (o.mode === 'slide' || o.mode === 'overhead') {
                // corrediza o seccional: sin arco; la hoja corre junto al muro y una guía punteada marca el recorrido
                const off = (o.flip ? -1 : 1) * (t / 2 + 2.5);
                const seg = (u0, u1) => (horizontal ? [P(u0, line + off), P(u1, line + off)] : [P(line + off, u0), P(line + off, u1)]);
                if (o.mode === 'slide') {
                    const u0 = o.hingeEnd ? from - len / 2 : from + len / 2;
                    const [a, b] = seg(u0, u0 + len);
                    ctx.moveTo(a[0], a[1]);
                    ctx.lineTo(b[0], b[1]);
                    ctx.stroke();
                }
                ctx.beginPath();
                ctx.lineWidth = 0.9;
                ctx.setLineDash([3, 3]);
                const [c, d] = seg(from, from + len);
                ctx.moveTo(c[0], c[1]);
                ctx.lineTo(d[0], d[1]);
                ctx.stroke();
                ctx.setLineDash([]);
            } else if (o.mode !== 'fixed' && o.mode !== 'open') {
                // hoja de puerta abierta 90° + arco de giro, con la bisagra en el extremo elegido
                const sign = o.flip ? -1 : 1;
                const along = o.hingeEnd ? -1 : 1;
                const hingeAt = o.hingeEnd ? from + len : from;
                const hinge = horizontal ? [hingeAt, line] : [line, hingeAt];
                const tip = horizontal ? [hingeAt, line + sign * len] : [line + sign * len, hingeAt];
                const [h0, h1] = [P(...hinge), P(...tip)];
                ctx.moveTo(h0[0], h0[1]);
                ctx.lineTo(h1[0], h1[1]);
                ctx.stroke();
                ctx.beginPath();
                ctx.lineWidth = 0.9;
                ctx.strokeStyle = 'rgba(30,41,59,.6)';
                const steps = 12;
                for (let i = 0; i <= steps; i++) {
                    const ang = (i / steps) * (Math.PI / 2);
                    const u = hingeAt + along * Math.cos(ang) * len;
                    const v = line + sign * Math.sin(ang) * len;
                    const [sx, sy] = horizontal ? P(u, v) : P(v, u);
                    if (i) ctx.lineTo(sx, sy);
                    else ctx.moveTo(sx, sy);
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
    }

    drawPlanTimber(f, ghost) {
        const { ctx } = this;
        const { cam, analysis } = f;
        const timber = analysis.timber;
        if (!timber) return;
        for (const fld of timber.fields ?? []) {
            // Sombreado suave del paño y tirantes como líneas finas continuas (sin guiones que ensucian la planta).
            ctx.fillStyle = ghost ? 'rgba(217,160,91,.10)' : 'rgba(217,160,91,.16)';
            this.fillRectPlan(cam, fld.rect.x, fld.rect.y, fld.rect.x + fld.rect.w, fld.rect.y + fld.rect.h);
            ctx.strokeStyle = ghost ? 'rgba(176,120,50,.45)' : 'rgba(176,120,50,.8)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            const pxGap = fld.spacingCm * cam.zoom;
            const skip = pxGap < 3 ? Math.ceil(3 / pxGap) : 1; // no dibujar tirantes a menos de 3 px entre sí
            fld.joists.forEach((j, i) => {
                if (i % skip) return;
                const a = cam.project(j.x1, j.y1, 0);
                const b = cam.project(j.x2, j.y2, 0);
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
            });
            ctx.stroke();
            if (!ghost && cam.zoom > 0.05) {
                ctx.font = '600 11px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const [sx, sy] = cam.project(fld.rect.x + fld.rect.w / 2, fld.rect.y + fld.rect.h / 2, 0);
                const label = `${fld.count} tirantes ${fld.section.replace('x', '″×')}″ c/${fmt(fld.spacingCm, 0)} cm`;
                const w = ctx.measureText(label).width + 10;
                ctx.fillStyle = 'rgba(255,255,255,.85)';
                roundRect(ctx, sx - w / 2, sy - 9, w, 18, 5);
                ctx.fill();
                ctx.fillStyle = '#7a4a12';
                ctx.fillText(label, sx, sy);
            }
        }
        ctx.strokeStyle = '#8a5a1f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const b of timber.beams ?? []) {
            const p = cam.project(b.x1, b.y1, 0);
            const q = cam.project(b.x2, b.y2, 0);
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(q[0], q[1]);
        }
        ctx.stroke();
    }

    // ---------- rosa de los vientos y sol ----------
    drawCompass(f) {
        const { ctx } = this;
        const { cam, project, sun, ui } = f;
        if (!project) return;
        // Brújula con el sol, arriba a la derecha del lienzo.
        const r = 30;
        const cx = cam.w - 50;
        const cy = 50;
        const dirOf = (vx, vy) => {
            const [X, Y] = Camera.rotate(vx, vy, cam.rot);
            const [sx, sy] = cam.view === 'plan' ? [X, Y] : [(X - Y) * Math.cos(Math.PI / 6), (X + Y) * 0.5];
            const len = Math.hypot(sx, sy) || 1;
            return [sx / len, sy / len];
        };
        const theta = (project.north * Math.PI) / 180;
        const north = dirOf(Math.sin(theta), -Math.cos(theta));

        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,.88)';
        ctx.strokeStyle = 'rgba(30,41,59,.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // cardinales
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cardinals = [['N', 0, '#b42318'], ['E', 90, '#1e293b'], ['S', 180, '#1e293b'], ['O', 270, '#1e293b']];
        for (const [label, deg, color] of cardinals) {
            const a = ((project.north + deg) * Math.PI) / 180;
            const d = dirOf(Math.sin(a), -Math.cos(a));
            ctx.fillStyle = color;
            ctx.fillText(label, cx + d[0] * (r - 4), cy + d[1] * (r - 4));
        }
        // aguja del norte
        ctx.strokeStyle = '#b42318';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + north[0] * (r - 14), cy + north[1] * (r - 14));
        ctx.stroke();
        if (sun && ui.solar.show) {
            const theta2 = theta;
            const n2 = [Math.sin(theta2), -Math.cos(theta2)];
            const e2 = [Math.cos(theta2), Math.sin(theta2)];
            const az = (sun.az * Math.PI) / 180;
            const dir = dirOf(e2[0] * Math.sin(az) + n2[0] * Math.cos(az), e2[1] * Math.sin(az) + n2[1] * Math.cos(az));
            const up = sun.alt > 0;
            ctx.fillStyle = up ? '#f5b301' : '#94a3b8';
            ctx.strokeStyle = '#7a5a00';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx + dir[0] * (r + 6), cy + dir[1] * (r + 6), 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#1e293b';
            ctx.font = '600 11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            const hh = Math.floor(sun.h);
            const mm = String(Math.round((sun.h - hh) * 60)).padStart(2, '0');
            ctx.fillText(`${String(hh).padStart(2, '0')}:${mm} · ${up ? `sol ${fmt(sun.alt, 0)}°` : 'noche'}`, cx, cy + r + 18);
        }
        ctx.restore();
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Envolvente convexa (cadena monótona de Andrew). */
export function convexHull(points) {
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (const p of [...pts].reverse()) {
        while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
        upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Un racimo de hojas sueltas, sin contorno: las hojas se acomodan como las semillas de un girasol (ángulo áureo), de
 * afuera hacia adentro, y cada una apunta hacia afuera. `light` (0…1) aclara el racimo del lado del sol.
 */
const LEAVES = 22;
function leafCluster(ctx, sx, sy, rpx, light, picked) {
    const len = Math.max(1.6, rpx * 0.36);
    const wid = Math.max(0.8, rpx * 0.15);
    for (let k = LEAVES; k >= 1; k--) {
        const a = k * 2.39996;
        const rr = rpx * 0.92 * Math.sqrt(k / LEAVES);
        const shade = Math.max(0, Math.min(1, light * 0.8 + ((k * 7) % 5) * 0.06 - (k / LEAVES) * 0.15));
        ctx.fillStyle = mix('#2f6b25', '#b9e08a', shade);
        ctx.beginPath();
        ctx.ellipse(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.85, len, wid, a + 0.3, 0, Math.PI * 2);
        ctx.fill();
        if (picked) {
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }
    }
}
