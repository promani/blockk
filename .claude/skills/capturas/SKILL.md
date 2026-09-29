---
name: capturas
description: Saca capturas del editor 3D de Blockk Studio (vistas isométricas por nivel y con techo) con Chromium sin pantalla, y devuelve también los ambientes, las observaciones de la Revisión y los totales del proyecto. Usala para mostrarle al usuario cómo se ve una plantilla, un proyecto JSON o un cambio visual del editor, o para verificar con tus propios ojos un arreglo de dibujo (renderer.js, scene.js) antes de subirlo.
---

# Capturas del editor

El editor dibuja en un `<canvas>`, así que para "ver" un cambio hay que levantar la app, manejarla con Playwright y
mirar los PNG. Todo corre en local: `php -S` sirve la app y Chromium (sin pantalla) la abre.

## Pasos

1. Levantá el servidor (no hace nada si ya está activo):
   ```bash
   .claude/skills/capturas/scripts/servidor.sh
   ```
2. Sacá las capturas. `NODE_PATH` tiene que apuntar a donde esté instalado `playwright`
   (`export NODE_PATH=$(npm root -g)` si está global):
   ```bash
   node .claude/skills/capturas/scripts/capturas.cjs --slug casa-en-l --out <carpeta>
   ```
   Opciones:
   - `--slug <plantilla>`: abre una plantilla de la Galería (ver `GET /api/templates`).
   - `--project <archivo.json>`: carga un proyecto propio (mismo formato que exporta «Guardar»).
   - Sin ninguno de los dos: proyecto en blanco.
   - `--tabs "Nivel 1,Nivel 2,Techo"`: pestañas a capturar (por defecto `Nivel 1,Techo`; las que no existen se saltean).
   - `--rots 0,1,2,3`: las cuatro vistas isométricas (por defecto todas).
   - `--focus x,y,r`: primer plano centrado en (x, y) con radio r, **en cm** (1 unidad de grilla = 12,5 cm). Útil
     para mirar un vano o una esquina.
   - `--panel`: captura la página entera (con barras y panel) en vez de sólo el lienzo.
3. El script imprime un JSON con `rooms`, `issues` (con el elemento al que apunta cada observación), `total`,
   `files` y `consoleErrors`. Sale con código 1 si hubo errores de consola: tratalo como una falla.
4. **Mirá las imágenes** con la herramienta de lectura antes de sacar conclusiones, y mandale al usuario sólo las que
   sirven (por ejemplo, una con techo y una sin techo). Guardá los PNG en el scratchpad, no en el repo.

## Notas

- La app expone `window.blockk` (store, cámara, render) para pruebas: `store.load(project)`, `store.commit(label, fn)`,
  `cam.rot`, `cam.fit(x0, y0, x1, y1, zTop, margen)` (coordenadas en cm).
- El proyecto se analiza en el servidor de forma asíncrona: esperá a `store.fresh && !store.pendingCount` antes de
  leer `store.analysis`.
- Si `page.goto` da `ERR_CONNECTION_REFUSED`, el servidor se cayó: volvé a correr `servidor.sh`.
