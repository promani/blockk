import { $, $$, h, add, clear } from '../lib/dom.js';
import { fmt } from '../lib/format.js';
import { loadProject, saveProject, blankProject } from '../lib/storage.js';
import { downloadBlob, slug } from '../lib/download.js';
import { Store } from './store.js';
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { buildScene, roofOuter } from './scene.js';
import { createTools, openingBox } from './tools.js';
import { mountPanels } from './panels.js';
import { wireBox, snapDots, magnetHit } from './overlay.js';
import { magnet } from './snap.js';
import { mountGuide } from './guide.js';
import { wallRect, G } from './pick.js';
import { mountAssistant } from './ai.js';

const config = JSON.parse($('#blockk-config').textContent);
const store = new Store(config);
const canvas = $('#canvas');
const stage = $('#stage');
const cam = new Camera();
const renderer = new Renderer(canvas);

const UI_KEY = 'blockk.ui.v2';
const ROOF_LEVEL = 2;
/** Herramientas de cada pestaña: las principales con nombre y, bajo «Más», las de uso avanzado. */
const TOOLSETS = {
    0: { main: ['select', 'move', 'room', 'wall', 'door', 'window', 'stair'], more: ['block', 'ubeam'] },
    1: { main: ['select', 'move', 'room', 'wall', 'door', 'window', 'piso'], more: ['block', 'ubeam', 'beam'] },
    2: { main: ['select', 'move', 'roof'], more: [] },
};
let showMore = false;

let dirty = true;
let scene = null;
let sceneFor = null;
let sceneVersion = 0;
let toastTimer = null;

const app = {
    store,
    cam,
    canvas,
    hover: null,
    pointer: null,
    tools: null,
    render: () => { dirty = true; },
    refreshOptions,
    persistUi: () => persistUi(),
    toast,
    focusIssue,
    setHint: () => {}, // la ayuda de la herramienta ya está en la barra de opciones
};
window.blockk = app; // útil para depurar y para pruebas end-to-end
app.renderer = renderer;
app.draw = () => draw(); // dibujo síncrono (mediciones de rendimiento)

app.tools = createTools(app);
const panels = mountPanels(app);
app.setTool = (id) => setTool(id);
mountAssistant(app);
const guide = mountGuide(app, {
    go: (level, tool) => {
        if (level === 1 && !store.project.upper) return;
        setLevel(level);
        setTool(tool);
        canvas.focus({ preventScroll: true });
    },
    suggest: () => { setTool('window'); panels.openSuggest(); },
    issues: () => panels.openIssues(),
    addLevel: () => addLevel(),
});

/* ------------------------------------------------------------------ utilidades */
function toast(message, kind = 'info') {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast${kind === 'error' ? ' error' : ''}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 4000);
}

const activeTool = () => app.tools[store.ui.tool] ?? app.tools.select;
/** Plano horizontal de trabajo: el del nivel activo (el techo apoya sobre el último nivel con muros). */
const levelZ = () => (store.ui.level === ROOF_LEVEL ? (store.topLevel + 1) * config.levelHeight : store.ui.level * config.levelHeight);
const planeZ = () => activeTool().planeZ?.() ?? levelZ();
const levelLabel = () => config.levelShort[store.ui.level] ?? 'Techo';

function persistUi() {
    try {
        localStorage.setItem(UI_KEY, JSON.stringify({ view: store.ui.view, showLot: store.ui.showLot, showGrid: store.ui.showGrid }));
    } catch { /* sin persistencia */ }
}

/* ------------------------------------------------------------------ dimensiones y cámara */
function resize() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize(r.width, r.height, dpr);
    cam.resize(r.width, r.height);
    app.render();
}
new ResizeObserver(resize).observe(stage);

function fitView() {
    const p = store.project;
    const walls = p.levels.flatMap((l) => l.walls);
    let minX = 0;
    let minY = 0;
    let maxX = p.lot.w * 100;
    let maxY = p.lot.d * 100;
    let zTop = config.levelHeight;
    if (!walls.length) {
        // Proyecto vacío: se encuadra un área de ~12 × 10 m en el centro del lote para dibujar cómodo.
        const cx = (p.lot.w * 100) / 2;
        const cy = (p.lot.d * 100) / 2;
        minX = cx - Math.min(600, cx);
        maxX = cx + Math.min(600, cx);
        minY = cy - Math.min(500, cy);
        maxY = cy + Math.min(500, cy);
        zTop = 0;
    } else {
        minX = Math.min(...walls.map((w) => w.x1)) * G - 150;
        maxX = Math.max(...walls.map((w) => w.x2)) * G + 150;
        minY = Math.min(...walls.map((w) => w.y1)) * G - 150;
        maxY = Math.max(...walls.map((w) => w.y2)) * G + 150;
        zTop = config.levelHeight * (store.topLevel + 1) + (store.ui.level === ROOF_LEVEL ? 160 : 0);
    }
    cam.fit(minX, minY, maxX, maxY, zTop, 70);
    app.render();
}

