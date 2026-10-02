/**
 * Aberturas: un solo concepto con tipo (puerta, ventana, portón), ancho, alto y forma de abrir. La posición no se edita
 * en un campo: se arrastra la abertura por el muro.
 */
export const G = 12.5;

export const OPENING_TYPES = {
    door: { label: 'Puerta', w: 7, widths: [6, 7, 8, 12], sill: 0, modes: [['swing', 'Batiente'], ['slide', 'Corrediza']] },
    window: { label: 'Ventana', w: 10, widths: [5, 8, 10, 12, 15], sill: 4, modes: [['swing', 'Batiente'], ['slide', 'Corrediza'], ['fixed', 'Fija']] },
    gate: { label: 'Portón', w: 20, widths: [20, 24], sill: 0, modes: [['overhead', 'Seccional'], ['slide', 'Corrediza']] },
};

/** Medidas comerciales del catálogo del servidor (`config.commercial`) para un tipo de abertura. */
export const commercialFor = (cfg, kind) => (cfg.commercial ?? []).filter((c) => c.kind === kind);

/** La medida de catálogo que coincide con la abertura (tipo, ancho y antepecho), o null si es a medida. */
export const commercialOf = (cfg, o) => commercialFor(cfg, o.kind).find((c) => c.w === o.w && c.sill === o.sill) ?? null;

export const openingTitle = (o) => OPENING_TYPES[o.kind]?.label ?? 'Abertura';

/** Forma de abrir por defecto de un tipo. */
export const defaultMode = (kind) => OPENING_TYPES[kind].modes[0][0];

/** Abertura nueva (sin id ni muro) con las medidas habituales del tipo. */
export function newOpening(kind, topCourse, w = OPENING_TYPES[kind].w) {
    const t = OPENING_TYPES[kind];
    return { w, sill: t.sill, h: topCourse - t.sill, kind, preset: '', flip: false, hingeEnd: false, mode: defaultMode(kind) };
}

/**
 * Cómo se mueve una abertura que abre, dicho por el plano. Batiente: dónde está la bisagra y hacia qué lado abre.
 * Corrediza: hacia dónde corre la hoja y de qué lado del muro queda. Valor: «<extremo><lado>» con 0 = inicio / hacia
 * abajo o derecha, 1 = final / hacia arriba o izquierda.
 */
export function turnOptions(horizontal, mode = 'swing') {
    const ends = horizontal ? ['izquierda', 'derecha'] : ['arriba', 'abajo'];
    const sides = horizontal ? ['abajo', 'arriba'] : ['derecha', 'izquierda'];
    const out = [];
    for (const hingeEnd of [0, 1]) {
        for (const flip of [0, 1]) {
            out.push([`${hingeEnd}${flip}`, mode === 'slide'
                ? `Corre hacia ${ends[hingeEnd ? 0 : 1]} · hoja del lado ${sides[flip]}`
                : `Bisagra ${ends[hingeEnd]} · abre hacia ${sides[flip]}`]);
        }
    }
    return out;
}

export const turnValue = (o) => `${o.hingeEnd ? 1 : 0}${o.flip ? 1 : 0}`;
export const applyTurn = (o, v) => Object.assign(o, { hingeEnd: v[0] === '1', flip: v[1] === '1' });
