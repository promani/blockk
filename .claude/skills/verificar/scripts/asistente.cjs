#!/usr/bin/env node
/**
 * Prueba de punta a punta del chat de diseño contra Kimi falso (levantar antes servidor-ia.sh):
 * casa nueva → preguntas de opción simple y múltiple → casa generada → cambio → abrir en el editor →
 * «Modificar con IA» desde el editor → retomar la conversación al recargar. Falla ante errores de consola.
 *
 *   node asistente.cjs [--base http://127.0.0.1:8091] [--shots carpeta]
 */
const { chromium } = require('playwright');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:8091');
const shots = arg('--shots', null);
const fails = [];
const log = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`); if (!ok) fails.push(msg); };

(async () => {
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    const idle = () => page.waitForFunction(() => !document.querySelector('#ai')?.classList.contains('ai-busy'), null, { timeout: 30000 });
    const shot = async (name) => { if (shots) await page.locator('#ai').screenshot({ path: `${shots}/${name}.png` }); };

    await page.goto(`${base}/galeria`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    log(await page.isVisible('#ai'), 'la Galería muestra el asistente');

    await page.click('[data-ai-start="nueva"]');
    await idle();
    log(await page.isVisible('.ai-option:has-text("Una planta")'), 'primera pregunta con opciones');
    await page.click('.ai-option:has-text("Una planta")');
    await idle();
    await page.click('.ai-option:has-text("Lavadero")');
    await page.click('.ai-option:has-text("Escritorio")');
    log(await page.isEnabled('.ai-options button:has-text("Confirmar")'), 'opción múltiple: se habilita Confirmar');
    await shot('ia-multiple');
    await page.click('.ai-options button:has-text("Confirmar")');
    await idle();
    const card = await page.locator('.ai-house').last().innerText().catch(() => '');
    log(/m² útiles/.test(card) && /Escritorio/.test(card) && /Sin observaciones/.test(card), 'casa generada con escritorio y sin observaciones');
    await shot('ia-casa');

    await page.click('.ai-option:has-text("Agregar un dormitorio")');
    await idle();
    const houses = await page.locator('.ai-house').count();
    log(houses === 2 && (await page.locator('.ai-house button:has-text("Abrir en el editor")').count()) === 1, 'segunda versión: sólo la última se abre');
    log(await page.isVisible('.ai-design:has-text("3 dormitorios")'), '«Tus diseños» muestra la casa guardada');

    await page.reload();
    await idle();
    log((await page.locator('.ai-house').count()) === 2, 'al recargar se retoma la conversación');

    await page.click('.ai-house button:has-text("Abrir en el editor")');
    await page.waitForURL(`${base}/`);
    await page.waitForFunction(() => window.blockk?.store?.analysis, null, { timeout: 30000 });
    const rooms = await page.evaluate(() => window.blockk.store.analysis.levels[0].rooms.length);
    log(rooms >= 6, `el editor abre la casa (${rooms} ambientes)`);

    await page.click('#btn-ai');
    await page.waitForURL(/galeria/);
    await idle();
    await page.waitForSelector('.ai-option:has-text("Pasar el techo a un agua")', { timeout: 30000 });
    log(true, '«Modificar con IA» abre el chat con el proyecto actual');
    await page.click('.ai-option:has-text("Pasar el techo a un agua")');
    await idle();
    log((await page.locator('.ai-house').count()) >= 2, 'la edición devuelve una casa nueva');
    await shot('ia-edicion');

    log(!errors.length, `sin errores de consola${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} falla(s)` : '\ntodo en orden');
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
