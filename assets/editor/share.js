/**
 * Guardar y compartir desde el editor. «Guardar» deja la casa en «Mis casas» (en el servidor, sólo para este navegador)
 * y «Compartir» además muestra el enlace. El enlace abre una copia: quien lo recibe no cambia la casa original.
 */
import { $, h, add } from '../lib/dom.js';
import { saveHouse, getHouse, shareUrl, linkedHouse, linkHouse, copyText } from '../lib/houses.js';

export function mountShare(app) {
    const { store } = app;
    const hasWalls = () => store.project.levels.some((l) => l.walls.length);
    let saving = null;

    /** Guarda el proyecto abierto: actualiza su casa si ya estaba guardada por este navegador; si no, crea una. */
    function save() {
        saving ??= (async () => {
            try {
                const card = await saveHouse(store.project, linkedHouse());
                linkHouse(card.id);
                return card;
            } finally {
                saving = null;
            }
        })();
        return saving;
    }

    const input = h('input', { type: 'text', readonly: true, class: 'share-link', 'aria-label': 'Enlace para compartir', onfocus: (e) => e.target.select() });
    const copied = h('span', { class: 'small muted', role: 'status' });
    const dialog = h('dialog', { class: 'dialog', id: 'dlg-share', 'aria-labelledby': 'share-title' },
        h('h2', { id: 'share-title' }, 'Compartir esta casa'),
        h('p', { class: 'muted' }, 'Quien abra el enlace ve la casa y su cómputo, y puede trabajar sobre una copia: la tuya no cambia. Si la seguís editando, guardá de nuevo para que el enlace muestre lo último.'),
        h('div', { class: 'share-row' }, input, h('button', {
            type: 'button',
            class: 'btn btn-primary',
            id: 'share-copy',
            onclick: async () => {
                const ok = await copyText(input.value);
                if (!ok) input.select();
                copied.textContent = ok ? 'Enlace copiado.' : 'Copialo con Ctrl+C.';
            },
        }, 'Copiar enlace')),
        copied,
        h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dialog.close() }, 'Cerrar')));
    add(document.body, dialog);

    const guard = () => {
        if (hasWalls()) return true;
        app.toast('Todavía no hay nada para guardar: dibujá una habitación primero.', 'error');
        return false;
    };

    $('#btn-cloud')?.addEventListener('click', async () => {
        if (!guard()) return;
        try {
            const card = await save();
            app.toast(`«${card.name}» quedó guardada en «Mis casas» (Galería).`);
        } catch (e) {
            app.toast(`No se pudo guardar: ${e.message}`, 'error');
        }
    });

    $('#btn-share')?.addEventListener('click', async () => {
        if (!guard()) return;
        try {
            const card = await save();
            input.value = shareUrl(card.id);
            copied.textContent = '';
            dialog.showModal();
            input.select();
        } catch (e) {
            app.toast(`No se pudo compartir: ${e.message}`, 'error');
        }
    });

    return {
        /**
         * Si la dirección trae `?casa={id}` (un enlace compartido o «Abrir» de Mis casas), carga esa casa. Antes de
         * reemplazar un proyecto con muros se pide confirmación. Devuelve true si la cargó.
         */
        async openFromUrl() {
            const params = new URLSearchParams(location.search);
            const id = params.get('casa');
            if (!id) return false;
            const confirmed = params.get('ok') === '1'; // la Galería ya preguntó antes de reemplazar
            params.delete('casa');
            params.delete('ok');
            window.history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
            // La casa propia que ya está abierta puede tener cambios sin guardar: se deja como está.
            if (linkedHouse() === id && hasWalls()) return false;
            let house;
            try {
                house = await getHouse(id);
            } catch (e) {
                app.toast(e.status === 404 ? 'El enlace no corresponde a ninguna casa guardada (pudo haber vencido o haberse eliminado).' : `No se pudo abrir la casa del enlace: ${e.message}`, 'error');
                return false;
            }
            if (hasWalls() && !confirmed && !window.confirm(`Vas a abrir «${house.name}» y reemplazar «${store.project.name}», el proyecto que tenés en el editor (podés guardarlo antes). ¿Continuar?`)) return false;
            await store.load(house.project);
            linkHouse(house.own ? house.id : null);
            app.toast(house.own ? `«${house.name}» abierta.` : `Abriste una copia de «${house.name}»: si la guardás, queda como una casa tuya.`);
            return true;
        },
    };
}
