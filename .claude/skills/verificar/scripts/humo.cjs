#!/usr/bin/env node
/**
 * Prueba de humo del editor en Chromium sin pantalla: recorre todas las plantillas (pestañas, 4 vistas, planta, cómputo)
 * y un proyecto en blanco (habitación dibujada con el mouse, puerta, ventana, deshacer/rehacer, herramientas).
 * Falla si hay errores de consola o si una plantilla tiene observaciones de severidad «error».
 *
 *   node humo.cjs [--base http://127.0.0.1:8000]
 */
const { chromium } = require('playwright');

const i = process.argv.indexOf('--base');
const base = i > 0 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
const fails = [];
const log = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`); if (!ok) fails.push(msg); };

(async () => {
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    let errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    const ready = () => page.waitForFunction(() => window.blockk?.store?.analysis && window.blockk.store.fresh && !window.blockk.store.pendingCount, null, { timeout: 30000 });
    const checkConsole = (what) => { log(!errors.length, `${what}: sin errores de consola${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`); errors = []; };

    // 1) Plantillas
    const templates = await (await page.request.get(`${base}/api/templates`)).json();
    for (const t of templates) {
        await page.goto(`${base}/galeria`);
        await page.click(`.tcard[data-slug="${t.slug}"] [data-use]`);
        await ready();
        await page.click('.guide-x').catch(() => {});
        const bad = await page.evaluate(() => window.blockk.store.analysis.issues.filter((x) => x.severity === 'error').map((x) => `${x.code} ${x.ref}`));
        log(!bad.length, `${t.slug}: sin errores en la Revisión${bad.length ? ` → ${bad.join(', ')}` : ''}`);
        for (const tab of ['Nivel 1', 'Nivel 2', 'Techo']) {
            if (!(await page.$(`.level-tab:has-text("${tab}")`))) continue;
            await page.click(`.level-tab:has-text("${tab}")`);
            for (const r of [0, 1, 2, 3]) await page.evaluate((r) => { window.blockk.cam.rot = r; window.blockk.render(); }, r);
            await page.click('[data-view="plan"]');
            await page.waitForTimeout(100);
            await page.click('[data-view="iso"]');
        }
        checkConsole(t.slug);
    }
    await page.goto(`${base}/computo`);
    await page.waitForTimeout(800);
    checkConsole('página de cómputo');

    // 2) Proyecto en blanco: dibujar con el mouse
    await page.goto(`${base}/`);
    await ready();
    await page.evaluate(() => window.blockk.store.load({ v: 1, name: 'Humo', north: 0, lat: -34.6, lot: { w: 24, d: 20 }, settings: { defaultT: 20, reservePct: 3, currency: 'USD' }, upper: false, levels: [{ walls: [], openings: [] }, { walls: [], openings: [] }] }));
    await ready();
    await page.click('.guide-x').catch(() => {});
    await page.click('[data-view="plan"]');
    await page.evaluate(() => { window.blockk.cam.fit(0, 0, 1000, 800, 0, 40); window.blockk.render(); });
    const toScreen = (x, y) => page.evaluate(([x, y]) => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        const [sx, sy] = window.blockk.cam.project(x, y, 0);
        return [r.left + sx, r.top + sy];
    }, [x, y]);
    await page.click('.tool:has-text("Habitación")');
    const a = await toScreen(0, 0);
    const b = await toScreen(625, 500);
    await page.mouse.move(a[0], a[1]);
    await page.mouse.down();
    await page.mouse.move(b[0], b[1], { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await ready();
    const rooms = await page.evaluate(() => window.blockk.store.analysis.levels[0].rooms.length);
    log(rooms === 1, `habitación dibujada con el mouse (ambientes: ${rooms})`);

    for (const [tool, x, y] of [['Puerta', 300, 500], ['Ventana', 300, 0]]) {
        await page.click(`.tool:has-text("${tool}")`);
        const p = await toScreen(x, y);
        await page.mouse.move(p[0], p[1], { steps: 4 });
        await page.mouse.click(p[0], p[1]);
        await page.waitForTimeout(300);
        await ready();
    }
    const ops = await page.evaluate(() => window.blockk.store.project.levels[0].openings.map((o) => o.kind).sort().join(','));
    log(ops === 'door,window', `puerta y ventana colocadas (${ops || 'ninguna'})`);

    await page.evaluate(() => window.blockk.store.undo());
    await ready();
    await page.evaluate(() => window.blockk.store.redo());
    await ready();
    const after = await page.evaluate(() => window.blockk.store.project.levels[0].openings.length);
    log(after === 2, 'deshacer / rehacer');

    await page.click('[data-view="iso"]');
    for (const tool of await page.$$eval('.tool .tool-name', (els) => els.map((e) => e.textContent))) {
        await page.click(`.tool:has-text("${tool}")`).catch(() => {});
    }
    await page.click('.level-tab:has-text("Techo")');
    await page.click('[data-view="plan"]');
    await page.evaluate(() => { window.blockk.cam.fit(0, 0, 1000, 800, 0, 40); window.blockk.render(); });
    const roof = await toScreen(300, 250);
    await page.click('.tool:has-text("Techo")').catch(() => {});
    await page.mouse.click(roof[0], roof[1]);
    await page.waitForTimeout(300);
    await ready();
    const roofs = await page.evaluate(() => window.blockk.store.project.roofs?.length ?? 0);
    log(roofs === 1, `techo con un clic dentro de la habitación (techos: ${roofs})`);
    checkConsole('proyecto en blanco');

    await browser.close();
    console.log(fails.length ? `\n${fails.length} falla(s)` : '\ntodo en orden');
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
