/** Persistencia local del proyecto (compartida por editor, cómputo y galería). */
const KEY = 'blockk.project.v1';

export function loadProject() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        return p && Array.isArray(p.levels) ? p : null;
    } catch {
        return null;
    }
}

export function saveProject(project) {
    try {
        localStorage.setItem(KEY, JSON.stringify(project));
        return true;
    } catch {
        return false; // modo privado o cuota: el editor sigue funcionando sin persistencia
    }
}

const emptyLevel = () => ({ walls: [], openings: [], ubeams: [], timber: [], slabs: [], stairs: [] });

export function blankProject({ name = 'Proyecto sin título', lotW = 24, lotD = 20, t = 20, lat = -34.6, north = 0 } = {}) {
    return {
        v: 1,
        name,
        north,
        lat,
        lot: { w: lotW, d: lotD },
        settings: { defaultT: t, reservePct: 3, currency: 'USD', prices: {} },
        upper: false,
        roofs: [],
        levels: [emptyLevel(), emptyLevel()],
    };
}

/** Siguiente id libre con prefijo (w = muro, o = vano, u = viga U, t = madera, l = losa, e = escalera). */
export function nextId(project, prefix) {
    let max = 0;
    for (const r of [...(project.roofs ?? []), ...(project.zones ?? []), ...(project.trees ?? [])]) {
        const m = /^[a-z]+(\d+)/.exec(String(r.id));
        if (m) max = Math.max(max, Number(m[1]));
    }
    for (const level of project.levels) {
        for (const list of [level.walls, level.openings, level.ubeams, level.timber, level.slabs, level.stairs, level.columns, level.labels]) {
            for (const item of list ?? []) {
                const m = /^[a-z]+(\d+)/.exec(String(item.id));
                if (m) max = Math.max(max, Number(m[1]));
            }
        }
    }
    return `${prefix}${max + 1}`;
}
