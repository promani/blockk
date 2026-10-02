<?php

/**
 * Importmap de Blockk Studio. Cada pantalla tiene su propio módulo de entrada; el resto de los módulos
 * ES se resuelven por imports relativos (AssetMapper los expone con su hash, sin paso de build ni Node).
 */
return [
    'app' => ['path' => './assets/app.js', 'entrypoint' => true],
    'editor' => ['path' => './assets/editor/main.js', 'entrypoint' => true],
    'bom' => ['path' => './assets/bom/main.js', 'entrypoint' => true],
    'planos' => ['path' => './assets/planos/main.js', 'entrypoint' => true],
    'gallery' => ['path' => './assets/gallery/main.js', 'entrypoint' => true],
    'catalog' => ['path' => './assets/catalog/main.js', 'entrypoint' => true],
];
