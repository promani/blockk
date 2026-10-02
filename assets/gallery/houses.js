/**
 * «Mis casas» en la Galería: las casas que este navegador guardó desde el editor (nadie más las ve). Cada una se abre
 * en el editor o se elimina. Si no hay ninguna, la sección no se muestra.
 */
import { $, h, add, clear } from '../lib/dom.js';
import { fmt, int } from '../lib/format.js';
import { listHouses, deleteHouse, linkedHouse, linkHouse } from '../lib/houses.js';

const date = (seconds) => new Date(seconds * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

export async function mountHouses({ section, confirmReplace }) {
    const grid = $('.cards', section);

    function card(c) {
        const s = c.summary;
        return h('article', { class: 'tcard card', dataset: { house: c.id } },
            // la miniatura es un SVG del servidor: va como imagen, sin insertar HTML
            h('div', { class: 'thumb' }, h('img', { class: 'house-thumb', alt: `Planta de ${c.name}`, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}` })),
            h('div', { class: 'tcard-body' },
                h('h3', {}, c.name),
                h('p', { class: 'muted small' }, `Guardada el ${date(c.updated)}`),
                h('dl', { class: 'metrics' },
                    h('div', {}, h('dt', {}, 'Sup. útil'), h('dd', {}, `${fmt(s.superficieUtilM2, 1)} m²`)),
                    h('div', {}, h('dt', {}, 'Bloques'), h('dd', {}, int(s.bloques))),
                    h('div', {}, h('dt', {}, `Ref. (${s.moneda})`), h('dd', {}, int(s.costoReferencia)))),
                h('div', { class: 'tcard-actions' },
                    h('button', {
                        type: 'button',
                        class: 'btn btn-primary',
                        onclick: async () => {
                            // la casa que ya está abierta en el editor no se vuelve a cargar: puede tener cambios sin guardar
                            if (linkedHouse() !== c.id && !(await confirmReplace())) return;
                            location.href = `/?casa=${c.id}&ok=1`;
                        },
                    }, 'Abrir'),
                    h('button', {
                        type: 'button',
                        class: 'btn btn-outline',
                        onclick: async () => {
                            if (!window.confirm(`¿Eliminar «${c.name}» de tus casas guardadas?`)) return;
                            try {
                                await deleteHouse(c.id);
                                if (linkedHouse() === c.id) linkHouse(null);
                                await render();
                            } catch (e) {
                                window.alert(`No se pudo eliminar: ${e.message}`);
                            }
                        },
                    }, 'Eliminar'))));
    }

    async function render() {
        let list = [];
        try {
            list = await listHouses();
        } catch {
            /* sin servidor de casas: la sección queda oculta */
        }
        clear(grid);
        add(grid, list.map(card));
        section.hidden = list.length === 0;
    }

    await render();
}
