/** Cliente de la API JSON de Symfony. El motor de cálculo vive en el servidor (única fuente de las reglas). */
async function request(url, options = {}) {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, ...options });
    let data = null;
    try {
        data = await res.json();
    } catch {
        /* cuerpo vacío o no JSON */
    }
    if (!res.ok) {
        const details = data?.details ? `: ${data.details.slice(0, 3).join('; ')}` : '';
        throw new Error(`${data?.error ?? `HTTP ${res.status}`}${details}`);
    }
    return data;
}

const post = (url, body, signal) => request(url, { method: 'POST', body: JSON.stringify(body), signal });

export const analyze = (project, signal) => post('/api/analyze', project, signal);
export const suggest = (project) => post('/api/suggest', project);
/** Trayectoria solar; con longitud y huso (UTC) las horas son de reloj (hora oficial), si no, hora solar. */
export const solarPath = (lat, season, lon = null, tz = 0) => request(`/api/solar?lat=${encodeURIComponent(lat)}&season=${encodeURIComponent(season)}${lon === null || lon === undefined ? '' : `&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}`}`);
export const template = (slug) => request(`/api/templates/${encodeURIComponent(slug)}`);
export const calcPanel = (params) => request(`/api/calc/panel?${new URLSearchParams(params)}`);
