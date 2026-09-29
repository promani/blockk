/**
 * Techos superpuestos: sólo se ve la cubierta más alta. Para cada faldón (o hastial) se calculan los «huecos»: las zonas donde
 * queda debajo de otro techo. Cada techo es una carpa (el menor de sus faldones) sobre un rectángulo, así que cada hueco es un
 * polígono convexo: la planta del otro techo recortada por semiplanos lineales. El renderer recorta el dibujo con esos huecos.
 */

/** z = a·x + b·y + c del plano de tres puntos. */
export function planeEq(pts) {
    const [p, q, r] = pts;
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.abs(n[2]) < 1e-9) return [0, 0, p[2]];
    const a = -n[0] / n[2];
    const b = -n[1] / n[2];

    return [a, b, p[2] - a * p[0] - b * p[1]];
}

/** Recorta un polígono convexo 2D al semiplano a·x + b·y + c ≤ 0 (Sutherland–Hodgman). */
function clipHalf(poly, [a, b, c]) {
    const out = [];
    const f = (p) => a * p[0] + b * p[1] + c;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const fp = f(p);
        const fq = f(q);
        if (fp <= 0) out.push(p);
        if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
            const t = fp / (fp - fq);
            out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
    }

    return out;
}

const cache = new WeakMap();
function info(part) {
    let i = cache.get(part);
    if (!i) {
        const planes = part.geometry.planes;
        const xs = planes.flatMap((pl) => pl.pts.map((p) => p[0]));
        const ys = planes.flatMap((pl) => pl.pts.map((p) => p[1]));
        i = { eqs: planes.map((pl) => planeEq(pl.pts)), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
        cache.set(part, i);
    }

    return i;
}

const EPS = 0.01;

/** Huecos (polígonos en planta) de un faldón con ecuación `eq` del techo `idx`. */
export function planeHoles(parts, idx, eq) {
    const holes = [];
    parts.forEach((other, j) => {
        if (j === idx) return;
        const o = info(other);
        let poly = [[o.x0, o.y0], [o.x1, o.y0], [o.x1, o.y1], [o.x0, o.y1]];
        // oculto donde este faldón queda por debajo de todos los faldones del otro techo (empate: gana el de índice menor)
        const e = j < idx ? EPS : -EPS;
        for (const k of o.eqs) {
            poly = clipHalf(poly, [eq[0] - k[0], eq[1] - k[1], eq[2] - k[2] - e]);
            if (poly.length < 3) return;
        }
        holes.push(poly);
    });

    return holes;
}

/**
 * Huecos de un hastial vertical: polígonos en (u, z), con u a lo largo del hastial. `axis` 'y' = el hastial está en x = at;
 * 'x' = en y = at.
 */
export function gableHoles(parts, idx, axis, at) {
    const holes = [];
    parts.forEach((other, j) => {
        if (j === idx) return;
        const o = info(other);
        const [lo, hi, pLo, pHi] = axis === 'y' ? [o.y0, o.y1, o.x0, o.x1] : [o.x0, o.x1, o.y0, o.y1];
        if (at < pLo || at > pHi) return;
        let poly = [[lo, -1e4], [hi, -1e4], [hi, 1e5], [lo, 1e5]];
        for (const k of o.eqs) {
            // z − h(u) ≤ 0, con h(u) = a·x + b·y + c evaluado sobre la recta del hastial
            const [au, c] = axis === 'y' ? [k[1], k[0] * at + k[2]] : [k[0], k[1] * at + k[2]];
            poly = clipHalf(poly, [-au, 1, -c - EPS]);
            if (poly.length < 3) return;
        }
        holes.push(poly);
    });

    return holes;
}

/** Recorta el contexto para excluir los huecos (polígonos ya en pantalla) y ejecuta `draw`. */
export function withHoles(ctx, holes, draw) {
    if (!holes.length) {
        draw();
        return;
    }
    ctx.save();
    for (const h of holes) {
        ctx.beginPath();
        ctx.rect(-1e5, -1e5, 2e5, 2e5);
        h.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.clip('evenodd');
    }
    draw();
    ctx.restore();
}
