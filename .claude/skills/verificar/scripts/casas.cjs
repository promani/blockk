#!/usr/bin/env node
/**
 * Prueba de punta a punta de «Mis casas»: guardar y compartir desde el editor, ver la casa en la Galería, abrir el
 * enlace desde otro navegador (otro contexto: otro id de navegador), comprobar que ahí no figura como propia, que al
 * guardarla queda una copia y que eliminarla corta el enlace. Falla ante errores de consola.
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

    // --- navegador A: guarda y comparte
    const a = await open();
    await a.goto(`${base}/galeria`);
    log(!(await a.isVisible('#my-houses')), 'sin casas guardadas, la Galería no muestra «Mis casas»');
    await a.click('.tcard[data-slug="casa-en-l"] [data-use]');
    await a.waitForURL(`${base}/`);
    await ready(a);
    await a.click('#btn-share');
    await a.waitForSelector('#dlg-share[open]');
    const link = await a.inputValue('#dlg-share .share-link');
    log(/\/c\/[a-f0-9]{24}$/.test(link), `Compartir guarda la casa y muestra el enlace (${link.replace(base, '')})`);
    await a.click('#share-copy');
    log((await a.evaluate(() => navigator.clipboard.readText())) === link, 'el botón copia el enlace');
    if (shots) await a.screenshot({ path: `${shots}/casas-compartir.png` });
    await a.click('#dlg-share .dialog-actions button');
    const id = link.split('/').pop();

    await a.click('#btn-cloud');
    await a.waitForFunction(() => /Mis casas/.test(document.querySelector('#toast').textContent));
    log((await mine(a)).join() === id, 'Guardar actualiza la misma casa (no crea otra)');

    await a.goto(`${base}/galeria`);
    await a.waitForSelector('#my-houses:not([hidden]) .tcard');
    log((await a.locator('#my-houses .tcard').count()) === 1 && /Casa en L|L/.test(await a.locator('#my-houses .tcard h3').innerText()), 'la casa aparece en «Mis casas» de la Galería');
    if (shots) await a.locator('#my-houses').screenshot({ path: `${shots}/casas-mis-casas.png` });

    // --- navegador B: abre el enlace
    const b = await open();
    await b.goto(link);
    await ready(b);
    await b.waitForFunction(() => window.blockk.store.project.levels[0].walls.length > 0, null, { timeout: 30000 });
    const told = await b.waitForFunction(() => /copia/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 }).then(() => true, () => false);
    log(told, 'avisa que está trabajando sobre una copia');
    const nameA = await a.locator('#my-houses .tcard h3').innerText();
    log((await b.evaluate(() => window.blockk.store.project.name)) === nameA && !/casa=/.test(b.url()), 'otro navegador abre la casa con el enlace');

    log((await mine(b)).length === 0, 'ese navegador no la tiene entre sus casas');
    await b.goto(`${base}/galeria`);
    await b.waitForLoadState('networkidle');
    log(!(await b.isVisible('#my-houses')), 'ni la ve en su Galería');

    // B la guarda: queda una copia suya; la de A no cambia
    await b.goto(`${base}/`);
    await ready(b);
    await b.click('#btn-cloud');
    await b.waitForFunction(() => /Mis casas/.test(document.querySelector('#toast').textContent));
    const copies = await mine(b);
    log(copies.length === 1 && copies[0] !== id && (await mine(a)).join() === id, 'al guardarla queda una copia propia; la original sigue siendo una sola');

    // --- A abre la suya desde la Galería y después la elimina
    await a.click('#my-houses .tcard button:has-text("Abrir")');
    await a.waitForURL(`${base}/`);
    await ready(a);
    log((await a.evaluate(() => localStorage.getItem('blockk.house.link'))) === id, '«Abrir» lleva al editor con esa casa');
    await a.goto(`${base}/galeria`);
    await a.waitForSelector('#my-houses:not([hidden]) .tcard');
    await a.click('#my-houses .tcard button:has-text("Eliminar")');
    await a.waitForSelector('#my-houses', { state: 'hidden' });
    log((await mine(a)).length === 0, 'Eliminar la saca de «Mis casas»');

    await b.goto(link);
    await ready(b);
    await b.waitForFunction(() => /no corresponde a ninguna casa/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 });
    log((await b.evaluate(() => window.blockk.store.project.levels[0].walls.length)) > 0, 'el enlace de una casa eliminada avisa y deja el proyecto local');

    log(!errors.length, `sin errores de consola${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} falla(s)` : '\ntodo en orden');
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
