const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/**
 * Cámara ortogonal con dos vistas que comparten el mismo centro de mundo:
 *  - 'iso'  : axonométrica isométrica 30°/30°.
 *  - 'plan' : cenital pura (planta).
 * La vista se puede girar en pasos de 90° (`rot`) alrededor del centro. Unidades de mundo: cm.
 */
export class Camera {
    constructor() {
        this.cx = 0;
        this.cy = 0;
        this.zoom = 0.2; // px por cm
        this.view = 'iso';
        this.rot = 0;
        this.w = 800;
        this.h = 600;
        this.zc = 150; // altura (cm) que queda en el centro de la pantalla
    }

    static rotate(x, y, rot) {
        switch (rot & 3) {
            case 0: return [x, y];
            case 1: return [-y, x];
            case 2: return [-x, -y];
            default: return [y, -x];
        }
    }

    /** Mundo (cm) → pantalla (px CSS). */
    project(x, y, z = 0) {
        const [X, Y] = Camera.rotate(x, y, this.rot);
        const [CX, CY] = Camera.rotate(this.cx, this.cy, this.rot);
        const dx = X - CX;
        const dy = Y - CY;
        if (this.view === 'plan') return [this.w / 2 + dx * this.zoom, this.h / 2 + dy * this.zoom];
        return [this.w / 2 + (dx - dy) * COS30 * this.zoom, this.h / 2 + ((dx + dy) * SIN30 - (z - this.zc)) * this.zoom];
    }

    /** Pantalla → punto del plano horizontal z (cm) en coordenadas de mundo. */
    unproject(sx, sy, z = 0) {
        const u = (sx - this.w / 2) / this.zoom;
        const v = (sy - this.h / 2) / this.zoom;
        let dx;
        let dy;
        if (this.view === 'plan') {
            dx = u;
            dy = v;
        } else {
            const a = u / COS30; // dx - dy
            const b = (v + (z - this.zc)) / SIN30; // dx + dy
            dx = (a + b) / 2;
            dy = (b - a) / 2;
        }
        const [CX, CY] = Camera.rotate(this.cx, this.cy, this.rot);
        return Camera.rotate(CX + dx, CY + dy, -this.rot & 3);
    }

    resize(w, h) {
        this.w = w;
        this.h = h;
    }

    /** Zoom manteniendo fijo el punto de mundo bajo (sx, sy) sobre el plano z. */
    zoomAt(factor, sx, sy, z = 0) {
        const before = this.unproject(sx, sy, z);
        this.zoom = Math.min(3, Math.max(0.02, this.zoom * factor));
        const after = this.unproject(sx, sy, z);
        this.cx += before[0] - after[0];
        this.cy += before[1] - after[1];
    }

    /** Desplaza la vista (px de pantalla) como si se arrastrara el plano z. */
    pan(dxPx, dyPx, z = 0) {
        const a = this.unproject(this.w / 2, this.h / 2, z);
        const b = this.unproject(this.w / 2 - dxPx, this.h / 2 - dyPx, z);
        this.cx += b[0] - a[0];
        this.cy += b[1] - a[1];
    }

    /** Cambia de vista dejando el punto de mundo (wx, wy, z) exactamente bajo el mismo píxel. */
    setView(view, anchorPx, z = 0) {
        if (view === this.view) return;
        const [sx, sy] = anchorPx ?? [this.w / 2, this.h / 2];
        const world = this.unproject(sx, sy, z);
        this.view = view;
        const q = this.unproject(sx, sy, z);
        this.cx += world[0] - q[0];
        this.cy += world[1] - q[1];
    }

    /** Gira la vista en pasos de 90° manteniendo el centro. */
    rotateBy(steps) {
        this.rot = (this.rot + steps + 4) & 3;
    }

    /** Encuadra un rectángulo de mundo (cm) con altura máxima zTop. */
    fit(minX, minY, maxX, maxY, zTop = 300, margin = 60) {
        this.cx = (minX + maxX) / 2;
        this.cy = (minY + maxY) / 2;
        this.zc = zTop / 2;
        const pts = [[minX, minY, 0], [maxX, minY, 0], [maxX, maxY, 0], [minX, maxY, 0], [minX, minY, zTop], [maxX, minY, zTop], [maxX, maxY, zTop], [minX, maxY, zTop]];
        this.zoom = 1;
        let lo = [Infinity, Infinity];
        let hi = [-Infinity, -Infinity];
        for (const [x, y, z] of pts) {
            const [sx, sy] = this.project(x, y, z);
            lo = [Math.min(lo[0], sx), Math.min(lo[1], sy)];
            hi = [Math.max(hi[0], sx), Math.max(hi[1], sy)];
        }
        const spanX = Math.max(1, hi[0] - lo[0]);
        const spanY = Math.max(1, hi[1] - lo[1]);
        this.zoom = Math.min(3, Math.max(0.02, Math.min((this.w - margin * 2) / spanX, (this.h - margin * 2) / spanY)));
    }
}
