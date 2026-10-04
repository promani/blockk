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
| PHPUnit | Toda la suite de `tests/` (dominio, generador de casas, asistente con modelo guionado, plantillas, API). Si hay `redis-server`, `RedisStoreTest` corre contra una instancia efímera. Después restaura `config/reference.php`, que Symfony regenera al arrancar el kernel. |
| Sintaxis PHP | `php -l` sobre los `.php` modificados o nuevos. |
| ESLint | `assets/` con la configuración de la skill (`eslint.config.mjs`: módulos ES2024, globales de navegador, `no-undef`, `no-unused-vars`). |
| Asistente de IA (`scripts/asistente.cjs`) | `servidor-ia.sh` levanta `kimi-falso.cjs` (imita la API de Kimi con un guion; `GET /__log` cuenta las llamadas) y una segunda instancia de la app en el puerto 8091 apuntando a él. Galería: formulario inicial sin llamar al modelo, casa, sugerencia, pedido ambiguo con varias preguntas, abrir en el editor. Editor: botón flotante, cambio aplicado y deshacer. Galería: aviso antes de reemplazar y «Modificar con IA» de una plantilla. |
| Humo en el navegador (`scripts/humo.cjs`) | Levanta el servidor con `capturas/scripts/servidor.sh`. En cada plantilla: la Revisión sin errores, las pestañas, las 4 vistas, la planta y la página de cómputo. En un proyecto en blanco: habitación arrastrando el mouse, puerta, ventana, deshacer/rehacer, todas las herramientas y techo con un clic. Falla ante cualquier error de consola. |

## Si algo falla

- **Un test de PHPUnit**: leé el mensaje; los de `TemplateCatalogTest` exigen plantillas sin errores y descarte < 4 %.
- **Error de consola**: reproducilo con `capturas` (skill `capturas`) y mirá la captura; el mensaje trae la pila.
- **Humo con timeouts**: casi siempre es el servidor caído o un selector que cambió en la UI (`.tool`,
  `.level-tab`, `[data-view]`, `.tcard[data-slug]`). Si cambiaste la UI a propósito, actualizá `humo.cjs` en el
  mismo commit.
- Requisitos: PHP 8.4+ y Node. `.claude/tools/preparar.sh` instala lo demás (`vendor/`, Playwright y ESLint en
  `.claude/tools/node_modules`, Chromium); `verificar.sh` lo corre solo si falta. Anda en Linux y en macOS.

## Probar contra el Kimi real

Desde este entorno la API de Moonshot puede estar bloqueada por la red; la app desplegada sí llega. Se puede conversar
con su API pública (`POST /api/assistant/conversations` y `/messages`, con un `client` hexadecimal de 24 caracteres)
para ver cómo responde el modelo real: tiempos, cantidad de vueltas y si respeta las instrucciones de `Prompt.php`.
