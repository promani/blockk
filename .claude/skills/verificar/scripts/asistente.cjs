#!/usr/bin/env node
/**
 * Prueba de punta a punta del asistente contra Kimi falso (levantar antes servidor-ia.sh). Galería: formulario
 * inicial sin modelo → casa → sugerencia → pregunta ambigua con varias preguntas → abrir en el editor. Editor: botón
 * flotante → pedido → aplicado y deshacer → plano adjunto con el clip → casa calcada. Galería: aviso antes de reemplazar y «Modificar con IA» de una plantilla.
 * Falla ante errores de consola.
 *
 *   node asistente.cjs [--base http://127.0.0.1:8091] [--shots carpeta]
 */
const { chromium } = require('playwright');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:8091');
const kimi = arg('--kimi', 'http://127.0.0.1:8099');
const shots = arg('--shots', null);
const fails = [];
const log = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`); if (!ok) fails.push(msg); };

(async () => {
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1360, height: 960 } })).newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    const idle = () => page.waitForFunction(() => !document.querySelector('.ai-typing'), null, { timeout: 60000 });
    const shot = async (name, sel = '#ai-dialog') => { if (shots) await page.locator(sel).screenshot({ path: `${shots}/${name}.png` }); };
    const kimiCalls = async () => (await (await fetch(`${kimi}/__log`)).json()).calls;

    // --- Galería: asistente paso a paso
    await page.goto(`${base}/galeria`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const calls0 = await kimiCalls();
    await page.click('#ai-new');
    await idle();
    log((await page.locator('.ai-q').count()) === 6, 'formulario inicial con 6 preguntas, una debajo de la otra');
    log(await page.isVisible('#ai-steps li[data-step="1"][aria-current]'), 'paso 1 activo');
    for (const opt of ['1 planta', '3', 'Baño + toilette', 'Separada', 'Lavadero', 'A dos aguas']) {
        await page.locator('.ai-q .ai-option', { hasText: new RegExp(`^${opt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click();
    }
    await shot('ia-formulario');
    await page.click('.ai-form-foot button:has-text("Enviar")');
    await idle();
    const card = await page.locator('.ai-house').last().innerText();
    log(/Cocina/.test(card) && /Toilette/.test(card) && /Sin observaciones/.test(card), 'casa del formulario: cocina aparte, toilette, sin observaciones');
    log((await kimiCalls()) === calls0, 'el formulario inicial no llamó al modelo');
    log(await page.isVisible('#ai-steps li[data-step="2"][aria-current]') && await page.isVisible('#ai-open'), 'paso 2 y botón «Abrir en el editor»');
    await shot('ia-propuesta');

    await page.click('.ai-chip:has-text("Sumá un dormitorio")');
    await idle();
    log((await page.locator('.ai-house').count()) === 2 && await page.isVisible('#ai-steps li[data-step="3"][aria-current]'), 'sugerencia → nueva versión, paso 3');

    await page.fill('#ai-form input', 'agrandala');
    await page.press('#ai-form input', 'Enter');
    await idle();
    const qs = page.locator('.ai-form').last().locator('.ai-q');
    log((await qs.count()) === 2, 'pedido ambiguo → dos preguntas juntas');
    await qs.nth(0).locator('.ai-option').first().click();
    log(await page.isVisible('.ai-form-foot button:has-text("Enviar")'), 'con una pregunta múltiple se confirma con «Enviar»');
    await qs.nth(1).locator('.ai-option').nth(1).click();
    await page.locator('.ai-form-foot button:has-text("Enviar")').last().click();
    await idle();
    log(/Un poco · Escritorio/.test(await page.locator('.ai-me').last().innerText()), 'las respuestas se muestran juntas');

    await page.click('#ai-open');
    await page.waitForURL(`${base}/`);
    await page.waitForFunction(() => window.blockk?.store?.analysis, null, { timeout: 30000 });
    const rooms = await page.evaluate(() => window.blockk.store.analysis.levels[0].rooms.length);
    log(rooms >= 7, `el editor abre la casa (${rooms} ambientes)`);

    // --- Editor: botón flotante
    await page.click('#ai-fab');
    log(await page.isVisible('#ai-dialog .ai-chip'), 'el botón flotante abre el diálogo con ideas');
    await shot('ia-editor-intro');
    await page.click('#ai-dialog .ai-chip:has-text("Sumá un dormitorio")');
    await idle();
    await page.waitForSelector('#ai-dialog :text("✓ Aplicado")', { timeout: 30000 });
    const label = await page.evaluate(() => window.blockk.store.history.at(-1)?.label);
    log(label === 'Cambio del asistente', 'el cambio se aplicó al editor como un paso deshacible');
    await shot('ia-editor-aplicado');
    await page.click('#ai-dialog button:has-text("Deshacer este cambio")');
    await page.waitForSelector('#ai-dialog :text("↶ Deshecho")', { timeout: 30000 });
    log(await page.evaluate(() => window.blockk.store.history.at(-1)?.label !== 'Cambio del asistente' && window.blockk.store.future.length === 1), 'deshacer vuelve a la casa anterior');

    // --- Editor: calcar un plano adjunto (imagen de 1 × 1 px; el Kimi falso «lee» siempre el mismo quincho)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('#ai-form input[type="file"]', { name: 'plano.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('#ai-form .ai-attach.on img');
    log(true, 'el clip muestra la miniatura del plano elegido');
    await shot('ia-editor-adjunto');
    await page.click('#ai-form button[type="submit"]');
    await idle();
    await page.waitForFunction(() => window.blockk.store.project.name === 'Quincho del plano', null, { timeout: 30000 });
    log(/Plano adjunto/.test(await page.locator('.ai-me').last().innerText()) && !(await page.isVisible('#ai-form .ai-attach.on')), 'el mensaje lleva la marca del plano y el clip queda libre');
    const traced = await page.evaluate(() => ({ names: window.blockk.store.project.levels[0].labels.map((l) => l.name), openings: window.blockk.store.project.levels[0].openings.length, label: window.blockk.store.history.at(-1)?.label }));
    log(traced.names.join() === 'Quincho,Baño,Depósito' && traced.openings === 3 && traced.label === 'Cambio del asistente', `el plano se calcó en el editor (${traced.names.join(', ')}; ${traced.openings} aberturas)`);
    await shot('ia-editor-calcado');
    await page.click('#ai-dialog [data-close]');

    // --- Galería: aviso antes de reemplazar y «Modificar con IA»
    await page.goto(`${base}/galeria`);
    await page.click('[data-ai-modify="casa-en-l"]');
    log(await page.isVisible('#confirm-replace'), 'avisa antes de reemplazar el proyecto actual');
    await page.click('#confirm-replace button[value="cancel"]');
    log(!(await page.isVisible('#ai-dialog')), 'cancelar no abre el asistente');
    await page.click('[data-ai-modify="casa-en-l"]');
    await page.click('#confirm-replace button[value="ok"]');
    await idle();
    log((await page.locator('#ai-dialog .ai-house').count()) === 1 && await page.isVisible('#ai-dialog .ai-chip'), 'la plantilla aparece con sugerencias, sin esperar al modelo');
    await page.click('#ai-dialog .ai-chip:has-text("Más luz en el estar")');
    await idle();
    const last = await page.locator('.ai-house').last().innerText();
    log((await page.locator('#ai-dialog .ai-house').count()) === 2 && /Sin observaciones/.test(last), 'ventana agregada por ambiente donde hay lugar, sin observaciones');
    await shot('ia-plantilla');
    await page.click('#ai-dialog [data-close]');
    await page.click('[data-use="casa-en-l"]');
    log(await page.isVisible('#confirm-replace'), '«Usar» también avisa');
    await page.click('#confirm-replace button[value="cancel"]');

    const { byModel } = await (await fetch(`${kimi}/__log`)).json();
    log(byModel.liviano > 0 && byModel.falso > 0, `el liviano coordina y el pesado construye (${JSON.stringify(byModel)})`);
    log(!errors.length, `sin errores de consola${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} falla(s)` : '\ntodo en orden');
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
