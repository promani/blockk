import { analyze, solarPath } from '../lib/api.js';
import { saveProject, blankProject } from '../lib/storage.js';

const HISTORY_LIMIT = 60;

/**
 * Estado del editor: proyecto normalizado + análisis del servidor + estado de interfaz.
 *
 * Toda edición pasa por `commit(label, mutate)`: se clona el proyecto, se aplica la mutación, se
 * envía al servidor (que normaliza muros, valida y calcula) y se reemplaza el estado con la
 * respuesta. Las respuestas viejas se descartan (control de carrera) y, si falla la red, se revierte.
 */
export class Store extends EventTarget {
    constructor(config) {
        super();
        this.config = config;
        this.project = blankProject();
        this.analysis = null;
        this.fresh = false; // ¿el análisis corresponde al proyecto actual?
        this.history = [];
        this.future = [];
        this.seq = 0;
        this.pendingCount = 0;
        this.ui = {
            level: 0,
            view: 'iso',
            tool: 'select',
            selection: null,
            snap: 1,
            cut: config.courses,
            thickness: 20,
            solar: { show: true, hour: 12, season: 'winter', path: null, pathKey: '' },
        };
    }

    emit(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail }));
    }

    get pending() {
        return this.pendingCount > 0;
    }

    level() {
        return this.project.levels[this.ui.level];
    }

    setUi(patch, { silent = false } = {}) {
        for (const [k, v] of Object.entries(patch)) {
            if (k === 'solar') Object.assign(this.ui.solar, v);
            else this.ui[k] = v;
        }
        if (!silent) this.emit('ui', patch);
    }

    /** Cambios de metadatos que no alteran la geometría (nombre, orientación, latitud, ajustes): sin historial. */
    patchProject(patch) {
        this.project = { ...this.project, ...patch };
        saveProject(this.project);
        this.emit('ui', patch);
    }

    /** Carga un proyecto nuevo (sin historial) y lo analiza. */
    async load(project, { keepHistory = false } = {}) {
        if (!keepHistory) {
            this.history = [];
            this.future = [];
        }
        this.project = project;
        this.ui.thickness = project.settings?.defaultT ?? 20;
        this.ui.selection = null;
        this.analysis = null;
        this.fresh = false;
        this.emit('ui', {});
        await this.#analyze(project, null);
    }

    async commit(label, mutate) {
        const before = { project: this.project, analysis: this.fresh ? this.analysis : null, label };
        const draft = structuredClone(this.project);
        mutate(draft);
        this.history.push(before);
        if (this.history.length > HISTORY_LIMIT) this.history.shift();
        this.future = [];
        this.project = draft;
        this.fresh = false;
        this.emit('ui', {});
        await this.#analyze(draft, before);
    }

    async undo() {
        if (!this.history.length) return;
        this.future.push({ project: this.project, analysis: this.fresh ? this.analysis : null });
        await this.#restore(this.history.pop());
    }

    async redo() {
        if (!this.future.length) return;
        this.history.push({ project: this.project, analysis: this.fresh ? this.analysis : null });
        await this.#restore(this.future.pop());
    }

    async #restore(entry) {
        this.project = entry.project;
        this.ui.selection = null;
        if (entry.analysis) {
            this.seq++;
            this.analysis = entry.analysis;
            this.fresh = true;
            saveProject(this.project);
            this.emit('change');
            return;
        }
        this.fresh = false;
        await this.#analyze(this.project, null);
    }

    async refresh() {
        await this.#analyze(this.project, null);
    }

    async #analyze(draft, fallback) {
        const seq = ++this.seq;
        this.pendingCount++;
        this.emit('status');
        try {
            const res = await analyze(draft);
            if (seq !== this.seq) return;
            this.project = res.project;
            this.analysis = res.analysis;
            this.fresh = true;
            saveProject(this.project);
            this.emit('change');
            for (const n of res.analysis.notices ?? []) this.emit('toast', { message: n, kind: 'info' });
        } catch (err) {
            if (seq !== this.seq) return;
            if (fallback) {
                this.project = fallback.project;
                this.analysis = fallback.analysis ?? this.analysis;
                this.fresh = Boolean(fallback.analysis);
                this.history.pop();
            }
            this.emit('toast', { message: `No se pudo calcular el proyecto (${err.message}).`, kind: 'error' });
            this.emit('change');
        } finally {
            this.pendingCount--;
            this.emit('status');
        }
    }

    /** Trayectoria solar del servidor para la latitud y época actuales (con caché por clave). */
    async ensureSolar() {
        const key = `${this.project.lat}:${this.ui.solar.season}`;
        if (this.ui.solar.pathKey === key && this.ui.solar.path) return;
        try {
            const data = await solarPath(this.project.lat, this.ui.solar.season);
            this.ui.solar.path = data.path;
            this.ui.solar.label = data.label;
            this.ui.solar.pathKey = key;
            this.emit('solar');
        } catch {
            /* sin sol: el editor sigue funcionando */
        }
    }

    /** Sol interpolado a la hora elegida: { h, alt, az } o null. */
    sun() {
        const path = this.ui.solar.path;
        if (!path?.length) return null;
        const h = this.ui.solar.hour;
        let i = path.findIndex((p) => p.h >= h);
        if (i <= 0) return { ...path[Math.max(0, i)], h };
        const a = path[i - 1];
        const b = path[i];
        const t = (h - a.h) / (b.h - a.h || 1);
        let dAz = b.az - a.az;
        if (dAz > 180) dAz -= 360;
        if (dAz < -180) dAz += 360;
        return { h, alt: a.alt + (b.alt - a.alt) * t, az: (a.az + dAz * t + 360) % 360 };
    }
}
