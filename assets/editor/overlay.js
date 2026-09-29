import { visibleFaces } from './scene.js';

/** Contorno de un rectángulo de mundo sobre el plano z. */
export function outlineRect(ctx, cam, x0, y0, x1, y1, z, { stroke = '#1e293b', fill = null, width = 2, dash = null } = {}) {
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => cam.project(x, y, z));
    ctx.save();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
}

/** Caja translúcida (fantasma de una herramienta o resalte de selección). */
export function ghostBox(ctx, cam, b, { fill = 'rgba(139,197,63,.45)', stroke = '#3f6212', width = 1.6 } = {}) {
    const { x0, x1, y0, y1, z0, z1 } = b;
    const P = (x, y, z) => cam.project(x, y, z);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    const poly = (pts) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    };
    if (cam.view === 'plan') {
        poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)]);
    } else {
        const { xp, yp } = visibleFaces(cam.rot);
        for (const spec of [yp, xp]) {
            const X = spec.max ? x1 : x0;
            const Y = spec.max ? y1 : y0;
            poly(spec.a === 'x' ? [P(X, y0, z0), P(X, y1, z0), P(X, y1, z1), P(X, y0, z1)] : [P(x0, Y, z0), P(x1, Y, z0), P(x1, Y, z1), P(x0, Y, z1)]);
        }
        poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]);
    }
    ctx.restore();
}

/** Aristas de una caja (resalte de selección / hover, se ve a través del modelo). */
export function wireBox(ctx, cam, b, { stroke = '#8bc53f', width = 2.5, dash = null } = {}) {
    const { x0, x1, y0, y1, z0, z1 } = b;
    const P = (x, y, z) => cam.project(x, y, z);
    ctx.save();
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    const loop = (z) => {
        ctx.beginPath();
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => {
            const [sx, sy] = P(x, y, z);
            if (i) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
    };
    loop(z0);
    if (cam.view !== 'plan') {
        loop(z1);
        ctx.beginPath();
        for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
            const a = P(x, y, z0);
            const c = P(x, y, z1);
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(c[0], c[1]);
        }
        ctx.stroke();
    }
    ctx.restore();
}

/** Rótulo con fondo (cotas y medidas). */
export function label(ctx, text, sx, sy, { bg = 'rgba(30,41,59,.92)', fg = '#fff' } = {}) {
    ctx.save();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(sx - w / 2, sy - 11, w, 22, 6);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(text, sx, sy);
    ctx.restore();
}

/** Marcador del nodo de retícula bajo el cursor. */
export function nodeMarker(ctx, cam, x, y, z, color = '#1e293b') {
    const [sx, sy] = cam.project(x, y, z);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

/** Puntos de la retícula de ajuste alrededor del cursor: se ve dónde va a caer el trazo sin llenar el suelo de líneas. */
export function snapDots(ctx, cam, gx, gy, step, z, G = 12.5, radius = 3) {
    ctx.save();
    ctx.fillStyle = 'rgba(30,41,59,.38)';
    for (let i = -radius; i <= radius; i++) {
        for (let j = -radius; j <= radius; j++) {
            if (!i && !j) continue;
            const fade = 1 - Math.hypot(i, j) / (radius + 1);
            if (fade <= 0) continue;
            const [sx, sy] = cam.project((gx + i * step) * G, (gy + j * step) * G, z);
            ctx.globalAlpha = fade;
            ctx.beginPath();
            ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

/** Resalta el muro al que el imán se pegó y, si es su extremo, marca el nodo. */
export function magnetHit(ctx, cam, hit, box, gx, gy, z) {
    wireBox(ctx, cam, box, { stroke: '#2563eb', width: 2.2, dash: [5, 3] });
    const [sx, sy] = cam.project(gx * 12.5, gy * 12.5, z);
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = 'rgba(37,99,235,.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, hit.kind === 'end' ? 9 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    label(ctx, hit.kind === 'end' ? 'Extremo de muro' : `Sobre la pared${hit.level === 0 && z > 0 ? ' de abajo' : ''}`, sx, sy - 22, { bg: 'rgba(37,99,235,.92)' });
}
