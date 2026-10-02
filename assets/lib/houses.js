/**
 * «Mis casas»: casas guardadas en el servidor por este navegador y su enlace para compartir. El editor recuerda cuál
 * de ellas es el proyecto abierto (para actualizarla en vez de crear otra); al cargar otro proyecto se olvida.
 */
import { clientId } from './client.js';

const LINK_KEY = 'blockk.house.link';

async function call(method, url, body) {
    const res = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* vacío */ }
    if (!res.ok) {
        const msg = data?.error === 'invalid_project' ? 'El proyecto no es válido.' : data?.error === 'not_found' ? 'Esa casa no existe o ya venció.' : (data?.error ?? `Error ${res.status}`);
        throw Object.assign(new Error(msg), { status: res.status });
    }
    return data;
}

/** Las casas de este navegador (sin el proyecto). */
export const listHouses = async () => (await call('GET', `/api/houses?client=${clientId()}`)).casas;

/** Guarda el proyecto; con `id` de una casa propia la actualiza. Devuelve su tarjeta. */
export const saveHouse = (project, id = null) => call('POST', '/api/houses', { client: clientId(), project, ...(id ? { id } : {}) });

/** Una casa por su id (propia o de un enlace): {id, name, project, summary, own}. */
export const getHouse = (id) => call('GET', `/api/houses/${encodeURIComponent(id)}?client=${clientId()}`);

export const deleteHouse = (id) => call('DELETE', `/api/houses/${encodeURIComponent(id)}?client=${clientId()}`);

/** Enlace para compartir una casa. */
export const shareUrl = (id) => `${location.origin}/c/${id}`;

/** Id de la casa guardada que corresponde al proyecto abierto en el editor, o null. */
export function linkedHouse() {
    try {
        const id = localStorage.getItem(LINK_KEY);
        return id && /^[a-f0-9]{24}$/.test(id) ? id : null;
    } catch {
        return null;
    }
}

/** Recuerda (o, con null, olvida) qué casa guardada es el proyecto del editor. */
export function linkHouse(id) {
    try {
        if (id) localStorage.setItem(LINK_KEY, id);
        else localStorage.removeItem(LINK_KEY);
    } catch { /* sin persistencia */ }
}

/** Copia un texto al portapapeles; false si el navegador no deja. */
export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
