/**
 * Plano de fondo: una imagen (o la primera página de un PDF) apoyada sobre el terreno, debajo del dibujo, para calcar
 * encima con las herramientas de siempre o corregir lo que calcó el asistente. Se pone a escala marcando dos puntos y
 * escribiendo la distancia real; se mueve arrastrándolo y se atenúa con la opacidad.
 *
 * No es parte del proyecto: no entra al cómputo, no viaja al servidor ni al archivo .json. Vive en `store.ui.backdrop`
 * y se guarda en este navegador (IndexedDB), atado al nombre del proyecto abierto.
 */
import { h } from '../lib/dom.js';
import { fmt } from '../lib/format.js';
import { pictureFrom, PICTURE_TYPES } from '../lib/picture.js';
import { label, nodeMarker } from './overlay.js';

const DB = 'blockk';
const STORE = 'backdrop';
const KEY = 'current';
const SIDE = 2400; // px del lado mayor: más que para el asistente, porque acá se mira de cerca

/** IndexedDB mínimo: un solo registro. Si el navegador no deja, el fondo dura lo que la pestaña. */
function idb(mode, fn) {
    return new Promise((ok, fail) => {
        let open;
        try {
            open = window.indexedDB.open(DB, 1);
        } catch (e) {
            fail(e);
            return;
        }
        open.onupgradeneeded = () => open.result.createObjectStore(STORE);
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
            const tx = open.result.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            tx.oncomplete = () => { open.result.close(); ok(req?.result); };
            tx.onerror = () => { open.result.close(); fail(tx.error); };
        };
    });
}

const loadImage = (url) => new Promise((ok, fail) => {
    const i = new window.Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error('No se pudo leer la imagen.'));
    i.src = url;
});

