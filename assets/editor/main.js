import { $, $$, h, add, clear } from '../lib/dom.js';
import { fmt } from '../lib/format.js';
import { loadProject, saveProject, blankProject } from '../lib/storage.js';
import { downloadBlob, slug } from '../lib/download.js';
import { Store } from './store.js';
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { buildScene } from './scene.js';
import { createTools, openingBox } from './tools.js';
import { mountPanels } from './panels.js';
import { wireBox, snapDots, magnetHit } from './overlay.js';
import { magnet } from './snap.js';
import { wallRect, G } from './pick.js';

const config = JSON.parse($('#blockk-config').textContent);
const store = new Store(config);
const canvas = $('#canvas');
const stage = $('#stage');
const cam = new Camera();
const renderer = new Renderer(canvas);

const UI_KEY = 'blockk.ui.v1';
const TOOL_ORDER = ['select', 'room', 'wall', 'block', '|', 'door', 'window', 'ubeam', '|', 'floor', 'beam', '|', 'slab', 'stair'];
const ROOF_LEVEL = 2;

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
    toast,
    focusIssue,
    setHint: (t) => { $('#hint-info').textContent = t; },
};
window.blockk = app; // útil para depurar y para pruebas end-to-end
app.renderer = renderer;
app.draw = () => draw(); // dibujo síncrono (mediciones de rendimiento)

app.tools = createTools(app);
const panels = mountPanels(app);

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
        localStorage.setItem(UI_KEY, JSON.stringify({ view: store.ui.view, snap: store.ui.snap }));
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
    if (walls.length) {
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
    const step = store.ui.snap;
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
let spaceDown = false;

canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    $('#welcome').hidden = true;
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
    activeTool().down?.(p, e);
    app.render();
});

canvas.addEventListener('pointermove', (e) => {
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

canvas.addEventListener('pointerup', (e) => {
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
    if (typing || $('dialog[open]')) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
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
    if (store.ui.level === ROOF_LEVEL && tool.id !== 'select') return 'En la pestaña Techo solo se elige y edita el techo: volvé a un nivel para dibujar.';
    return tool.disabled?.() ?? null;
}

function refreshOptions() {
    if (store.ui.level === ROOF_LEVEL) {
        const hint = 'Elegí el tipo de techo y ajustá pendiente y alero. Se apoya sobre el último nivel con muros.';
        add(clear($('#tooloptions')), h('span', { class: 'title' }, 'Techo'), roofOptions(), h('span', { class: 'hint', title: hint }, hint));
        app.setHint(hint);
        return;
    }
    const tool = activeTool();
    add(clear($('#tooloptions')), h('span', { class: 'title' }, tool.label), tool.options?.(), h('span', { class: 'hint', title: tool.hint }, tool.hint));
    app.setHint(tool.hint);
}

const FALL_SIDES = [['S', 'Sur (abajo)'], ['N', 'Norte (arriba)'], ['E', 'Este (derecha)'], ['W', 'Oeste (izquierda)']];

/** Lado largo del rectángulo que envuelve al último nivel con muros: por defecto la cumbrera va paralela a él. */
function longerAxis() {
    const walls = store.project.levels[store.topLevel].walls;
    if (!walls.length) return 'x';
    const w = Math.max(...walls.map((x) => x.x2)) - Math.min(...walls.map((x) => x.x1));
    const d = Math.max(...walls.map((x) => x.y2)) - Math.min(...walls.map((x) => x.y1));
    return w >= d ? 'x' : 'y';
}

function roofOptions() {
    const r = store.project.roof ?? { type: 'none', dir: 'x', slope: 30, overhang: 40, section: '3x8', spacing: 50 };
    const set = (label, patch) => store.commit(label, (d) => { d.roof = { ...d.roof, ...patch }; });
    const sel = (label, value, items, onChange) =>
        h('label', { class: 'field-inline' }, label, h('select', { onchange: (e) => onChange(e.target.value) }, items.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))));
    const numIn = (label, value, min, max, step, onChange, unit) =>
        h('label', { class: 'field-inline' }, label, h('input', { type: 'number', value, min, max, step, class: 'w-narrow', onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); } }), unit);
    const types = h('span', { class: 'seg', role: 'group', 'aria-label': 'Tipo de techo' }, [['none', 'Sin techo'], ['shed', 'A un agua'], ['gable', 'A dos aguas']].map(([v, t]) =>
        h('button', {
            type: 'button',
            class: 'seg-btn',
            'aria-pressed': String(r.type === v),
            onclick: () => set('Tipo de techo', { type: v, dir: v === 'shed' ? (r.type === 'shed' ? r.dir : 'S') : v === 'gable' ? (['x', 'y'].includes(r.dir) ? r.dir : longerAxis()) : r.dir }),
        }, t)));
    if (r.type === 'none') return h('span', { class: 'row' }, types);

    return h('span', { class: 'row' }, types,
        r.type === 'gable'
            ? sel('Cumbrera', r.dir, [['x', '↔ horizontal'], ['y', '↕ vertical']], (v) => set('Dirección de cumbrera', { dir: v }))
            : sel('Cae hacia', r.dir, FALL_SIDES, (v) => set('Caída del techo', { dir: v })),
        numIn('Pendiente', r.slope, 10, 100, 5, (v) => set('Pendiente', { slope: v }), '%'),
        numIn('Alero', r.overhang, 0, 100, 5, (v) => set('Alero', { overhang: v }), 'cm'),
        sel('Cabios', r.section, Object.entries(config.timberSections).map(([k, x]) => [k, x.label.replace('Pino tratado ', '')]), (v) => set('Sección de cabios', { section: v })),
        sel('Separación', r.spacing, [30, 40, 50, 60].map((v) => [v, `${v} cm`]), (v) => set('Separación de cabios', { spacing: Number(v) })));
}

