#!/usr/bin/env node
/**
 * Prueba de punta a punta de «Mis casas»: guardar desde el editor, ver la casa en la Galería, comprobar que otro
 * navegador (otro contexto: otro id) no la ve ni la puede abrir, que «Compartir» es un enlace aparte, y abrir y
 * eliminar la propia. Falla ante errores de consola.
 *
 *   node casas.cjs [--base http://127.0.0.1:8000] [--shots carpeta]
 */
const { chromium } = require('playwright');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:8000');
const shots = arg('--shots', null);
const fails = [];
const log = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`); if (!ok) fails.push(msg); };

(async () => {
    const browser = await chromium.launch();
    const errors = [];
    const open = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await ctx.newPage();
        // un 404 de la API (enlace vencido) aparece en la consola como recurso que no cargó: es lo esperado en esa parte
        page.on('console', (m) => m.type() === 'error' && !/Failed to load resource.*404/.test(m.text()) && errors.push(m.text()));
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('dialog', (d) => d.accept());
        return page;
    };
    const ready = (page) => page.waitForFunction(() => window.blockk?.store?.analysis && !window.blockk.store.pending, null, { timeout: 30000 });
    const mine = (page) => page.evaluate(async () => (await (await fetch(`/api/houses?client=${localStorage.getItem('blockk.client')}`)).json()).casas.map((c) => c.id));

    // --- navegador A: guarda
    const a = await open();
    await a.goto(`${base}/galeria`);
    log(!(await a.isVisible('#my-houses')), 'sin casas guardadas, la Galería no muestra «Mis casas»');
    await a.click('.tcard[data-slug="casa-en-l"] [data-use]');
    await a.waitForURL(`${base}/`);
    await ready(a);
    await a.click('#btn-cloud');
    await a.waitForFunction(() => /Mis casas/.test(document.querySelector('#toast').textContent));
    const [id] = await mine(a);
    log(/^[a-f0-9]{24}$/.test(id ?? ''), 'Guardar deja la casa en «Mis casas»');
    await a.click('#btn-cloud');
    await a.waitForTimeout(800);
    log((await mine(a)).join() === id, 'volver a guardar actualiza la misma casa (no crea otra)');

    await a.goto(`${base}/galeria`);
    await a.waitForSelector('#my-houses:not([hidden]) .tcard');
    log((await a.locator('#my-houses .tcard').count()) === 1, 'la casa aparece en «Mis casas» de la Galería');
    if (shots) await a.locator('#my-houses').screenshot({ path: `${shots}/casas-mis-casas.png` });

    // --- navegador B: no la ve ni la puede abrir, aunque conozca el id
    const b = await open();
    await b.goto(`${base}/galeria`);
    await b.waitForLoadState('networkidle');
    log((await mine(b)).length === 0 && !(await b.isVisible('#my-houses')), 'otro navegador no la ve en su lista ni en su Galería');
    const status = await b.evaluate(async (hid) => (await fetch(`/api/houses/${hid}?client=${localStorage.getItem('blockk.client')}`)).status, id);
    log(status === 404, 'ni la puede leer con el id (404)');
    await b.goto(`${base}/?casa=${id}`);
    await ready(b);
    await b.waitForFunction(() => /no está entre las guardadas/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 });
    log((await b.evaluate(() => window.blockk.store.project.levels[0].walls.length)) === 0 && !/casa=/.test(b.url()), 'abrir una casa ajena avisa y deja el proyecto local');

    // --- A abre la suya desde la Galería y después la elimina
    await a.click('#my-houses .tcard button:has-text("Abrir")');
    await a.waitForURL(`${base}/`);
    await ready(a);
    log((await a.evaluate(() => localStorage.getItem('blockk.house.link'))) === id && (await a.evaluate(() => window.blockk.store.project.levels[0].walls.length)) > 0, '«Abrir» lleva al editor con esa casa');

    // «Compartir» es otra cosa: un enlace editable; no toca «Mis casas»
    await a.click('#btn-share');
    await a.waitForSelector('#dlg-share[open]');
    const link = await a.inputValue('#share-url');
    log(/\?compartido=[a-f0-9]{32}$/.test(link) && (await mine(a)).join() === id, 'Compartir crea un enlace aparte y «Mis casas» queda igual');
    await a.click('#share-close');
    await b.goto(link);
    await ready(b);
    await b.waitForFunction(() => window.blockk.store.project.levels[0].walls.length > 0, null, { timeout: 30000 });
    log((await mine(b)).length === 0, 'quien abre el enlace compartido ve la casa, y no por eso la tiene en «Mis casas»');

    await a.goto(`${base}/galeria`);
    await a.waitForSelector('#my-houses:not([hidden]) .tcard');
    await a.click('#my-houses .tcard button:has-text("Eliminar")');
    await a.waitForSelector('#my-houses', { state: 'hidden' });
    log((await mine(a)).length === 0, 'Eliminar la saca de «Mis casas»');

    log(!errors.length, `sin errores de consola${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} falla(s)` : '\ntodo en orden');
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
