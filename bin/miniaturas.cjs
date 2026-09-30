#!/usr/bin/env node
/*
 * Genera las miniaturas de la Galería (planta e isométrica) con el mismo renderer del editor, en Chromium sin pantalla.
 * Sólo dibuja las que faltan o quedaron viejas (el nombre lleva un hash del proyecto); --todas las rehace. Borra las
 * que ya no corresponden a ninguna plantilla.
 *
 *   composer miniaturas            (levanta el servidor local si hace falta)
 *   node bin/miniaturas.cjs [--todas] [--url http://127.0.0.1:8000]
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const all = args.includes('--todas');
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8000';
const dir = path.join(root, 'public', 'img', 'plantillas');

(async () => {
    const list = JSON.parse(execFileSync('php', [path.join(root, 'bin', 'console'), 'app:miniaturas'], { cwd: root, encoding: 'utf8' }));
    fs.mkdirSync(dir, { recursive: true });
    const keep = new Set(list.flatMap((t) => Object.values(t.paths).map((p) => path.basename(p))));
    const todo = list.filter((t) => all || !t.ok);

    if (todo.length) {
        const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`${url}/galeria`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => typeof window.blockkThumbs === 'function');
        for (const t of todo) {
            const views = await page.evaluate(async (slug) => {
                const json = async (r) => { if (!r.ok) throw new Error(`${r.url}: ${r.status}`); return r.json(); };
                const project = await json(await fetch(`/api/templates/${slug}`));
                const result = await json(await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) }));
                const solar = await json(await fetch(`/api/solar?lat=${project.lat ?? -34.6}&season=winter`)).catch(() => null);
                return window.blockkThumbs({ project: result.project, analysis: result.analysis, solarPath: solar?.path });
            }, t.slug);
            for (const [view, rel] of Object.entries(t.paths)) {
                const data = views[view].replace(/^data:image\/webp;base64,/, '');
                fs.writeFileSync(path.join(root, 'public', rel), Buffer.from(data, 'base64'));
            }
            console.log(`ok   ${t.slug}`);
        }
        await browser.close();
        if (errors.length) {
            console.error(errors.join('\n'));
            process.exit(1);
        }
    }
    for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.webp') && !keep.has(f)) {
            fs.unlinkSync(path.join(dir, f));
            console.log(`borrada ${f}`);
        }
    }
    console.log(todo.length ? `${todo.length} plantilla(s) dibujadas` : 'miniaturas al día');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
