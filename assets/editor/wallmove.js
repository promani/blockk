/**
 * Mover un muro perpendicularmente a sí mismo ("agrandar/achicar la habitación").
 *
 * Se mueve toda la cadena de muros colineales que se tocan (un muro dividido por tabiques en T sigue siendo una pared),
 * y los muros perpendiculares que llegan a esa recta estiran o acortan su extremo. Los vanos y vigas U de los muros
 * estirados se reubican; los que quedan fuera del muro se descartan. Opera sobre un borrador (draft) de un nivel.
 */
const axisOf = (w) => (w.y1 === w.y2 ? 'x' : 'y');
const lineOf = (w) => (axisOf(w) === 'x' ? w.y1 : w.x1);
const startOf = (w) => (axisOf(w) === 'x' ? w.x1 : w.y1);
const endOf = (w) => (axisOf(w) === 'x' ? w.x2 : w.y2);

/** Cadena de muros colineales conectados por extremos que contiene a `wall`. */
export function collinearChain(walls, wall) {
    const axis = axisOf(wall);
    const line = lineOf(wall);
    const same = walls.filter((w) => axisOf(w) === axis && lineOf(w) === line);
    const chain = new Set([wall.id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const w of same) {
            if (chain.has(w.id)) continue;
            if (same.some((c) => chain.has(c.id) && (startOf(w) === endOf(c) || endOf(w) === startOf(c)))) {
                chain.add(w.id);
                grew = true;
            }
        }
    }
    return same.filter((w) => chain.has(w.id));
}

/** @returns {{ok: boolean, reason?: string, dropped?: number}} */
export function moveWallLine(level, wallId, newLine, { maxLine = Infinity } = {}) {
    const wall = level.walls.find((w) => w.id === wallId);
    if (!wall) return { ok: false, reason: 'Muro inexistente.' };
    const axis = axisOf(wall);
    const oldLine = lineOf(wall);
    const delta = newLine - oldLine;
    if (delta === 0) return { ok: true, dropped: 0 };
    if (newLine < 0 || newLine > maxLine) return { ok: false, reason: 'El muro saldría del lote.' };

    const chain = collinearChain(level.walls, wall);
    const spanStart = Math.min(...chain.map(startOf));
    const spanEnd = Math.max(...chain.map(endOf));
    const chainIds = new Set(chain.map((w) => w.id));

    // Muros perpendiculares con un extremo sobre la recta y dentro del tramo movido.
    const stretch = [];
    for (const v of level.walls) {
        if (chainIds.has(v.id) || axisOf(v) === axis) continue;
        const startsOn = lineOfEnd(v, 'start', axis) === oldLine && within(v, 'start', axis, spanStart, spanEnd);
        const endsOn = lineOfEnd(v, 'end', axis) === oldLine && within(v, 'end', axis, spanStart, spanEnd);
        if (startsOn) stretch.push([v, 'start']);
        if (endsOn) stretch.push([v, 'end']);
    }
    // Ningún muro puede quedar con largo < 25 cm ni invertido.
    for (const [v, which] of stretch) {
        const s = which === 'start' ? startOf(v) + delta : startOf(v);
        const e = which === 'end' ? endOf(v) + delta : endOf(v);
        if (e - s < 2) return { ok: false, reason: 'Un muro vecino quedaría demasiado corto (mín. 25 cm).' };
    }

    let dropped = 0;
    for (const w of chain) {
        if (axis === 'x') { w.y1 += delta; w.y2 += delta; } else { w.x1 += delta; w.x2 += delta; }
    }
    for (const [v, which] of stretch) {
        const horizontal = axisOf(v) === 'x'; // v es paralelo a la recta perpendicular: se mueve su coordenada "along"
        if (horizontal) {
            if (which === 'start') v.x1 += delta; else v.x2 += delta;
        } else if (which === 'start') v.y1 += delta; else v.y2 += delta;
        const shift = which === 'start' ? -delta : 0; // si se mueve el inicio, las posiciones relativas cambian
        const len = endOf(v) - startOf(v);
        for (const list of [level.openings, level.ubeams ?? []]) {
            for (let i = list.length - 1; i >= 0; i--) {
                const it = list[i];
                if (it.wall !== v.id) continue;
                const span = it.w ?? it.len;
                const pos = it.pos + shift;
                if (pos < 0 || pos + span > len) { list.splice(i, 1); dropped++; } else it.pos = pos;
            }
        }
    }
    return { ok: true, dropped };
}

function lineOfEnd(v, which, axis) {
    // Coordenada, sobre el eje perpendicular al muro movido, del extremo `which` de v.
    const isXAxisMoved = axis === 'x'; // muro movido horizontal → v es vertical y su extremo relevante es y
    return isXAxisMoved ? (which === 'start' ? v.y1 : v.y2) : (which === 'start' ? v.x1 : v.x2);
}

function within(v, _which, axis, a, b) {
    const alongCoord = axis === 'x' ? v.x1 : v.y1; // v es perpendicular: su coordenada fija está a lo largo del muro movido
    return alongCoord >= a && alongCoord <= b;
}

/** Aplica el mismo desplazamiento al muro equivalente de otro nivel (misma recta y tramo superpuesto), si existe. */
export function mirrorMove(otherLevel, wallBefore, newLine, opts) {
    const twin = otherLevel.walls.find((w) => axisOf(w) === axisOf(wallBefore) && lineOf(w) === lineOf(wallBefore) && startOf(w) < endOf(wallBefore) && endOf(w) > startOf(wallBefore));
    return twin ? moveWallLine(otherLevel, twin.id, newLine, opts) : { ok: true, dropped: 0 };
}
