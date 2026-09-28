/*
 * Módulo global de todas las pantallas. Los estilos se enlazan desde el layout Twig con <link>
 * (no se importan desde JS: así la política CSP no necesita admitir módulos data:).
 * Cada pantalla suma su propio módulo de entrada (editor, bom, gallery, catalog) vía importmap.
 */
document.documentElement.classList.add('js');
