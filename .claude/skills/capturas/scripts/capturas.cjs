#!/usr/bin/env node
/**
 * Capturas del editor de Blockk Studio con Playwright (Chromium sin pantalla).
 *
 *   node capturas.cjs --slug casa-en-l --out /tmp/shots
 *   node capturas.cjs --project mi-casa.json --tabs "Nivel 1,Techo" --rots 0,2
 *   node capturas.cjs --slug casa-en-l --focus 500,625,150 --rots 0   (x,y,radio en cm: primer plano)
 *
 * Imprime en JSON: ambientes, observaciones de la Revisión, totales y errores de consola. Sale con código 1 si hubo
 * errores de consola. Requiere el servidor corriendo (por defecto http://127.0.0.1:8000).
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
}, []));
const base = args.base ?? 'http://127.0.0.1:8000';
const out = path.resolve(args.out ?? 'capturas');
const tabs = (args.tabs ?? 'Nivel 1,Techo').split(',').map((s) => s.trim()).filter(Boolean);
const rots = (args.rots ?? '0,1,2,3').split(',').map(Number);
const focus = args.focus ? args.focus.split(',').map(Number) : null;
const tag = args.tag ?? args.slug ?? (args.project ? path.basename(args.project, '.json') : 'editor');
const panel = args.panel === 'true'; // true: página completa; si no, sólo el lienzo

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));

    if (args.slug) {
        await page.goto(`${base}/galeria`);
        await page.click(`.tcard[data-slug="${args.slug}"] [data-use]`);
        // si ya hay un proyecto, la Galería pide confirmar antes de reemplazarlo
        await page.click('#confirm-replace button[value="ok"]', { timeout: 1500 }).catch(() => {});
    } else {
        await page.goto(`${base}/`);
    }
    await page.waitForFunction(() => window.blockk?.store?.analysis);
    if (args.project) {
        const project = JSON.parse(fs.readFileSync(args.project, 'utf8'));
        await page.evaluate((p) => window.blockk.store.load(p), project);
        await page.waitForFunction(() => window.blockk.store.analysis);
    }
    await page.click('.guide-x').catch(() => {});

    const report = await page.evaluate(() => {
        const { store } = window.blockk;
        const a = store.analysis;
        const p = store.project;
        const find = (ref) => p.levels.flatMap((l) => [...l.walls, ...l.openings]).find((x) => x.id === ref);
        return {
            name: p.name,
            rooms: a.levels.map((l, i) => (l.rooms ?? []).map((r) => ({ level: i + 1, id: r.id, m2: r.area ?? r.netM2 }))).flat(),
            issues: (a.issues ?? []).map((i) => ({ severity: i.severity, code: i.code, ref: i.ref, message: i.message, element: find(i.ref) })),
            total: a.telemetry.total,
        };
    });

    // Encuadre: todos los muros del proyecto (o el foco pedido).
    const box = focus
        ? [focus[0] - focus[2], focus[1] - focus[2], focus[0] + focus[2], focus[1] + focus[2]]
        : await page.evaluate(() => {
            const ws = window.blockk.store.project.levels.flatMap((l) => l.walls);
            if (!ws.length) return [0, 0, 1000, 1000];
            const xs = ws.flatMap((w) => [w.x1, w.x2]).map((v) => v * 12.5);
            const ys = ws.flatMap((w) => [w.y1, w.y2]).map((v) => v * 12.5);
            return [Math.min(...xs) - 150, Math.min(...ys) - 150, Math.max(...xs) + 150, Math.max(...ys) + 150];
        });

    const files = [];
    const canvas = await page.$('canvas');
    const clip = panel ? undefined : await canvas.boundingBox();
    for (const t of tabs) {
        const ok = await page.click(`.level-tab:has-text("${t}")`, { timeout: 3000 }).then(() => true).catch(() => false);
        if (!ok) { console.error(`pestaña «${t}» no encontrada`); continue; }
        for (const r of rots) {
            await page.evaluate(([b, r, z]) => {
                const c = window.blockk.cam;
                c.rot = r;
                c.fit(b[0], b[1], b[2], b[3], z, 20);
                window.blockk.render();
            }, [box, r, focus ? 300 : 600]);
            await page.waitForTimeout(250);
            const file = path.join(out, `${tag}-${t.toLowerCase().replace(/\s+/g, '')}-v${r}.png`);
            await page.screenshot({ path: file, clip });
            files.push(file);
        }
    }
    await browser.close();
    console.log(JSON.stringify({ ...report, files, consoleErrors: errors }, null, 1));
    process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
