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
import { wireBox } from './overlay.js';
import { wallRect, G } from './pick.js';

const config = JSON.parse($('#blockk-config').textContent);
const store = new Store(config);
const canvas = $('#canvas');
const stage = $('#stage');
const cam = new Camera();
const renderer = new Renderer(canvas);

const UI_KEY = 'blockk.ui.v1';
const TOOL_ORDER = ['select', 'room', 'wall', 'block', '|', 'door', 'window', 'ubeam', '|', 'floor', 'beam'];

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
/** Plano horizontal de trabajo: el del nivel activo; el entrepiso y las vigas se dibujan sobre la corona de PB. */
const planeZ = () => activeTool().planeZ?.() ?? store.ui.level * config.levelHeight;

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
        zTop = config.levelHeight * (store.ui.level + 1);
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
    gx = Math.min(maxX, Math.max(0, gx));
    gy = Math.min(maxY, Math.max(0, gy));
    return { sx, sy, wx, wy, gx, gy };
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
    $('#cursor-info').textContent = `x ${fmt(p.gx * G / 100, 3)} m · y ${fmt(p.gy * G / 100, 3)} m · nodo ${p.gx}, ${p.gy} · ${config.levelShort[store.ui.level]}`;
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
    const reason = tool.disabled?.();
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

function refreshOptions() {
    const tool = activeTool();
    add(clear($('#tooloptions')), h('span', { class: 'title' }, tool.label), tool.options?.(), h('span', { class: 'hint', title: tool.hint }, tool.hint));
    app.setHint(tool.hint);
}

function renderToolbar() {
    const bar = clear($('#toolbar'));
    for (const id of TOOL_ORDER) {
        if (id === '|') {
            bar.append(h('div', { class: 'tool-sep' }));
            continue;
        }
        const tool = app.tools[id];
        const reason = tool.disabled?.();
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

function renderLevels() {
    const wrap = clear($('#levels'));
    wrap.setAttribute('role', 'tablist');
    config.levelNames.forEach((name, i) => {
        wrap.append(h('button', { type: 'button', role: 'tab', class: 'level-tab', 'aria-selected': String(store.ui.level === i), onclick: () => setLevel(i), title: `${name} (${i + 1})` }, name));
    });
    // El tercer nivel está inhabilitado de forma permanente: la mampostería autoportante HCCA no lo admite.
    wrap.append(h('button', {
        type: 'button',
        class: 'level-tab locked',
        'aria-disabled': 'true',
        title: 'Límite de carga autoportante: PB + PA ≤ 6,00 m. Un tercer nivel requiere estructura independiente de hormigón armado o metálica.',
        onclick: () => toast('Límite de carga autoportante: la mampostería HCCA admite como máximo 2 niveles (PB + PA ≤ 6,00 m). Un tercer nivel requiere una estructura independiente de hormigón armado o metálica.', 'error'),
    }, '+ Nivel 3', h('span', { class: 'lock', 'aria-hidden': 'true' }, '🔒')));
}

function setLevel(i) {
    if (i === store.ui.level) return;
    activeTool().reset?.();
    store.setUi({ level: i, selection: null });
    app.hover = null;
    if (activeTool().disabled?.()) store.setUi({ tool: 'select' });
    renderLevels();
    renderToolbar();
    refreshOptions();
    panels.renderAll();
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
    if (issue.level !== undefined && issue.level !== store.ui.level) setLevel(issue.level);
    if (issue.x != null) {
        cam.cx = issue.x * G;
        cam.cy = issue.y * G;
    }
    const level = store.project.levels[issue.level ?? 0];
    let selection = null;
    if (level.walls.some((w) => w.id === issue.ref)) selection = { type: 'wall', id: issue.ref };
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
    panels.renderAll();
    updateHistoryButtons();
    if (store.ui.tool !== 'select') refreshOptions();
    app.render();
});
store.addEventListener('ui', () => {
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
