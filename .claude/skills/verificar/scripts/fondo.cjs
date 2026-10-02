#!/usr/bin/env node
/**
 * Prueba de punta a punta del plano de fondo y del PDF adjunto (levantar antes servidor-ia.sh: la app contra Kimi falso).
 * Editor: cargar una imagen de fondo → ponerla a escala con dos puntos y una medida → opacidad → mover → dibujar un muro
 * encima → el proyecto no lleva nada del fondo → recargar y sigue → quitar. Chat: adjuntar un PDF de dos páginas → viaja
 * como imagen → casa calcada → «Usar el plano como fondo». Falla ante errores de consola.
 *
 *   node fondo.cjs [--base http://127.0.0.1:8091] [--shots carpeta]
 */
const { chromium } = require('playwright');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:8091');
const shots = arg('--shots', null);
const fails = [];
const log = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`); if (!ok) fails.push(msg); };

/** PDF mínimo de dos páginas (un rectángulo en cada una), con su tabla de referencias bien armada. */
function tinyPdf() {
    const stream = '0.2 0.2 0.2 RG 4 w 40 40 220 140 re S';
    const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Contents 4 0 R >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Contents 4 0 R >>',
    ];
    let out = '%PDF-1.4\n';
    const at = [];
    objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

(async () => {
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    const sent = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/assistant\/conversations/.test(r.url())) sent.push(r.postDataJSON()); });
    const ready = () => page.waitForFunction(() => window.blockk?.store?.analysis && !window.blockk.store.pending, null, { timeout: 30000 });
    const bd = () => page.evaluate(() => { const b = window.blockk.store.ui.backdrop; return b ? { x: b.x, y: b.y, cmPerPx: b.cmPerPx, opacity: b.opacity, visible: b.visible, w: b.img.naturalWidth } : null; });
    /** Píxel de pantalla de un punto de la imagen de fondo (px de la imagen). */
    const at = (ix, iy) => page.evaluate(([x, y]) => {
        const b = window.blockk.store.ui.backdrop;
        const [sx, sy] = window.blockk.cam.project(b.x + x * b.cmPerPx, b.y + y * b.cmPerPx, 0);
        const r = window.blockk.canvas.getBoundingClientRect();
        return [r.left + sx, r.top + sy];
    }, [ix, iy]);

    await page.goto(`${base}/`, { timeout: 90000 });
    await page.evaluate(async () => { localStorage.clear(); await new Promise((ok) => { const d = window.indexedDB.deleteDatabase('blockk'); d.onsuccess = d.onerror = d.onblocked = () => ok(); }); });
    await page.reload();
    await ready();
    await page.click('#view-toggle button[data-view="plan"]');

    // --- imagen de 400 × 300 px con una cota de 300 px
    const png = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 400; c.height = 300;
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
        x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(50, 50, 300, 200);
        x.beginPath(); x.moveTo(200, 50); x.lineTo(200, 250); x.stroke();
        x.fillStyle = '#111'; x.font = '18px sans-serif'; x.fillText('6.00', 180, 36);
        return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await page.setInputFiles('#backdrop-file', { name: 'plano.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => window.blockk.store.ui.backdrop);
    await page.waitForSelector('#backdrop-scale');
    log((await bd()).w === 400, 'plano de fondo cargado y su bloque aparece en Configuraciones generales');

    // --- a escala: los extremos de la cota (300 px) son 6 m
    await page.click('#backdrop-scale');
    await page.mouse.click(...(await at(50, 150)));
    await page.mouse.click(...(await at(350, 150)));
    await page.fill('#backdrop-meters', '6');
    await page.press('#backdrop-meters', 'Enter');
    let b = await bd();
    log(Math.abs(b.cmPerPx - 2) < 0.02, `a escala con dos puntos y una medida (${b.cmPerPx.toFixed(3)} cm por px → ${((b.w * b.cmPerPx) / 100).toFixed(2)} m de ancho)`);

    await page.waitForSelector('#backdrop-opacity');
    await page.fill('#backdrop-opacity', '30');
    log((await bd()).opacity === 0.3, 'opacidad con el deslizador');

    await page.click('#backdrop-move');
    const [mx, my] = await at(200, 150);
    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + 60, my + 40, { steps: 4 });
    await page.mouse.up();
    const moved = await bd();
    log(moved.x > b.x && moved.y > b.y && Math.abs(moved.cmPerPx - b.cmPerPx) < 1e-9, 'el plano se mueve arrastrándolo, sin cambiar de escala');

    // --- calcar: un muro sobre la pared de abajo del plano
    await page.evaluate(() => window.blockk.setTool('wall'));
    await page.mouse.click(...(await at(50, 250)));
    await page.mouse.dblclick(...(await at(350, 250)));
    await ready();
    const drawn = await page.evaluate(() => ({ walls: window.blockk.store.project.levels[0].walls, json: JSON.stringify(window.blockk.store.project) }));
    const len = drawn.walls[0] ? (Math.abs(drawn.walls[0].x2 - drawn.walls[0].x1) * 12.5) / 100 : 0;
    log(drawn.walls.length === 1 && Math.abs(len - 6) <= 0.5, `muro dibujado encima del plano (${len} m sobre la cota de 6 m)`);
    log(!/backdrop|data:image/.test(drawn.json), 'el proyecto no lleva nada del plano de fondo');
    await page.keyboard.press('Escape');
    if (shots) await page.locator('#canvas').screenshot({ path: `${shots}/fondo-planta.png` });
    await page.click('#view-toggle button[data-view="iso"]');
    if (shots) await page.locator('#canvas').screenshot({ path: `${shots}/fondo-iso.png` });

    await page.waitForTimeout(700); // el guardado en IndexedDB va con una demora
    await page.reload();
    await ready();
    await page.waitForFunction(() => window.blockk.store.ui.backdrop, null, { timeout: 10000 }).catch(() => {});
    b = await bd();
    log(Boolean(b) && Math.abs(b.cmPerPx - moved.cmPerPx) < 1e-9 && b.opacity === 0.3 && Math.abs(b.x - moved.x) < 1e-6, 'tras recargar, el plano sigue con su escala, posición y opacidad');

    await page.evaluate(() => { window.blockk.store.setUi({ selection: null }); window.blockk.setTool('select'); });
    await page.click('#backdrop-remove');
    await page.waitForTimeout(700);
    await page.reload();
    await ready();
    await page.waitForTimeout(500);
    log((await bd()) === null, 'Quitar lo saca, también después de recargar');

    // --- PDF adjunto al asistente
    await page.click('#ai-fab');
    await page.setInputFiles('#ai-form input[type="file"]', { name: 'plano.pdf', mimeType: 'application/pdf', buffer: tinyPdf() });
    await page.waitForSelector('#ai-form .ai-attach.on img', { timeout: 30000 });
    log(/página 1 de 2/.test(await page.getAttribute('#ai-form input[type="text"]', 'placeholder')) && /2 páginas/.test(await page.locator('#ai-log').innerText()), 'el PDF se convierte a imagen y avisa que usa la página 1 de 2');
    if (shots) await page.locator('#ai-dialog').screenshot({ path: `${shots}/fondo-pdf.png` });
    await page.click('#ai-form button[type="submit"]');
    await page.waitForFunction(() => window.blockk.store.project.name === 'Quincho del plano', null, { timeout: 60000 });
    const adj = sent.at(-1)?.adjunto;
    log(adj?.tipo === 'image/jpeg' && adj.datos.length > 500, `al servidor viaja como imagen (${adj?.tipo}, ${adj?.datos.length} caracteres)`);
    await page.waitForSelector('#ai-backdrop', { timeout: 30000 });
    await page.click('#ai-backdrop');
    await page.waitForFunction(() => window.blockk.store.ui.backdrop);
    log(!(await page.isVisible('#ai-dialog')) && (await bd()).w > 300, '«Usar el plano como fondo» deja la misma imagen debajo de la casa calcada');
    if (shots) await page.locator('#canvas').screenshot({ path: `${shots}/fondo-calcado.png` });

    log(!errors.length, `sin errores de consola${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} falla(s)` : '\ntodo en orden');
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
