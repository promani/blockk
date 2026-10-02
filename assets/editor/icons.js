/** Iconos de herramientas (24×24, trazo currentColor). */
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
    select: svg('<path d="M5 3l14 8-6 2-2 6z"/>'),
    room: svg('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 9h4M16 15h4M8 5v4M16 15v4" stroke-width="1.4"/>'),
    wall: svg('<path d="M4 18L20 6"/><rect x="2.5" y="16.5" width="3" height="3"/><rect x="18.5" y="4.5" width="3" height="3"/>'),
    block: svg('<path d="M4 9l8-4 8 4v7l-8 4-8-4z"/><path d="M4 9l8 4 8-4M12 13v7"/>'),
    opening: svg('<path d="M6 21V4h9l3 2v15"/><path d="M4 21h16"/><rect x="9" y="9" width="4" height="4" rx=".5" stroke-width="1.3"/>'),
    door: svg('<path d="M6 21V4h9l3 2v15"/><path d="M4 21h16"/><circle cx="13" cy="13" r=".8" fill="currentColor"/>'),
    window: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>'),
    ubeam: svg('<path d="M4 7h16v11H4z"/><path d="M8 7v7h8V7"/>'),
    floor: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18M3 13h18M3 17h18" stroke-width="1.3"/>'),
    slab: svg('<path d="M3 10l9-5 9 5-9 5z"/><path d="M3 10v3l9 5 9-5v-3"/>'),
    stair: svg('<path d="M4 20h4v-4h4v-4h4V8h4"/><path d="M4 20V4M20 8v12" stroke-width="1.2"/>'),
    roof: svg('<path d="M3 13l9-7 9 7"/><path d="M5 12v7h14v-7" stroke-width="1.3"/>'),
    column: svg('<rect x="8" y="3" width="8" height="18" rx="1"/><path d="M6 21h12M6 3h12"/>'),
    label: svg('<path d="M4 7h16M4 12h10M4 17h13"/><path d="M18 12l2 2-2 2" stroke-width="1.4"/>'),
    zone: svg('<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M6 11c2-2 3 2 5 0s3 2 5 0" stroke-width="1.4"/>'),
    tree: svg('<circle cx="12" cy="9" r="6"/><path d="M12 15v6M9 21h6"/>'),
    measure: svg('<path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2" stroke-width="1.4"/>'),
    beam: svg('<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M6 9v6M18 9v6" stroke-width="1.3"/>'),
};
