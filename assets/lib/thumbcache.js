/*
 * Caché de miniaturas en el navegador (IndexedDB): las vistas de «Tus diseños» se dibujan una sola vez por versión.
 * Si IndexedDB no está disponible (navegación privada, bloqueos), todo sigue andando sin caché.
 */
const DB = 'blockk-thumbs';
const STORE = 'thumbs';
let dbp = null;

function db() {
    dbp ??= new Promise((resolve) => {
        try {
            const req = window.indexedDB.open(DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return dbp;
}

export async function getThumbs(key) {
    const d = await db();
    if (!d) return null;
    return new Promise((resolve) => {
        try {
            const req = d.transaction(STORE).objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

export async function putThumbs(key, value) {
    const d = await db();
    if (!d) return;
    try {
        d.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    } catch { /* sin caché */ }
}
