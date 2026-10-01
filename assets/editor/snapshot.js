import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { buildScene } from './scene.js';

/*
 * Miniaturas con el mismo dibujo del editor: la planta del Nivel 1 (vista Planta) y la casa terminada con techo
 * (vista isométrica). Las usa el script que pregenera las de las plantillas.
 */

const G = 12.5;
const ROOF_LEVEL = 2;
/** Esquina de la isométrica: la que muestra el frente (sur) y el costado este con el sol de la tarde. */
const ISO_ROT = 0;

function bounds(project, config) {
    const walls = project.levels.flatMap((l) => l.walls);
    if (!walls.length) return null;
    return {
        minX: Math.min(...walls.map((w) => w.x1)) * G - 60,
        maxX: Math.max(...walls.map((w) => w.x2)) * G + 60,
        minY: Math.min(...walls.map((w) => w.y1)) * G - 60,
        maxY: Math.max(...walls.map((w) => w.y2)) * G + 60,
        zTop: config.levelHeight * project.levels.filter((l) => l.walls.length).length + 160,
    };
}

/** Sol de invierno a media tarde (a partir del recorrido que da /api/solar), para que las sombras den volumen. */
function sunAt(path, hour = 15) {
    if (!path?.length) return null;
    const i = path.findIndex((p) => p.h >= hour);
    if (i <= 0) return { ...path[Math.max(0, i)], h: hour };
    const a = path[i - 1];
    const b = path[i];
    const t = (hour - a.h) / (b.h - a.h || 1);
    return { ...a, h: hour, alt: a.alt + (b.alt - a.alt) * t, az: a.az + (b.az - a.az) * t };
}

/**
 * Dibuja una vista y devuelve el canvas.
 * @param {'plan'|'iso'} view
 */
export function renderView(view, { project, analysis, config, solarPath = null, width = 640, height = 400 }) {
    const box = bounds(project, config);
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    renderer.resize(width, height, 1);
    const cam = new Camera();
    cam.view = view;
    cam.rot = ISO_ROT;
    cam.resize(width, height);
    if (box) cam.fit(box.minX, box.minY, box.maxX, box.maxY, view === 'plan' ? 0 : box.zTop, view === 'plan' ? 16 : 20);
    const ui = { level: view === 'plan' ? 0 : ROOF_LEVEL, cut: config.courses, solar: { show: view === 'iso' && !!solarPath } };
    renderer.drawStatic({ cam, project, analysis, scene: buildScene(project, analysis, config), ui, sun: view === 'iso' ? sunAt(solarPath) : null });
    return canvas;
}

/** Las dos vistas de la tarjeta como data URL (WebP). */
export function renderThumbs(opts, type = 'image/webp', quality = 0.86) {
    return {
        plan: renderView('plan', opts).toDataURL(type, quality),
        iso: renderView('iso', opts).toDataURL(type, quality),
    };
}
