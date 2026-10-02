import { $, $$ } from '../lib/dom.js';
import { template } from '../lib/api.js';
import { saveProject, blankProject, loadProject } from '../lib/storage.js';
import { mountAssistant } from './assistant.js';
import { carousel } from '../lib/carousel.js';
import { renderThumbs } from '../editor/snapshot.js';
import { mountHouses } from './houses.js';
import { linkHouse } from '../lib/houses.js';

const config = JSON.parse($('#blockk-config').textContent);

/* Planta e isométrica de cada plantilla (imágenes pregeneradas). */
for (const el of $$('[data-carousel]')) carousel(el);

/* Para bin/miniaturas.cjs: dibuja las vistas con el mismo renderer del editor. */
window.blockkThumbs = (opts) => renderThumbs({ config, ...opts });

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

/**
 * Antes de pisar el proyecto del editor (plantilla, proyecto en blanco o asistente), se avisa si ya hay algo dibujado.
 * Devuelve true si se puede seguir.
 */
export function confirmReplace() {
    const current = loadProject();
    if (!current?.levels?.some((l) => l.walls?.length)) return Promise.resolve(true);
    const dlg = $('#confirm-replace');
    $('#confirm-text').textContent = `Vas a reemplazar «${current.name || 'Proyecto sin título'}», el proyecto que tenés en el editor. Si lo querés conservar, cancelá y guardalo con «Guardar» en el editor.`;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

/* Usar una plantilla: se guarda como proyecto actual y se abre el editor. */
for (const btn of $$('[data-use]')) {
    btn.addEventListener('click', async () => {
        if (!(await confirmReplace())) return;
        btn.disabled = true;
        try {
            saveProject(await template(btn.dataset.use));
            linkHouse(null); // proyecto nuevo: ya no es ninguna de las casas guardadas
            location.href = '/';
        } catch (err) {
            btn.disabled = false;
            alert(`No se pudo cargar la plantilla: ${err.message}`);
        }
    });
}

/* Proyecto en blanco con retícula inicial parametrizable. */
$('#blank-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await confirmReplace())) return;
    const f = Object.fromEntries(new FormData(e.target));
    saveProject(blankProject({ name: String(f.name).trim() || 'Proyecto sin título', lotW: Number(f.lotW), lotD: Number(f.lotD), t: Number(f.t), north: Number(f.north) }));
    linkHouse(null);
    location.href = '/';
});

/* Mis casas: las que este navegador guardó desde el editor. */
mountHouses({ section: $('#my-houses'), confirmReplace });

/* Asistente de diseño por chat (sólo si el servidor lo tiene configurado). */
if ($('#ai')) mountAssistant({ card: $('#ai'), dialog: $('#ai-dialog'), confirmReplace });
