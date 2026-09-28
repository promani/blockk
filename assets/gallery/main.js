import { $, $$ } from '../lib/dom.js';
import { template } from '../lib/api.js';
import { saveProject, blankProject } from '../lib/storage.js';

/* Filtros por etiqueta (1 planta, 2 plantas, evolutiva, quinchos, bajo descarte). */
const chips = $$('.chip[data-filter]');
for (const chip of chips) {
    chip.addEventListener('click', () => {
        for (const c of chips) c.setAttribute('aria-pressed', String(c === chip));
        const filter = chip.dataset.filter;
        for (const card of $$('.tcard')) {
            const tags = card.dataset.tags.split('|');
            card.hidden = filter !== 'all' && !tags.includes(filter);
        }
    });
}

/* Usar una plantilla: se guarda como proyecto actual y se abre el editor. */
for (const btn of $$('[data-use]')) {
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            saveProject(await template(btn.dataset.use));
            location.href = '/';
        } catch (err) {
            btn.disabled = false;
            alert(`No se pudo cargar la plantilla: ${err.message}`);
        }
    });
}

/* Proyecto en blanco con retícula inicial parametrizable. */
$('#blank-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    saveProject(blankProject({ name: String(f.name).trim() || 'Proyecto sin título', lotW: Number(f.lotW), lotD: Number(f.lotD), t: Number(f.t), north: Number(f.north) }));
    location.href = '/';
});