/* ------------------------------------------------------------------ puntero */
function pointerInfo(e) {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const [wx, wy] = cam.unproject(sx, sy, planeZ());
    const step = activeTool().snap ?? store.ui.snap;
    let gx = Math.round(wx / G);
    let gy = Math.round(wy / G);
    if (step > 1) {
        gx = Math.round(gx / step) * step;
        gy = Math.round(gy / step) * step;
    }
    const maxX = store.project.lot.w * 8;
    const maxY = store.project.lot.d * 8;
    // Imán: cerca de una pared (del nivel o del de abajo) el punto salta a su eje o extremo.
    let hit = null;
    if (activeTool().magnet) {
        const m = magnet(app, wx, wy, gx, gy, step);
        gx = m.gx;
        gy = m.gy;
        hit = m.hit;
    }
    gx = Math.min(maxX, Math.max(0, gx));
    gy = Math.min(maxY, Math.max(0, gy));
    return { sx, sy, wx, wy, gx, gy, hit };
}

let pan = null;
let lastDown = null;
let spaceDown = false;

/*
 * En pantallas chicas el editor es de sólo lectura: sin herramientas ni paneles (los oculta el CSS con la misma
 * consulta), un dedo mueve la vista, dos dedos hacen zoom y un doble toque encuadra la casa.
 */
const narrow = window.matchMedia('(max-width: 760px)');
const readOnly = () => narrow.matches;
const touches = new Map();
let pinch = null;

function viewDown(e) {
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
        pan = null;
        return;
    }
    const now = performance.now();
    if (lastDown && now - lastDown.t < 350 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 24) {
        lastDown = null;
        fitView();
        return;
    }
    lastDown = { t: now, x: e.clientX, y: e.clientY };
    pan = { x: e.clientX, y: e.clientY };
}

function viewMove(e) {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = canvas.getBoundingClientRect();
        if (pinch.d > 0) cam.zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, planeZ());
        pinch.d = d;
        app.render();
    } else if (pan) {
        cam.pan(e.clientX - pan.x, e.clientY - pan.y, planeZ());
        pan = { x: e.clientX, y: e.clientY };
        app.render();
    }
}

function viewUp(e) {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    pan = null;
}

canvas.addEventListener('pointerdown', (e) => {
    if (readOnly()) {
        viewDown(e);
        return;
    }
    canvas.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && (spaceDown || e.altKey))) {
        e.preventDefault();
        pan = { x: e.clientX, y: e.clientY };
        canvas.classList.add('panning');
        canvas.setPointerCapture(e.pointerId);
        return;
    }
    if (e.button === 2) {
        activeTool().contextmenu?.();
        return;
    }
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const p = pointerInfo(e);
    app.pointer = p;
    // Los eventos de puntero no cuentan clics: el doble clic se detecta acá (dos pulsaciones cercanas en < 400 ms).
    const now = performance.now();
    const double = lastDown && now - lastDown.t < 400 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 8;
    lastDown = double ? null : { t: now, x: e.clientX, y: e.clientY };
    activeTool().down?.(p, { detail: double ? 2 : 1, shiftKey: e.shiftKey, altKey: e.altKey, button: e.button });
    app.render();
});

canvas.addEventListener('pointermove', (e) => {
    if (readOnly()) {
        viewMove(e);
        return;
    }
    if (pan) {
        cam.pan(e.clientX - pan.x, e.clientY - pan.y, planeZ());
        pan = { x: e.clientX, y: e.clientY };
        app.render();
        return;
    }
    const p = pointerInfo(e);
    app.pointer = p;
    $('#cursor-info').textContent = `x ${fmt(p.gx * G / 100, 3)} m · y ${fmt(p.gy * G / 100, 3)} m · nodo ${p.gx}, ${p.gy} · ${levelLabel()}`;
    activeTool().move?.(p, e);
    app.render();
});

