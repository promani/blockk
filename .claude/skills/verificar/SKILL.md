---
name: verificar
description: Rutina de verificación de Blockk Studio antes de hacer commit o push. Corre PHPUnit, la sintaxis PHP de los archivos tocados, ESLint sobre assets/ y una prueba de humo en Chromium que recorre todas las plantillas y dibuja un proyecto con el mouse. Usala siempre antes de subir un cambio al repo y cuando el usuario pida probar o validar algo.
---

# Verificar antes de subir

```bash
.claude/skills/verificar/scripts/verificar.sh            # todo
.claude/skills/verificar/scripts/verificar.sh --rapido   # sin navegador (sólo PHP + ESLint)
```

Termina con `VERIFICACIÓN OK` o `VERIFICACIÓN CON FALLAS` (código de salida 0 o 1). No subas nada con fallas.

## Qué revisa

| Paso | Detalle |
| --- | --- |
| PHPUnit | Toda la suite de `tests/` (dominio, plantillas, API). Después restaura `config/reference.php`, que Symfony regenera al arrancar el kernel. |
| Sintaxis PHP | `php -l` sobre los `.php` modificados o nuevos. |
| ESLint | `assets/` con la configuración de la skill (`eslint.config.mjs`: módulos ES2024, globales de navegador, `no-undef`, `no-unused-vars`). |
| Humo en el navegador (`scripts/humo.cjs`) | Levanta el servidor con `capturas/scripts/servidor.sh`. En cada plantilla: la Revisión sin errores, las pestañas, las 4 vistas, la planta y la página de cómputo. En un proyecto en blanco: habitación arrastrando el mouse, puerta, ventana, deshacer/rehacer, todas las herramientas y techo con un clic. Falla ante cualquier error de consola. |

## Si algo falla

- **Un test de PHPUnit**: leé el mensaje; los de `TemplateCatalogTest` exigen plantillas sin errores y descarte < 4 %.
- **Error de consola**: reproducilo con `capturas` (skill `capturas`) y mirá la captura; el mensaje trae la pila.
- **Humo con timeouts**: casi siempre es el servidor caído o un selector que cambió en la UI (`.tool`,
  `.level-tab`, `[data-view]`, `.tcard[data-slug]`). Si cambiaste la UI a propósito, actualizá `humo.cjs` en el
  mismo commit.
- Requisitos: PHP 8.4 con `vendor/` instalado, Node con `playwright` y `eslint` accesibles por `NODE_PATH`
  (`npm root -g`), y Chromium para Playwright.
