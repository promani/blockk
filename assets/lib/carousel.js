import { h, add } from './dom.js';

const LABELS = ['Planta', 'Isométrica'];
const STEP_MS = 1800;

/**
 * Carrusel de miniaturas (planta e isométrica). Quieto por defecto: pasa solo mientras el mouse está encima y, al
 * salir, vuelve a la primera vista. También se maneja con las flechas, los puntos o deslizando el dedo.
 */
export function carousel(el) {
    if (el.dataset.ready) return el;
    el.dataset.ready = '1';
    const track = el.querySelector('.car-track');
    const count = () => track.children.length;
    let index = 0;
    let timer = null;

    const dots = h('div', { class: 'car-dots' });
    const go = (i) => {
        index = (i + count()) % count();
        track.style.transform = `translateX(${-100 * index}%)`;
        [...track.children].forEach((s, k) => s.setAttribute('aria-hidden', String(k !== index)));
        [...dots.children].forEach((d, k) => d.setAttribute('aria-pressed', String(k === index)));
    };
    const stop = () => {
        clearInterval(timer);
        timer = null;
    };
    const arrow = (dir, label, text) => h('button', { type: 'button', class: `car-arrow car-${dir}`, 'aria-label': label, onclick: (e) => { e.stopPropagation(); stop(); go(index + (dir === 'next' ? 1 : -1)); } }, text);

    for (let k = 0; k < count(); k++) {
        add(dots, h('button', { type: 'button', 'aria-label': `Ver ${(LABELS[k] ?? `vista ${k + 1}`).toLowerCase()}`, onclick: (e) => { e.stopPropagation(); stop(); go(k); } }));
    }
    add(el, arrow('prev', 'Vista anterior', '‹'), arrow('next', 'Vista siguiente', '›'), dots);
    el.setAttribute('role', 'group');
    el.setAttribute('aria-roledescription', 'carrusel');

    // Con mouse: al entrar pasa a la vista siguiente y sigue girando; al salir vuelve a la primera.
    el.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse' || timer || count() < 2) return;
        go(index + 1);
        timer = setInterval(() => go(index + 1), STEP_MS);
    });
    el.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'mouse') return;
        stop();
        go(0);
    });

    // Con el dedo: deslizar a los costados.
    let x0 = null;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 30) go(index + (dx < 0 ? 1 : -1));
    });

    go(0);
    return el;
}

/** Carrusel nuevo a partir de las fuentes de cada vista (data URL o ruta). */
export function carouselOf(slides, cls = 'thumb carousel') {
    const track = h('div', { class: 'car-track' }, slides.map(({ src, alt }) => h('img', { class: 'car-slide', src, alt, width: 640, height: 400 })));
    return carousel(h('div', { class: cls, 'data-carousel': '' }, track));
}
