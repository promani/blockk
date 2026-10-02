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
        // si ya hay un proyecto, la Galería pide confirmar antes de reemplazarlo
        await page.click('#confirm-replace button[value="ok"]', { timeout: 1500 }).catch(() => {});
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

    for (const [kind, x, y] of [['door', 300, 500], ['window', 300, 0]]) {
        await page.click('.tool:has-text("Abertura")');
        await page.evaluate((k) => window.blockk.tools.opening.setKind(k), kind);
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

    // Elegir: rectángulo alrededor de la habitación y arrastre del grupo 1 m a la derecha
    await page.click('.tool:has-text("Elegir")');
    const drag = async (from, to) => {
        const p = await toScreen(...from);
        const q = await toScreen(...to);
        await page.mouse.move(p[0], p[1]);
        await page.mouse.down();
        await page.mouse.move(q[0], q[1], { steps: 10 });
        await page.mouse.up();
    };
    await drag([700, 600], [-20, -20]);
    const picked = await page.evaluate(() => document.querySelector('#tooloptions .tag')?.textContent ?? '');
    await drag([300, 250], [400, 250]);
    await page.waitForTimeout(300);
    await ready();
    const minX = await page.evaluate(() => Math.min(...window.blockk.store.project.levels[0].walls.map((w) => w.x1)));
    log(picked.startsWith('4 ') && minX === 8, `elegir con rectángulo y mover (${picked || 'nada'}; x = ${minX})`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.blockk.store.undo());
    await ready();

    // Pilar y nombre de ambiente; la abertura se mueve arrastrándola por el muro
    await page.click('.tool:has-text("Pilar")');
    const pc = await toScreen(200, 150);
    await page.mouse.move(pc[0], pc[1], { steps: 3 });
    await page.mouse.click(pc[0], pc[1]);
    await ready();
    await page.click('.tool:has-text("Nombre")');
    await page.fill('#tooloptions input[list="room-names"]', 'Estar');
    const pn = await toScreen(300, 250);
    await page.mouse.move(pn[0], pn[1], { steps: 3 });
    await page.mouse.click(pn[0], pn[1]);
    await ready();
    const named = await page.evaluate(() => [window.blockk.store.project.levels[0].columns.length, window.blockk.store.analysis.levels[0].rooms[0]?.name]);
    log(named[0] === 1 && named[1] === 'Estar', `pilar y nombre de ambiente (${named.join(', ')})`);
    await page.click('.tool:has-text("Elegir")');
    const win = await page.evaluate(() => { const o = window.blockk.store.project.levels[0].openings.find((q) => q.kind === 'window'); return { id: o.id, pos: o.pos }; });
    const wp = await toScreen(300, 0);
    await page.mouse.move(wp[0], wp[1], { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(wp[0] + 18, wp[1], { steps: 6 });
    await page.mouse.move(wp[0] + 36, wp[1], { steps: 6 });
    await page.mouse.up();
    await ready();
    const moved = await page.evaluate((id) => window.blockk.store.project.levels[0].openings.find((q) => q.id === id)?.pos, win.id);
    log(moved !== win.pos, `la ventana se mueve arrastrándola (pos ${win.pos} → ${moved})`);
    await page.keyboard.press('Escape');

    // Terreno: una pileta (zona) y un árbol; el antepecho de la ventana se elige desde el suelo
    await page.evaluate(() => window.blockk.setTool('zone'));
    const za = await toScreen(700, 100);
    const zb = await toScreen(900, 300);
    await page.mouse.move(za[0], za[1]);
    await page.mouse.down();
    await page.mouse.move(zb[0], zb[1], { steps: 8 });
    await page.mouse.up();
    await ready();
    await page.evaluate(() => window.blockk.setTool('tree'));
    const tp = await toScreen(1000, 450);
    await page.mouse.move(tp[0], tp[1], { steps: 3 });
    await page.mouse.click(tp[0], tp[1]);
    await ready();
    const site = await page.evaluate(() => [window.blockk.store.project.zones?.length ?? 0, window.blockk.store.project.trees?.length ?? 0]);
    log(site[0] === 1 && site[1] === 1, `pileta (zona) y árbol colocados (${site.join(', ')})`);
    await page.evaluate(() => {
        const o = window.blockk.store.project.levels[0].openings.find((q) => q.kind === 'window');
        window.blockk.setTool('select');
        window.blockk.store.setUi({ selection: { type: 'opening', id: o.id, wall: o.wall } });
    });
    await page.waitForTimeout(200);
    log(await page.evaluate(() => document.querySelector('#props').innerText.includes('Antepecho')), 'la ventana permite elegir el antepecho');
    await page.keyboard.press('Escape');

    await page.click('[data-view="iso"]');
    for (const tool of await page.$$eval('.tool .tool-name', (els) => els.map((e) => e.textContent))) {
        if (tool !== 'Techo') await page.click(`.tool:has-text("${tool}")`).catch(() => {});
    }
    // Techo está siempre en la barra y lleva a la pestaña Techo
    await page.click('.tool:has-text("Techo")');
    const lvl = await page.evaluate(() => window.blockk.store.ui.level);
    log(lvl === 2, `el botón Techo lleva a la pestaña Techo (nivel ${lvl})`);
    await page.click('.level-tab:has-text("Nivel 1")');
    const back = await page.evaluate(() => window.blockk.store.ui.tool);
    log(back === 'select', `al volver al Nivel 1 queda Elegir (${back})`);
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

    // 3) Escalera: se coloca con el mouse dentro de la habitación (girándose si hace falta) y se elige con un clic en
    //    un peldaño bajo y en uno alto, en isométrica y en planta.
    const evo = await (await page.request.get(`${base}/api/templates/vivienda-evolutiva`)).json();
    evo.levels[0].stairs = [];
    await page.evaluate((t) => localStorage.setItem('blockk.project.v1', JSON.stringify(t)), evo);
    await page.goto(`${base}/`);
    await ready();
    const box = await page.locator('#canvas').boundingBox();
    const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.blockk.cam.project(x, y, z), [x, y, z]);
    for (const view of ['iso', 'plan']) {
        await page.click(`[data-view="${view}"]`);
        await page.evaluate(() => { const s = window.blockk.store; s.commit('Sin escaleras', (d) => { d.levels[0].stairs = []; }); });
        await ready();
        await page.click('.level-tab:has-text("Nivel 1")');
        await page.keyboard.press('s');
        const [sx, sy] = await scr(60, 60, 0);
        await page.mouse.click(box.x + sx, box.y + sy);
        await ready();
        const st = await page.evaluate(() => ({ n: window.blockk.store.project.levels[0].stairs.length, sel: window.blockk.store.ui.selection?.type, bad: window.blockk.store.analysis.issues.filter((i) => i.code.startsWith('stair.') && i.severity === 'error').length }));
        log(st.n === 1 && st.sel === 'stair' && st.bad === 0, `escalera colocada dentro de la habitación y elegida (${view})`);
        const plan = await page.evaluate(() => window.blockk.store.analysis.floors.stairs[0]);
        for (const [name, stp] of [['bajo', plan.steps[0]], ['alto', plan.steps[plan.steps.length - 1]]]) {
            await page.evaluate(() => window.blockk.store.setUi({ selection: null }));
            const [x, y] = await scr((stp.x0 + stp.x1) / 2, (stp.y0 + stp.y1) / 2, stp.z);
            await page.mouse.click(box.x + x, box.y + y);
            const sel = await page.evaluate(() => window.blockk.store.ui.selection?.type);
            log(sel === 'stair', `clic en un peldaño ${name} elige la escalera (${view}): ${sel}`);
        }
    }
    checkConsole('escalera');

    await browser.close();
    console.log(fails.length ? `\n${fails.length} falla(s)` : '\ntodo en orden');
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
