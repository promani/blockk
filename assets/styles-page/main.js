import { $, h, add, clear } from '../lib/dom.js';
import { PRESETS, FIELDS, currentTheme, saveTheme, resetTheme } from '../lib/theme.js';
import { analyze, solarPath, template } from '../lib/api.js';
import { renderView } from '../editor/snapshot.js';

/* Estilos del sitio: paletas, colores sueltos y vista previa con el mismo dibujo del editor. */
const config = JSON.parse($('#blockk-config').textContent);
let theme = currentTheme();
let overrides = {};
try {
    overrides = JSON.parse(localStorage.getItem('blockk.theme.v1') ?? '{}')?.colors ?? {};
} catch { /* ok */ }

let sample = null;
async function loadSample() {
    const project = await template('casa-en-l');
    const [result, solar] = await Promise.all([analyze(project), solarPath(project.lat ?? -34.6, 'winter').catch(() => null)]);
    sample = { project: result.project, analysis: result.analysis, config, solarPath: solar?.path };
    drawPreview();
}

let raf = 0;
function drawPreview() {
    if (!sample) return;
    window.cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
        for (const [id, view] of [['#prev-iso', 'iso'], ['#prev-plan', 'plan']]) {
            const c = $(id);
            c.getContext('2d').drawImage(renderView(view, { ...sample, width: c.width, height: c.height }), 0, 0);
        }
    });
}

function update(key, value) {
    overrides = { ...overrides, [key]: value };
    theme = saveTheme(theme.preset, overrides);
    renderForm();
    drawPreview();
}

function renderForm() {
    clear($('#presets'));
    for (const [id, p] of Object.entries(PRESETS)) {
        add($('#presets'), h('button', {
            type: 'button', class: 'preset', 'aria-pressed': String(theme.preset === id && !Object.keys(overrides).length),
            onclick: () => { overrides = {}; theme = saveTheme(id, {}); renderForm(); drawPreview(); },
        }, h('span', { class: 'swatches', 'aria-hidden': 'true' }, [p.accent, p.roof, p.block, p.ground, p.floors[0], p.floors[1]].map((c) => h('i', { style: `background:${c}` }))), p.name));
    }
    clear($('#fields'));
    for (const [group, fields] of FIELDS) {
        add($('#fields'), h('h3', {}, group), h('div', { class: 'color-list' }, fields.map(([key, label]) => h('label', { class: 'color-field' },
            h('input', { type: 'color', value: theme[key], oninput: (e) => update(key, e.target.value) }), label))));
    }
    clear($('#floors'));
    add($('#floors'), theme.floors.map((c, i) => h('label', { class: 'color-field compact', title: `Piso ${i + 1}` },
        h('input', { type: 'color', value: c, 'aria-label': `Color de piso ${i + 1}`, oninput: (e) => { const f = [...theme.floors]; f[i] = e.target.value; update('floors', f); } }))));
}

$('#reset').addEventListener('click', () => {
    overrides = {};
    theme = resetTheme();
    renderForm();
    drawPreview();
});
$('#copy').addEventListener('click', async () => {
    const text = JSON.stringify({ preset: theme.preset, colors: overrides });
    try {
        await navigator.clipboard.writeText(text);
        $('#copy-out').textContent = 'Configuración copiada.';
    } catch {
        $('#copy-out').textContent = text;
    }
});

renderForm();
loadSample().catch(() => { $('#copy-out').textContent = 'No se pudo cargar la vista previa.'; });