canvas.addEventListener('pointercancel', viewUp);
canvas.addEventListener('pointerup', (e) => {
    if (readOnly()) {
        viewUp(e);
        return;
    }
    if (pan) {
        pan = null;
        canvas.classList.remove('panning');
        return;
    }
    if (e.button !== 0) return;
    const p = pointerInfo(e);
    activeTool().up?.(p, e);
    app.render();
});

canvas.addEventListener('pointerleave', () => {
    app.pointer = null;
    app.hover = null;
    app.render();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top, planeZ());
    app.render();
}, { passive: false });

/* ------------------------------------------------------------------ teclado */
document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.matches('input:not([type="checkbox"]):not([type="range"]), textarea, select') || t.isContentEditable);
    if (e.key === ' ' && !typing) {
        spaceDown = true;
        if (t === canvas) e.preventDefault();
    }
    if (typing || $('dialog[open]') || readOnly()) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
        return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
        // Ctrl+A: elegir toda la casa con la herramienta Mover
        e.preventDefault();
        setTool('move');
        app.selectAll();
        return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
        return;
    }
    if (mod) return;

    if (activeTool().keyDown?.(e)) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        app.deleteSelection();
    } else if (e.key === 'Escape') {
        store.setUi({ selection: null });
        setTool('select');
    } else if (e.key === 'Tab') {
        e.preventDefault();
        setView(store.ui.view === 'iso' ? 'plan' : 'iso');
    } else if (k === '[') rotate(-1);
    else if (k === ']') rotate(1);
    else if (k === 'f') fitView();
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-') zoomBy(0.8);
    else if (k === '1') setLevel(0);
    else if (k === '2') setLevel(1);
    else if (k === '3') setLevel(ROOF_LEVEL);
    else {
        const id = Object.entries(app.tools).find(([, tool]) => tool.hotkey === k)?.[0];
        if (id) setTool(id);
    }
});
document.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });

/* ------------------------------------------------------------------ herramientas, niveles, vista */
function setTool(id) {
    const tool = app.tools[id];
    if (!tool) return;
    if (id === 'roof' && store.ui.level !== ROOF_LEVEL) {
        setLevel(ROOF_LEVEL);
        return;
    }
    const reason = toolDisabled(tool);
    if (reason) {
        toast(reason, 'error');
        return;
    }
    activeTool().reset?.();
    store.setUi({ tool: id });
    app.hover = null;
    refreshOptions();
    renderToolbar();
    app.render();
}

/** Motivo por el que una herramienta no está disponible ahora (null si lo está). */
function toolDisabled(tool) {
    if (tool.id === 'roof') return null;
    if (store.ui.level === ROOF_LEVEL && tool.id !== 'select' && tool.id !== 'move') return 'En la pestaña Techo solo se dibujan y editan techos: volvé a un nivel para dibujar muros, losas o escaleras.';
    return tool.disabled?.() ?? null;
}

function refreshOptions() {
    const tool = activeTool();
    // En la pestaña Techo, tanto Seleccionar como Techo muestran las opciones del techo (elegido o de los nuevos).
    const opts = store.ui.level === ROOF_LEVEL ? app.roofOptions() : tool.options?.();
    const title = store.ui.level === ROOF_LEVEL ? 'Techo' : tool.label;
    add(clear($('#tooloptions')), h('span', { class: 'title' }, title), opts, h('span', { class: 'hint', title: tool.hint }, tool.hint));
    app.setHint(tool.hint);
}

function toolButton(id) {
    const tool = app.tools[id];
    const reason = toolDisabled(tool);
    const btn = h('button', {
        type: 'button',
        class: 'tool',
        'aria-pressed': String(store.ui.tool === id),
        title: `${tool.label}${tool.hotkey ? ` (${tool.hotkey.toUpperCase()})` : ''}${reason ? ` — ${reason}` : ''}`,
        'aria-label': tool.label,
        'aria-disabled': reason ? 'true' : null,
        onclick: () => setTool(id),
    }, h('span', { class: 'tool-name' }, tool.short));
    btn.insertAdjacentHTML('afterbegin', tool.icon); // ícono SVG estático (no proviene del usuario)
    return btn;
}