export function mountBackdrop(app) {
    const { store } = app;
    let warned = false;
    let timer = null;

    const bd = () => store.ui.backdrop ?? null;
    const widthM = (b) => (b.img.naturalWidth * b.cmPerPx) / 100;
    const heightM = (b) => (b.img.naturalHeight * b.cmPerPx) / 100;
    /** Cambio que sólo redibuja (opacidad, arrastre): sin rearmar los paneles. */
    const touch = () => {
        const b = bd();
        if (!b) return;
        b.rev++;
        app.render();
        persist();
    };

    function persist() {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const b = bd();
            try {
                if (!b) await idb('readwrite', (s) => s.delete(KEY));
                else await idb('readwrite', (s) => s.put({ name: store.project.name, url: b.url, x: b.x, y: b.y, cmPerPx: b.cmPerPx, opacity: b.opacity, visible: b.visible }, KEY));
            } catch {
                if (b && !warned) {
                    warned = true;
                    app.toast('El plano de fondo no se pudo guardar en este navegador: al recargar la página habrá que cargarlo de nuevo.', 'error');
                }
            }
        }, 400);
    }

    async function place(url, saved = null) {
        const img = await loadImage(url);
        // Sin escala todavía: 10 m de ancho (o lo que entre en el terreno), a 1 m de la esquina del lote.
        const wide = Math.min(1000, Math.max(300, store.project.lot.w * 100 - 200));
        store.setUi({ backdrop: { img, url, x: saved?.x ?? 100, y: saved?.y ?? 100, cmPerPx: saved?.cmPerPx ?? wide / img.naturalWidth, opacity: saved?.opacity ?? 0.6, visible: saved?.visible ?? true, rev: 1 } });
        app.render();
    }

    async function setFromFile(file) {
        try {
            const pic = await pictureFrom(file, { side: SIDE });
            await place(pic.url);
            persist();
            app.toast(`Plano de fondo cargado${pic.pages > 1 ? ` (página 1 de ${pic.pages} del PDF)` : ''}. Ponelo a escala marcando dos puntos de una medida conocida.`);
        } catch (e) {
            app.toast(e.message, 'error');
        }
    }

    const picker = h('input', { type: 'file', accept: PICTURE_TYPES.join(','), hidden: true, id: 'backdrop-file', tabindex: '-1', 'aria-hidden': 'true' });
    picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        picker.value = '';
        if (file) setFromFile(file);
    });
    document.body.append(picker);

    // el fondo va atado al nombre del proyecto: si se lo renombra, se vuelve a guardar con el nuevo
    store.addEventListener('ui', () => { if (bd()) persist(); });

    function remove() {
        if (!bd()) return;
        if (['bgscale', 'bgmove'].includes(store.ui.tool)) app.setTool('select');
        store.setUi({ backdrop: null });
        app.render();
        persist();
    }

    // ---------------- herramientas: poner a escala y mover ----------------
    const base = { free: true, planeZ: () => 0, snap: 1 };
    const raw = (p) => app.cam.unproject(p.sx, p.sy, 0);

    let pts = [];
    let meters = '';
    const applyScale = () => {
        const b = bd();
        const real = Number(String(meters).replace(',', '.'));
        if (!b || pts.length < 2 || !(real > 0)) {
            app.toast('Escribí la distancia real entre los dos puntos, en metros.', 'error');
            return;
        }
        const drawn = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
        if (drawn < 1) return;
        // el primer punto queda fijo; el resto del plano crece o se achica alrededor
        const k = (real * 100) / drawn;
        b.x = pts[0][0] - (pts[0][0] - b.x) * k;
        b.y = pts[0][1] - (pts[0][1] - b.y) * k;
        b.cmPerPx *= k;
        pts = [];
        meters = '';
        touch();
        app.setTool('select');
        app.toast(`Plano a escala: mide ${fmt(widthM(b))} × ${fmt(heightM(b))} m. Ya podés calcar encima.`);
    };
    app.tools.bgscale = {
        ...base,
        id: 'bgscale',
        label: 'Escala del plano de fondo',
        short: 'Escala',
        hint: 'Marcá dos puntos del plano cuya distancia conozcas (los extremos de una cota o de una pared), escribí cuántos metros hay entre ellos y aplicá.',
        disabled: () => (bd() ? null : 'Primero cargá un plano de fondo.'),
        options: () => (pts.length < 2
            ? h('span', { class: 'muted small' }, pts.length ? 'Ahora el segundo punto.' : 'Marcá el primer punto sobre el plano.')
            : h('span', { class: 'row' },
                h('label', { class: 'field-inline' }, 'Distancia real (m)',
                    h('input', { type: 'text', inputmode: 'decimal', id: 'backdrop-meters', class: 'w-narrow', value: meters, oninput: (e) => { meters = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') applyScale(); } })),
                h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'backdrop-apply', onclick: applyScale }, 'Aplicar'))),
        reset() { pts = []; meters = ''; },
        down(p) {
            if (pts.length >= 2) pts = [];
            pts.push(raw(p));
            app.refreshOptions();
            if (pts.length === 2) document.getElementById('backdrop-meters')?.focus();
        },
        move() { app.render(); },
        keyDown(e) {
            if (e.key === 'Escape' && pts.length) {
                pts = [];
                app.refreshOptions();
                app.render();
                return true;
            }
            return false;
        },
        draw(ctx, cam) {
            const end = pts.length === 1 && app.pointer ? raw(app.pointer) : pts[1];
            if (pts[0] && end) {
                const a = cam.project(pts[0][0], pts[0][1], 0);
                const c = cam.project(end[0], end[1], 0);
                ctx.save();
                ctx.strokeStyle = '#d92d20';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(c[0], c[1]);
                ctx.stroke();
                ctx.restore();
                label(ctx, `hoy: ${fmt(Math.hypot(end[0] - pts[0][0], end[1] - pts[0][1]) / 100)} m`, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - 16, { bg: 'rgba(217,45,32,.92)' });
            }
            for (const q of [pts[0], end]) if (q) nodeMarker(ctx, cam, q[0], q[1], 0, '#d92d20');
        },
    };

    let grab = null;
    app.tools.bgmove = {
        ...base,
        id: 'bgmove',
        label: 'Mover el plano de fondo',
        short: 'Mover plano',
        hint: 'Arrastrá el plano de fondo para acomodarlo debajo del dibujo. Esc vuelve a Elegir.',
        disabled: () => (bd() ? null : 'Primero cargá un plano de fondo.'),
        options: () => h('span', { class: 'muted small' }, 'Arrastrá el plano.'),
        reset() { grab = null; app.canvas.style.cursor = ''; },
        down(p) {
            const b = bd();
            if (!b) return;
            const [wx, wy] = raw(p);
            grab = { wx, wy, x: b.x, y: b.y };
            app.canvas.style.cursor = 'grabbing';
        },
        move(p) {
            const b = bd();
            if (!grab || !b) {
                app.canvas.style.cursor = 'grab';
                return;
            }
            const [wx, wy] = raw(p);
            b.x = grab.x + wx - grab.wx;
            b.y = grab.y + wy - grab.wy;
            touch();
        },
        up() {
            grab = null;
            app.canvas.style.cursor = 'grab';
        },
    };

    return {
        /** Bloque para «Configuraciones generales». */
        panel() {
            const b = bd();
            const load = h('button', { type: 'button', class: 'btn btn-outline btn-sm', id: 'backdrop-load', onclick: () => picker.click() }, b ? 'Cambiar…' : 'Cargar plano…');
            if (!b) {
                return [
                    h('div', { class: 'kv-title' }, 'Plano de fondo'),
                    h('div', { class: 'actions-row' }, load),
                    h('p', { class: 'muted small' }, 'Una imagen o un PDF para calcar encima. No entra al proyecto ni al cómputo.'),
                ];
            }
            return [
                h('div', { class: 'kv-title' }, 'Plano de fondo'),
                h('div', { class: 'check-row' },
                    h('label', { class: 'field-inline' }, h('input', { type: 'checkbox', id: 'backdrop-visible', checked: b.visible, onchange: (e) => { b.visible = e.target.checked; touch(); } }), 'Mostrar'),
                    h('label', { class: 'field-inline' }, 'Opacidad', h('input', { type: 'range', id: 'backdrop-opacity', min: 10, max: 100, step: 5, value: Math.round(b.opacity * 100), oninput: (e) => { b.opacity = Number(e.target.value) / 100; touch(); } }))),
                h('dl', { class: 'dl' }, h('dt', {}, 'Medida'), h('dd', { id: 'backdrop-size' }, `${fmt(widthM(b))} × ${fmt(heightM(b))} m`)),
                h('div', { class: 'actions-row' },
                    h('button', { type: 'button', class: 'btn btn-outline btn-sm', id: 'backdrop-scale', onclick: () => app.setTool('bgscale') }, 'Poner a escala'),
                    h('button', { type: 'button', class: 'btn btn-outline btn-sm', id: 'backdrop-move', onclick: () => app.setTool('bgmove') }, 'Mover'),
                    load,
                    h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'backdrop-remove', onclick: remove }, 'Quitar')),
                h('p', { class: 'muted small' }, 'No entra al proyecto ni al cómputo: queda guardado sólo en este navegador.'),
            ];
        },
        /** La imagen que el asistente acaba de calcar, como fondo para corregir el resultado. */
        async setFromDataUrl(url) {
            try {
                await place(url);
                persist();
                app.toast('El plano quedó de fondo. Ponelo a escala y movelo hasta que coincida con el dibujo.');
            } catch (e) {
                app.toast(e.message, 'error');
            }
        },
        remove,
        /** Al arrancar: vuelve el fondo guardado si es del proyecto abierto. */
        async restore() {
            try {
                const saved = await idb('readonly', (s) => s.get(KEY));
                if (saved?.url && saved.name === store.project.name) await place(saved.url, saved);
            } catch { /* sin fondo guardado */ }
        },
    };
}
