import { $ } from '../lib/dom.js';
import { shareCreate, shareGet, shareSave } from '../lib/api.js';
import { saveProject } from '../lib/storage.js';

/*
 * Enlace para compartir: «Compartir» guarda el proyecto en el servidor y la dirección pasa a ser /?compartido=<id>.
 * Mientras el editor esté en esa dirección, cada cambio se guarda solo en el enlace (gana el último que guarda) y, al
 * volver a la pestaña, se traen los cambios de otra persona. «Nuevo» y «Abrir» desvinculan el enlace.
 */
const PARAM = 'compartido';
const SAVE_DELAY = 1200;

export function mountShare({ store, toast, fitView }) {
    const btn = $('#btn-share');
    const status = $('#share-status');
    const dlg = $('#dlg-share');
    const input = $('#share-url');
    let link = null; // { id, version, saved: JSON del último proyecto guardado }
    let timer = null;
    let saving = false;

    const urlOf = (id) => `${location.origin}/?${PARAM}=${id}`;
    const setStatus = (text, kind = '') => {
        status.hidden = !text;
        status.textContent = text;
        status.dataset.kind = kind;
    };
    const showDialog = () => {
        input.value = urlOf(link.id);
        dlg.showModal();
        input.select();
    };

    async function saveNow() {
        timer = null;
        if (!link || saving) return;
        const json = JSON.stringify(store.project);
        if (json === link.saved) return;
        saving = true;
        setStatus('Guardando…');
        try {
            const r = await shareSave(link.id, store.project);
            link.version = r.version;
            link.saved = json;
            setStatus('Compartido · guardado', 'ok');
        } catch (err) {
            setStatus('Sin guardar en el enlace', 'error');
            toast(`No se pudo guardar en el enlace: ${err.message}`, 'error');
        } finally {
            saving = false;
            if (link && JSON.stringify(store.project) !== link.saved) schedule();
        }
    }
    function schedule() {
        if (!link) return;
        clearTimeout(timer);
        timer = setTimeout(saveNow, SAVE_DELAY);
    }
    // Cambios de geometría (commit) y de datos del proyecto (nombre, norte, terreno…).
    store.addEventListener('change', schedule);
    store.addEventListener('ui', () => { if (link && JSON.stringify(store.project) !== link.saved) schedule(); });

    // Al volver a la pestaña: si otra persona guardó y acá no hay cambios pendientes, se trae su versión.
    document.addEventListener('visibilitychange', async () => {
        if (document.hidden || !link || timer || saving) return;
        try {
            const r = await shareGet(link.id);
            if (r.version > link.version && JSON.stringify(r.project) !== JSON.stringify(store.project)) {
                link.version = r.version;
                link.saved = JSON.stringify(r.project);
                await store.load(r.project, { keepHistory: true });
                saveProject(store.project);
                toast('Se trajeron los cambios guardados por otra persona en el enlace.');
            }
        } catch { /* sin conexión: se reintenta en la próxima vuelta */ }
    });

    btn.addEventListener('click', async () => {
        if (link) {
            showDialog();
            return;
        }
        btn.disabled = true;
        try {
            const r = await shareCreate(store.project);
            link = { id: r.id, version: r.version, saved: JSON.stringify(store.project) };
            window.history.replaceState(null, '', `/?${PARAM}=${r.id}`);
            setStatus('Compartido · guardado', 'ok');
            showDialog();
        } catch (err) {
            toast(`No se pudo crear el enlace: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
        }
    });
    $('#share-copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(input.value);
            toast('Enlace copiado.');
        } catch {
            input.select();
        }
    });
    $('#share-close').addEventListener('click', () => dlg.close());

    return {
        /** Si la dirección trae un enlace, carga ese proyecto. Devuelve true si lo cargó. */
        async boot() {
            const id = new URLSearchParams(location.search).get(PARAM);
            if (!id) return false;
            try {
                const r = await shareGet(id);
                link = { id, version: r.version, saved: JSON.stringify(r.project) };
                await store.load(r.project);
                saveProject(store.project);
                fitView();
                setStatus('Compartido · guardado', 'ok');
                return true;
            } catch (err) {
                window.history.replaceState(null, '', '/');
                toast(`No se pudo abrir el enlace: ${err.message}`, 'error');
                return false;
            }
        },
        /** El proyecto deja de estar vinculado al enlace (Nuevo, Abrir). */
        unlink() {
            if (!link) return;
            clearTimeout(timer);
            timer = null;
            link = null;
            window.history.replaceState(null, '', '/');
            setStatus('');
        },
    };
}
