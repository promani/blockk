/** Ayudantes mínimos de DOM: crear nodos sin innerHTML con datos del usuario (evita XSS). */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * h('div', {class: 'x', onclick: fn, dataset: {a: 1}}, 'texto', hijoNodo, [lista])
 * Los hijos de tipo string se insertan como texto (nunca como HTML).
 */
export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (key === 'html') throw new Error('h(): no se permite html; use nodos de texto');
        else if (value === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(value));
    }
    append(el, children);
    return el;
}

/** Agrega hijos a un nodo ignorando null/undefined/false (evita que se imprima "null"). */
export function add(el, ...children) {
    append(el, children);
    return el;
}

function append(el, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export function clear(el) {
    el.replaceChildren();
    return el;
}

export function svgEl(markup) {
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstElementChild;
}
