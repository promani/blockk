/**
 * «Mis casas» en la Galería: las casas que este navegador guardó desde el editor (nadie más las ve). Cada una se abre
 * en el editor, se renombra o se elimina; con dos elegidas se comparan lado a lado (/comparar) y con un código de un
 * solo uso se llevan a otro navegador (`/galeria?traer=<código>`). Si no hay ninguna, la sección no se muestra.
 */
import { $, h, add, clear } from '../lib/dom.js';
import { fmt, int } from '../lib/format.js';
import { listHouses, deleteHouse, renameHouse, createTransfer, claimTransfer, linkedHouse, linkHouse } from '../lib/houses.js';

const date = (seconds) => new Date(seconds * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

export async function mountHouses({ section, confirmReplace }) {
    const grid = $('.cards', section);
    const bar = $('.my-houses-bar', section);
    const notice = h('p', { class: 'my-houses-notice', role: 'status', hidden: true });
    section.insertBefore(notice, bar);
    let picked = []; // ids elegidos para comparar, en el orden en que se eligieron (máximo dos)
    let list = [];

    const say = (text, kind = '') => {
        notice.textContent = text;
        notice.dataset.kind = kind;
        notice.hidden = !text;
    };

    // Enlace para llevar las casas a otro navegador
    const link = h('input', { type: 'text', readonly: true, class: 'share-link', 'aria-label': 'Enlace para traer las casas', onfocus: (e) => e.target.select() });
    const copied = h('span', { class: 'small muted', role: 'status' });
    const moveDialog = h('dialog', { class: 'dialog', id: 'dlg-move', 'aria-labelledby': 'move-title' },
        h('h2', { id: 'move-title' }, 'Llevar mis casas a otro navegador'),
        h('p', { class: 'muted' }, 'Abrí este enlace en el otro navegador (otra computadora, el celular): tus casas se copian a su «Mis casas». Sirve una sola vez y vence en 15 minutos; acá no cambia nada.'),
        h('div', { class: 'share-row' }, link, h('button', {
            type: 'button',
            class: 'btn btn-primary',
            id: 'move-copy',
            onclick: async () => {
                try {
                    await navigator.clipboard.writeText(link.value);
                    copied.textContent = 'Enlace copiado.';
                } catch {
                    link.select();
                    copied.textContent = 'Copialo con Ctrl+C.';
                }
            },
        }, 'Copiar')),
        copied,
        h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => moveDialog.close() }, 'Cerrar')));
    add(section, moveDialog);

    function renderBar() {
        clear(bar);
        const names = picked.map((id) => list.find((c) => c.id === id)?.name).filter(Boolean);
        add(bar,
            list.length >= 2
                ? picked.length === 2
                    ? h('a', { class: 'btn btn-primary', id: 'compare-go', href: `/comparar?a=${picked[0]}&b=${picked[1]}` }, `Comparar «${names[0]}» con «${names[1]}»`)
                    : h('span', { class: 'muted small' }, picked.length ? 'Elegí otra casa para compararlas.' : 'Marcá «Comparar» en dos casas para verlas lado a lado.')
                : null,
            h('button', {
                type: 'button',
                class: 'btn btn-outline btn-sm my-houses-move',
                onclick: async () => {
                    try {
                        const t = await createTransfer();
                        link.value = `${location.origin}/galeria?traer=${t.codigo}`;
                        copied.textContent = '';
                        moveDialog.showModal();
                        link.select();
                    } catch (e) {
                        say(`No se pudo generar el enlace: ${e.message}`, 'error');
                    }
                },
            }, 'Llevar a otro navegador'));
    }

    function card(c) {
        const s = c.summary;
        const on = picked.includes(c.id);
        return h('article', { class: `tcard card${on ? ' picked' : ''}`, dataset: { house: c.id } },
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
                    list.length >= 2 ? h('button', {
                        type: 'button',
                        class: 'btn btn-outline',
                        'aria-pressed': String(on),
                        dataset: { compare: c.id },
                        onclick: () => {
                            // sólo dos: al elegir una tercera sale la que se eligió primero
                            picked = on ? picked.filter((id) => id !== c.id) : [...picked, c.id].slice(-2);
                            draw();
                        },
                    }, on ? '✓ Comparar' : 'Comparar') : null,
                    h('button', {
                        type: 'button',
                        class: 'btn btn-outline',
                        dataset: { rename: c.id },
                        onclick: async () => {
                            const name = window.prompt('Nombre de la casa:', c.name)?.trim();
                            if (!name || name === c.name) return;
                            try {
                                await renameHouse(c.id, name);
                                await render();
                            } catch (e) {
                                say(`No se pudo renombrar: ${e.message}`, 'error');
                            }
                        },
                    }, 'Renombrar'),
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
                                say(`No se pudo eliminar: ${e.message}`, 'error');
                            }
                        },
                    }, 'Eliminar'))));
    }

    function draw() {
        clear(grid);
        add(grid, list.map(card));
        renderBar();
        section.hidden = list.length === 0 && notice.hidden;
    }

    async function render() {
        try {
            list = await listHouses();
        } catch {
            list = []; // sin servidor de casas: la sección queda oculta
        }
        picked = picked.filter((id) => list.some((c) => c.id === id));
        draw();
    }

    // /galeria?traer=<código>: copia a este navegador las casas de otro
    const params = new URLSearchParams(location.search);
    const code = params.get('traer');
    if (code) {
        params.delete('traer');
        window.history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
        try {
            const r = await claimTransfer(code);
            const left = r.omitidas ? ` ${r.omitidas} no ${r.omitidas === 1 ? 'entró' : 'entraron'} (ya ${r.omitidas === 1 ? 'la tenías' : 'las tenías'} o llegaste al máximo).` : '';
            say(r.copiadas ? `Se ${r.copiadas === 1 ? 'copió 1 casa' : `copiaron ${r.copiadas} casas`} a «Mis casas» de este navegador.${left}` : `No se copió ninguna casa.${left}`, r.copiadas ? 'ok' : 'error');
        } catch (e) {
            say(e.status === 404 ? 'El enlace para traer las casas no sirve: venció (dura 15 minutos) o ya se usó. Generá otro desde el navegador que las tiene.' : `No se pudieron traer las casas: ${e.message}`, 'error');
        }
    }

    await render();
}
