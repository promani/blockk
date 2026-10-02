/**
 * «Mis casas» desde el editor: «Guardar» deja la casa en el servidor, sólo para este navegador (se ven en la Galería),
 * y `/?casa={id}` abre una de ellas. No es un enlace para otros: para eso está «Compartir» (share.js).
 */
import { $ } from '../lib/dom.js';
import { saveHouse, getHouse, linkedHouse, linkHouse } from '../lib/houses.js';

export function mountHouses(app, { unlinkShare }) {
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

    $('#btn-cloud')?.addEventListener('click', async () => {
        if (!hasWalls()) {
            app.toast('Todavía no hay nada para guardar: dibujá una habitación primero.', 'error');
            return;
        }
        try {
            const card = await save();
            app.toast(`«${card.name}» quedó guardada en «Mis casas» (Galería).`);
        } catch (e) {
            app.toast(`No se pudo guardar: ${e.message}`, 'error');
        }
    });

    return {
        /**
         * Si la dirección trae `?casa={id}` («Abrir» de Mis casas), carga esa casa. Antes de reemplazar un proyecto con
         * muros se pide confirmación. Devuelve true si la cargó.
         */
        async openFromUrl() {
            const params = new URLSearchParams(location.search);
            const id = params.get('casa');
            if (!id) return false;
            const confirmed = params.get('ok') === '1'; // la Galería ya preguntó antes de reemplazar
            params.delete('casa');
            params.delete('ok');
            window.history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
            // La casa que ya está abierta puede tener cambios sin guardar: se deja como está.
            if (linkedHouse() === id && hasWalls()) return false;
            let house;
            try {
                house = await getHouse(id);
            } catch (e) {
                app.toast(e.status === 404 ? 'Esa casa no está entre las guardadas por este navegador (pudo haber vencido o haberse eliminado).' : `No se pudo abrir la casa: ${e.message}`, 'error');
                return false;
            }
            if (hasWalls() && !confirmed && !window.confirm(`Vas a abrir «${house.name}» y reemplazar «${store.project.name}», el proyecto que tenés en el editor (podés guardarlo antes). ¿Continuar?`)) return false;
            unlinkShare(); // deja de guardarse en el enlace compartido que hubiera abierto
            await store.load(house.project);
            linkHouse(house.id);
            app.toast(`«${house.name}» abierta.`);
            return true;
        },
    };
}