function renderToolbar() {
    const bar = clear($('#toolbar'));
    const set = TOOLSETS[store.ui.level] ?? TOOLSETS[0];
    for (const id of set.main) bar.append(toolButton(id));
    if (set.more.length) {
        const open = showMore || set.more.includes(store.ui.tool);
        bar.append(h('button', { type: 'button', class: 'tool-more', 'aria-expanded': String(open), onclick: () => { showMore = !open; renderToolbar(); } }, open ? 'Menos ▴' : 'Más ▾'));
        if (open) for (const id of set.more) bar.append(toolButton(id));
    }
}

let levelsKey = '';
function renderLevels() {
    const key = `${store.ui.level}:${store.project.upper}`;
    if (key === levelsKey) return;
    levelsKey = key;
    const wrap = clear($('#levels'));
    wrap.setAttribute('role', 'tablist');
    const tab = (i, name, title) => wrap.append(h('button', { type: 'button', role: 'tab', class: `level-tab${i === ROOF_LEVEL ? ' roof' : ''}`, 'aria-selected': String(store.ui.level === i), onclick: () => setLevel(i), title }, name));
    tab(0, 'Nivel 1', `${config.levelNames[0]} (1)`);
    if (store.project.upper) tab(1, 'Nivel 2', `${config.levelNames[1]} (2)`);
    tab(ROOF_LEVEL, 'Techo', 'Techo (3): a un agua o a dos aguas');
    if (!store.project.upper) {
        wrap.append(h('button', {
            type: 'button',
            class: 'level-tab add',
            title: 'Agrega la Planta Alta (Nivel 2); el techo pasa a ser el nivel superior. Máximo 2 niveles con muros autoportantes.',
            onclick: () => addLevel(),
        }, '+ Agregar nivel'));
    }
}

async function addLevel() {
    activeTool().reset?.();
    app.hover = null;
    await store.addUpper();
    if (activeTool().disabled?.()) store.setUi({ tool: 'select' });
    renderLevels();
    renderToolbar();
    refreshOptions();
    panels.renderAll();
    fitView();
    toast('Nivel 2 agregado. El techo ahora se apoya sobre él. Podés dibujar una losa (L) como piso.');
}

function setLevel(i) {
    if (i === 1 && !store.project.upper) {
        toast('Todavía no hay Nivel 2: usá «+ Agregar nivel».', 'error');
        return;
    }
    if (i === store.ui.level) return;
    activeTool().reset?.();
    store.setUi({ level: i, selection: null });
    app.hover = null;
    const set = TOOLSETS[i];
    if (i === ROOF_LEVEL) store.setUi({ tool: 'roof' });
    else if (![...set.main, ...set.more].includes(store.ui.tool) || toolDisabled(activeTool())) store.setUi({ tool: 'select' });
    renderLevels();
    renderToolbar();
    refreshOptions();
    panels.renderAll();
    if (i === ROOF_LEVEL) fitView();
    app.render();
}