function renderToolbar() {
    const bar = clear($('#toolbar'));
    for (const id of TOOL_ORDER) {
        if (id === '|') {
            bar.append(h('div', { class: 'tool-sep' }));
            continue;
        }
        const tool = app.tools[id];
        const reason = toolDisabled(tool);
        const btn = h('button', {
            type: 'button',
            class: 'tool',
            'aria-pressed': String(store.ui.tool === id),
            title: `${tool.label} (${tool.hotkey.toUpperCase()})${reason ? ` — ${reason}` : ''}`,
            'aria-label': tool.label,
            disabled: Boolean(reason),
            onclick: () => setTool(id),
        }, h('kbd', {}, tool.hotkey.toUpperCase()));
        btn.insertAdjacentHTML('afterbegin', tool.icon); // ícono SVG estático (no proviene del usuario)
        bar.append(btn);
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
    tab(0, config.levelNames[0], `${config.levelNames[0]} (1)`);
    if (store.project.upper) tab(1, config.levelNames[1], `${config.levelNames[1]} (2)`);
    tab(ROOF_LEVEL, config.levelNames[ROOF_LEVEL], 'Techo (3): a un agua o a dos aguas');
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
    if (toolDisabled(activeTool())) store.setUi({ tool: 'select' });
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
    persistUi();
    app.render();
}

function rotate(steps) {
    cam.rotateBy(steps);
    app.render();
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
    if (level.slabs?.some((x) => x.id === issue.ref)) selection = { type: 'slab', id: issue.ref };
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
        return { x0, y0, x1, y1, z0: base, z1: base + config.levelHeight };
    }
    if (sel.type === 'opening') {
        const o = lv.openings.find((x) => x.id === sel.id);
        const w = o && lv.walls.find((x) => x.id === o.wall);
        return o && w ? openingBox(w, o.pos, o.w, o.sill, o.h, base) : null;
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
    activeTool().draw?.(ctx, cam);
    drawAssist(ctx);
}

/** Ayudas de puntería: puntos de ajuste alrededor del cursor e imán a paredes. */
function drawAssist(ctx) {
    const tool = activeTool();
    const p = app.pointer;
    if (!tool.magnet || !p || store.ui.level === ROOF_LEVEL) return;
    const z = planeZ();
    snapDots(ctx, cam, p.gx, p.gy, store.ui.snap, z);
    if (p.hit) {
        const w = p.hit.wall;
        const [x0, y0, x1, y1] = wallRect(w);
        const base = p.hit.level * config.levelHeight;
        magnetHit(ctx, cam, p.hit, { x0, y0, x1, y1, z0: base, z1: base + config.levelHeight }, p.gx, p.gy, z);
    }
}

/* ------------------------------------------------------------------ dibujo */
/** Todo lo que cambia el contenido de la capa estática (salvo la cámara, que la agrega el renderer). */
function sceneKey() {
    const { level, cut, snap, solar } = store.ui;
    const s = store.ui.solar.show ? store.sun() : null;
    const p = store.project;
    return [sceneVersion, level, cut, snap, solar.show, s ? `${s.alt.toFixed(2)}:${s.az.toFixed(2)}` : '-', p.north, p.lot.w, p.lot.d].join(',');
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
    panels.renderAll();
    updateHistoryButtons();
    if (store.ui.tool !== 'select' || store.ui.level === ROOF_LEVEL) refreshOptions();
    app.render();
});
store.addEventListener('ui', () => {
    renderLevels();
    panels.renderProps();
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
$('#rot-left').addEventListener('click', () => rotate(-1));
$('#rot-right').addEventListener('click', () => rotate(1));
$('#zoom-in').addEventListener('click', () => zoomBy(1.25));
$('#zoom-out').addEventListener('click', () => zoomBy(0.8));
$('#zoom-fit').addEventListener('click', fitView);
$('#snap').addEventListener('change', (e) => { store.setUi({ snap: Number(e.target.value) }); persistUi(); app.render(); });
$('#cut').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    store.setUi({ cut: v }, { silent: true });
    $('#cut-out').textContent = `${v}/${config.courses}`;
    app.render();
});
$('#btn-undo').addEventListener('click', () => store.undo());
$('#btn-redo').addEventListener('click', () => store.redo());
$('#project-name').addEventListener('change', (e) => store.patchProject({ name: e.target.value.trim() || 'Proyecto sin título' }));
$('#welcome-close').addEventListener('click', () => {
    $('#welcome').hidden = true;
    try { localStorage.setItem('blockk.welcome', '1'); } catch { /* ok */ }
});

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
        if (ui.snap) store.setUi({ snap: ui.snap }, { silent: true });
        if (ui.view) store.setUi({ view: ui.view }, { silent: true });
    } catch { /* ok */ }
    $('#snap').value = String(store.ui.snap);
    cam.view = store.ui.view;
    for (const b of $$('#view-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === store.ui.view));

    renderLevels();
    renderToolbar();
    refreshOptions();
    resize();

    const saved = loadProject() ?? blankProject();
    await store.load(saved);
    fitView();
    store.ensureSolar();
    if (!store.project.levels.some((l) => l.walls.length)) {
        let seen = false;
        try { seen = localStorage.getItem('blockk.welcome') === '1'; } catch { /* ok */ }
        $('#welcome').hidden = seen;
    }
    canvas.focus({ preventScroll: true });
    saveProject(store.project);
})();
