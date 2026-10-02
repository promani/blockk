/**
 * Identificador del navegador: no hay cuentas, así que el asistente y «Mis casas» reconocen a la persona por un id
 * aleatorio que se guarda en este navegador. En otro navegador (o al borrar los datos del sitio) es otra «persona».
 */
const CLIENT_KEY = 'blockk.client';

export function clientId() {
    try {
        let id = localStorage.getItem(CLIENT_KEY);
        if (!id || !/^[a-f0-9]{24}$/.test(id)) {
            const bytes = window.crypto.getRandomValues(new Uint8Array(12));
            id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(CLIENT_KEY, id);
        }
        return id;
    } catch {
        return 'f'.repeat(24);
    }
}