function setView(view) {
    const anchor = app.pointer ? [app.pointer.sx, app.pointer.sy] : null;
    cam.setView(view, anchor, planeZ());
    store.setUi({ view });
    for (const b of $$('#view-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    renderViewPick();
    persistUi();
    app.render();
}

function rotate(steps) {
    cam.rotateBy(steps);
    renderViewPick();
    app.render();
}

/**
 * Selector de vistas: un cuadrado dividido en 4; cada cuarto es una de las 4 vistas isométricas (se mira la casa desde esa
 * esquina, en la dirección de la flecha). El ojo del centro sólo indica que es el selector de vista.
 */
const VIEW_CORNERS = [[1, 1], [1, -1], [-1, -1], [-1, 1]]; // giro 0..3: esquina desde la que mira la cámara (x, y en planta)
const CORNER_NAMES = ['abajo a la derecha', 'arriba a la derecha', 'arriba a la izquierda', 'abajo a la izquierda'];
const ARROW = (cx, cy) => {
    // flecha diagonal que apunta al centro de la casa desde la esquina
    const deg = (Math.atan2(-cy, -cx) * 180) / Math.PI;
    return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="transform:rotate(${deg}deg)"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};
function renderViewPick() {
    const el = $('#viewpick');
    if (!el) return;
    clear(el);
    // orden de la grilla 2×2: arriba-izq, arriba-der, abajo-izq, abajo-der
    for (const rot of [2, 1, 3, 0]) {
        const [cx, cy] = VIEW_CORNERS[rot];
        const active = cam.view !== 'plan' && cam.rot === rot;
        const btn = h('button', {
            type: 'button',
            class: `vp-q${active ? ' on' : ''}`,
            title: `Mirar la casa desde la esquina ${CORNER_NAMES[rot]}`,
            'aria-label': `Vista isométrica desde la esquina ${CORNER_NAMES[rot]}`,
            'aria-pressed': String(active),
            onclick: () => {
                if (cam.view === 'plan') setView('iso');
                cam.rotateBy((rot - cam.rot + 4) % 4);
                renderViewPick();
                app.render();
            },
        });
        btn.insertAdjacentHTML('afterbegin', ARROW(cx, cy));
        el.append(btn);
    }
    const eye = h('span', { class: 'vp-eye', 'aria-hidden': 'true' });
    eye.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2 12c3-5.5 17-5.5 20 0-3 5.5-17 5.5-20 0z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>');
    el.append(eye);
}

function zoomBy(f) {
    cam.zoomAt(f, cam.w / 2, cam.h / 2, planeZ());
    app.render();
}

function focusIssue(issue) {
    if (issue.level !== undefined && issue.level !== store.ui.level && (issue.level !== 1 || store.project.upper)) setLevel(issue.level);
    if (issue.x != null) {
        cam.cx = issue.x * G;
        cam.cy = issue.y * G;
    }
    const level = store.project.levels[issue.level ?? 0] ?? store.level();
    let selection = null;
    if (store.project.roofs?.some((x) => x.id === issue.ref)) selection = { type: 'roof', id: issue.ref };
    else if (level.slabs?.some((x) => x.id === issue.ref)) selection = { type: 'slab', id: issue.ref };
    else if (store.project.levels[0].stairs?.some((x) => x.id === issue.ref)) selection = { type: 'stair', id: issue.ref };
    else if (level.walls.some((w) => w.id === issue.ref)) selection = { type: 'wall', id: issue.ref };
    else if (level.openings.some((o) => o.id === issue.ref)) selection = { type: 'opening', id: issue.ref };
    else if (store.project.levels[0].timber.some((t) => t.id === issue.ref)) selection = { type: 'timber', id: issue.ref };
    store.setUi({ selection });
    app.render();
}

/* ------------------------------------------------------------------ superposiciones (selección, herramienta) */
function selectionBox(sel) {
    if (!sel) return null;
    const lv = store.level();
    const base = store.ui.level * config.levelHeight;
    if (sel.type === 'wall') {
        const w = lv.walls.find((x) => x.id === sel.id);
        if (!w) return null;
        const [x0, y0, x1, y1] = wallRect(w);
        return { x0, y0, x1, y1, z0: base, z1: base + (w.h ?? config.courses) * config.blockH };
    }
    if (sel.type === 'opening') {
        const o = lv.openings.find((x) => x.id === sel.id);
        const w = o && lv.walls.find((x) => x.id === o.wall);
        return o && w ? openingBox(w, o.pos, o.w, o.sill, o.h, base) : null;
    }
    if (sel.type === 'roof' || sel.type === 'gable') {
        const part = store.analysis?.roof?.parts?.find((p) => p.id === (sel.type === 'roof' ? sel.id : String(sel.id).split(':')[0]));
        if (!part || sel.type === 'gable') return null;
        const g = part.geometry;
        const r = roofOuter(g);
        return { ...r, z0: g.zTop - 10, z1: g.zTop + g.riseCm };
    }
    if (sel.type === 'slab') {
        const sl = store.analysis?.floors?.slabs?.find((x) => x.id === sel.id);
        return sl ? { x0: sl.rect.x, y0: sl.rect.y, x1: sl.rect.x + sl.rect.w, y1: sl.rect.y + sl.rect.h, z0: config.levelHeight, z1: config.levelHeight + sl.thickness } : null;
    }
    if (sel.type === 'stair') {
        const st = store.analysis?.floors?.stairs?.find((x) => x.id === sel.id);
        return st ? { x0: st.bbox.x, y0: st.bbox.y, x1: st.bbox.x + st.bbox.w, y1: st.bbox.y + st.bbox.h, z0: 0, z1: config.levelHeight } : null;
    }
    if (sel.type === 'timber') {
        const f = store.analysis?.timber?.fields?.find((x) => x.id === sel.id);
        if (f) return { x0: f.rect.x, y0: f.rect.y, x1: f.rect.x + f.rect.w, y1: f.rect.y + f.rect.h, z0: config.levelHeight, z1: config.levelHeight + 22 };
        const b = store.analysis?.timber?.beams?.find((x) => x.id === sel.id);
        if (b) return { x0: Math.min(b.x1, b.x2) - 4, y0: Math.min(b.y1, b.y2) - 4, x1: Math.max(b.x1, b.x2) + 4, y1: Math.max(b.y1, b.y2) + 4, z0: config.levelHeight, z1: config.levelHeight + 25 };
    }
    return null;
}

function overlay(ctx) {
    const hover = store.ui.tool === 'select' ? selectionBox(app.hover) : null;
    const sel = selectionBox(store.ui.selection);
    if (hover && JSON.stringify(app.hover) !== JSON.stringify(store.ui.selection)) wireBox(ctx, cam, hover, { stroke: 'rgba(30,41,59,.65)', width: 1.5, dash: [4, 3] });
    if (sel) wireBox(ctx, cam, sel, { stroke: '#8bc53f', width: 3 });
    drawSelectionExtras(ctx);
    activeTool().draw?.(ctx, cam);
    drawAssist(ctx);
}

/** Habitación elegida (piso resaltado) y hastial elegido (contorno). */
function drawSelectionExtras(ctx) {
    const sel = store.ui.selection;
    if (!sel) return;
    if (sel.type === 'room') {
        const room = store.analysis?.levels?.[store.ui.level]?.rooms?.find((r) => r.id === sel.id);
        if (!room?.fill) return;
        const z = store.ui.level * config.levelHeight;
        ctx.save();
        ctx.fillStyle = 'rgba(37,99,235,.20)';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        for (const [x, y, w, h] of room.fill) {
            const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => cam.project(a * G, b * G, z));
            ctx.beginPath();
            pts.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    } else if (sel.type === 'gable') {
        const gb = store.analysis?.roof?.parts?.flatMap((p) => p.geometry.gables).find((x) => x.id === sel.id);
        if (!gb) return;
        ctx.save();
        ctx.strokeStyle = '#8bc53f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        gb.pts.forEach((pt, i) => {
            const [sx, sy] = cam.project(pt[0], pt[1], pt[2]);
            if (i) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }
}

/** Ayudas de puntería: puntos de ajuste alrededor del cursor e imán a paredes. */
function drawAssist(ctx) {
    const tool = activeTool();
    const p = app.pointer;
    if (!tool.magnet || !p) return;
    const z = planeZ();
    snapDots(ctx, cam, p.gx, p.gy, store.ui.snap, z);
    if (p.hit) magnetHit(ctx, cam, p.hit, p.hit.wall, p.gx, p.gy, z);
}

/* ------------------------------------------------------------------ dibujo */
/** Todo lo que cambia el contenido de la capa estática (salvo la cámara, que la agrega el renderer). */
function sceneKey() {
    const { level, cut, snap, solar } = store.ui;
    const s = store.ui.solar.show ? store.sun() : null;
    const p = store.project;
    return [sceneVersion, level, cut, snap, solar.show, store.ui.showLot, store.ui.showGrid, s ? `${s.alt.toFixed(2)}:${s.az.toFixed(2)}` : '-', p.north, p.lot.w, p.lot.d].join(',');
}

function draw() {
    if (store.analysis && sceneFor !== store.analysis) {
        scene = buildScene(store.project, store.analysis, config);
        sceneFor = store.analysis;
        sceneVersion++;
    }
    renderer.draw({
        cam,
        project: store.project,
        analysis: store.analysis ?? { levels: [], timber: null },
        scene: store.analysis ? scene : null,
        ui: store.ui,
        sun: store.ui.solar.show ? store.sun() : null,
        sceneKey: sceneKey(),
        overlay,
    });
}

(function frame() {
    if (dirty) {
        dirty = false;
        draw();
    }
    requestAnimationFrame(frame);
})();

/* ------------------------------------------------------------------ eventos del store */
store.addEventListener('change', () => {
    renderLevels();
    guide.render();
    panels.renderAll();
    updateHistoryButtons();
    if (store.ui.tool !== 'select' || store.ui.level === ROOF_LEVEL) refreshOptions();
    app.render();
});
let contextKey = '';
store.addEventListener('ui', (e) => {
    // La hora y la época del sol sólo cambian el dibujo: no se redibujan los paneles (cortaría el arrastre del deslizador).
    const keys = Object.keys(e.detail ?? {});
    if (keys.some((k) => k === 'showLot' || k === 'showGrid')) persistUi();
    if (keys.length && keys.every((k) => k === 'solar' || k === 'showLot' || k === 'showGrid')) {
        app.render();
        return;
    }
    renderLevels();
    renderViewPick();
    guide.render();
    panels.renderProps();
    // El Resumen y la Revisión cambian con la herramienta o lo elegido (no con cada cambio de la hora del sol).
    const k = `${store.ui.tool}|${JSON.stringify(store.ui.selection)}|${store.ui.level}`;
    if (k !== contextKey) {
        contextKey = k;
        panels.renderContext();
    }
    updateHistoryButtons();
    renderToolbar();
    app.render();
});
store.addEventListener('solar', () => { panels.syncSolar(); app.render(); });
store.addEventListener('status', () => { $('#req-status').textContent = store.pending ? 'Calculando…' : ''; });
store.addEventListener('toast', (e) => toast(e.detail.message, e.detail.kind));

function updateHistoryButtons() {
    $('#btn-undo').disabled = !store.history.length;
    $('#btn-redo').disabled = !store.future.length;
    const name = $('#project-name');
    if (document.activeElement !== name) name.value = store.project.name;
}

/* ------------------------------------------------------------------ controles de la barra */
for (const b of $$('#view-toggle button')) b.addEventListener('click', () => setView(b.dataset.view));
$('#zoom-in').addEventListener('click', () => zoomBy(1.25));
$('#zoom-out').addEventListener('click', () => zoomBy(0.8));
$('#zoom-fit').addEventListener('click', fitView);
$('#cut').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    store.setUi({ cut: v }, { silent: true });
    $('#cut-out').textContent = v >= config.courses ? 'todo' : `${fmt((v * config.blockH) / 100, 2)} m`;
    app.render();
});
$('#btn-undo').addEventListener('click', () => store.undo());
$('#btn-redo').addEventListener('click', () => store.redo());
$('#project-name').addEventListener('change', (e) => store.patchProject({ name: e.target.value.trim() || 'Proyecto sin título' }));

