import { $, h, add, clear } from '../lib/dom.js';
import { loadProject, saveProject } from '../lib/storage.js';
import { analyze, solarPath } from '../lib/api.js';
import { downloadBlob, slug } from '../lib/download.js';
import { renderView } from '../editor/snapshot.js';
import { planList, buildPlanos } from './planos.js';

const config = JSON.parse($('#blockk-config').textContent);
const root = $('#planos-root');
const btn = $('#btn-planos');
let state = null;

const GROUPS = [
    ['cover', 'Portada'],
    ['plan', 'Plantas'],
    ['roofs', 'Techos'],
    ['wall', 'Muros (alzado hilada por hilada)'],
    ['materials', 'Materiales'],
];

async function boot() {
    const saved = loadProject();
    if (!saved || !saved.levels.some((l) => l.walls?.length)) {
        add(clear(root),
            h('h1', {}, 'Planos'),
            h('div', { class: 'notice' }, 'Todavía no hay muros en el proyecto actual.'),
            h('p', {}, h('a', { class: 'btn btn-primary', href: '/' }, 'Ir al editor'), ' ', h('a', { class: 'btn btn-outline', href: '/galeria' }, 'Elegir una plantilla')));
        return;
    }
    try {
        const res = await analyze(saved);
        saveProject(res.project);
        state = { project: res.project, analysis: res.analysis };
        render();
        btn.disabled = false;
    } catch (err) {
        add(clear(root), h('div', { class: 'notice error' }, `No se pudieron calcular los planos: ${err.message}`));
    }
}

function render() {
    const items = planList(state.project, state.analysis, config);
    items.forEach((it, i) => { it.page = i + 1; });
    add(clear(root),
        h('header', { class: 'page-head' },
            h('h1', {}, 'Planos'),
            h('p', { class: 'lead' }, `${state.project.name} · ${items.length} planos en un PDF: una planta por nivel, un alzado por muro con el corte de cada bloque y la lista de materiales.`)),
        ...GROUPS.map(([kind, title]) => {
            const list = items.filter((it) => it.kind === kind);
            if (!list.length) return null;
            return h('section', { class: 'card planos-group' },
                h('h2', {}, title, h('span', { class: 'muted' }, ` · ${list.length}`)),
                h('ol', { class: 'planos-list' }, ...list.map((it) => h('li', {},
                    h('span', { class: 'planos-page' }, `Hoja ${it.page}`),
                    h('b', {}, it.title),
                    h('span', { class: 'muted' }, it.detail)))));
        }),
        h('p', {}, h('button', { type: 'button', class: 'btn btn-primary', onclick: generate }, 'Generar planos (PDF)')));
}

async function isometric() {
    let path = null;
    try {
        path = (await solarPath(state.project.lat, 'winter', state.project.lon ?? -58.4, state.project.tz ?? -3)).path;
    } catch { /* sin sol: la isométrica igual sale */ }
    const [w, h2] = [1040, 650];
    const canvas = renderView('iso', { project: state.project, analysis: state.analysis, config, solarPath: path, width: w, height: h2 });
    return { url: canvas.toDataURL('image/jpeg', 0.9), w, h: h2 };
}

async function generate() {
    if (!state) return;
    const buttons = [btn, ...root.querySelectorAll('button')];
    buttons.forEach((b) => { b.disabled = true; });
    const old = btn.textContent;
    btn.textContent = 'Generando…';
    try {
        let iso = null;
        try {
            iso = await isometric();
        } catch { /* la portada sale sin imagen */ }
        const blob = buildPlanos(state.project, state.analysis, config, iso);
        downloadBlob(blob, `planos-${slug(state.project.name)}.pdf`);
    } catch (err) {
        add(root, h('div', { class: 'notice error' }, `No se pudieron generar los planos: ${err.message}`));
    } finally {
        btn.textContent = old;
        buttons.forEach((b) => { b.disabled = false; });
    }
}

btn.addEventListener('click', generate);
boot();