$('#btn-save').addEventListener('click', () => {
    downloadBlob(new Blob([JSON.stringify(store.project, null, 2)], { type: 'application/json' }), `${slug(store.project.name)}.blockk.json`);
});
$('#btn-open').addEventListener('click', () => $('#file-open').click());
$('#file-open').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.levels)) throw new Error('el archivo no es un proyecto de Blockk');
        await store.load(data);
        fitView();
        toast(`Proyecto «${store.project.name}» abierto.`);
    } catch (err) {
        toast(`No se pudo abrir el archivo: ${err.message}`, 'error');
    }
});

const dlg = $('#dlg-new');
$('#btn-new').addEventListener('click', () => {
    const hasContent = store.project.levels.some((l) => l.walls.length);
    if (hasContent && !window.confirm('Se reemplazará el proyecto actual (podés guardarlo antes). ¿Continuar?')) return;
    dlg.showModal();
});
$('#new-cancel').addEventListener('click', () => dlg.close());
$('#form-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    dlg.close();
    await store.load(blankProject({ name: String(f.name).trim() || 'Proyecto sin título', lotW: Number(f.lotW), lotD: Number(f.lotD), t: Number(f.t), lat: Number(f.lat) }));
    fitView();
    store.ensureSolar();
});

/* ------------------------------------------------------------------ arranque */
(async function boot() {
    try {
        const ui = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}');
        if (ui.view) store.setUi({ view: ui.view }, { silent: true });
        if (ui.showLot === false) store.setUi({ showLot: false }, { silent: true });
        if (ui.showGrid === false) store.setUi({ showGrid: false }, { silent: true });
    } catch { /* ok */ }
    cam.view = store.ui.view;
    for (const b of $$('#view-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === store.ui.view));

    renderViewPick();
    renderLevels();
    renderToolbar();
    refreshOptions();
    resize();

    const saved = loadProject() ?? blankProject();
    await store.load(saved);
    // En sólo lectura se muestra la casa completa, con techo.
    if (readOnly() && store.project.levels.some((l) => l.walls.length)) setLevel(ROOF_LEVEL);
    fitView();
    store.ensureSolar();
    if (!readOnly()) canvas.focus({ preventScroll: true });
    saveProject(store.project);
})();
