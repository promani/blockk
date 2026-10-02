# Blockk Studio

Aplicación web para **diseñar casas de bloques de hormigón celular (HCCA)** y obtener el **cómputo de materiales**
listo para pedir: se dibuja la casa con muros a 90° (o se la pide a una IA), se la ve en 3D isométrico y el sistema
calcula el despiece pieza por pieza, los cortes, los bloques, pallets, morteros, hormigón, hierro, madera y un
presupuesto de referencia.

Producción: <https://blockk.unab.dpdns.org> · Stack: PHP 8.4 · Symfony 7.4 · Twig · AssetMapper (ES modules, sin paso
de build) · Canvas 2D · Redis (opcional) · PHPUnit 12.

## Documentación

| Documento | Qué cuenta |
| --- | --- |
| [VISION.md](VISION.md) | Problema, solución, alcance y cómo medimos que funciona. |
| [FEATURES.md](FEATURES.md) | Qué hace la aplicación y qué no (a propósito o todavía), pensado para compararla con otras herramientas. |
| [BACKLOG.md](BACKLOG.md) | Lo que sumaría valor sustantivo a futuro, priorizado, con valor y costo de cada ítem. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Componentes, flujos, API, datos y decisiones técnicas. |
| [EDITOR.md](EDITOR.md) | Funcionalidades y controles del editor, la Galería, el Cómputo y el Catálogo. |
| [LLM.md](LLM.md) | El asistente de IA: asistente por pasos, botón del editor, modelos, herramientas y cómo diagnosticarlo. |
| [HCCA.md](HCCA.md) | La tecnología constructiva, el catálogo de piezas y cómo se calculan los materiales. |
| [docs/DESIGN.md](docs/DESIGN.md) | Lineamientos de diseño de casas (zonas, circulación, sentido de puertas, orientación) y brechas del diseñador. |
| [CLAUDE.md](CLAUDE.md) | Guía rápida para sesiones de Claude Code (convenciones, skills, verificación). |
| [docs/](docs/) | Material de referencia (manual técnico del fabricante). |

## Instalar y ejecutar

Requisitos: PHP ≥ 8.4 con `ctype`, `iconv`, `intl`, `mbstring`, `xml`, `curl` y Composer 2. Node sólo hace falta para
las pruebas en el navegador (Playwright) y ESLint.

```bash
git clone https://github.com/promani/blockk.git && cd blockk
composer install
composer start      # http://127.0.0.1:8000
composer test       # PHPUnit
```

No hay base de datos: el proyecto que se dibuja vive en el navegador (`localStorage`, con exportar/abrir `.json`) y el
servidor es una API de cálculo sin estado. Sólo el asistente de IA guarda conversaciones y diseños (en Redis o, sin
`REDIS_URL`, en archivos de `var/assistant`).

### Variables de entorno

Todas tienen valor por defecto en `.env`; las secretas van en `.env.local` (no se versiona) o en el entorno.

| Variable | Para qué |
| --- | --- |
| `APP_ENV`, `APP_SECRET` | Entorno de Symfony (`dev`/`prod`) y secreto (obligatorio en producción). |
| `BLOCK_SYSTEM` | Sistema de bloques: `lika` (por defecto, 50 × 25 cm) o `generico` (62,5 × 25 cm). Ver [HCCA.md](HCCA.md). |
| `KIMI_API_KEY`, `KIMI_BASE_URL` | Clave y endpoint de la API de Kimi (por defecto `https://api.moonshot.ai/v1`). Sin clave, el asistente no aparece. |
| `KIMI_MODEL` | Modelo pesado: arma el JSON de la casa y las acciones directas. |
| `KIMI_MODEL_LIGHT` | Modelo liviano (mismo endpoint y clave): conversa, pregunta y delega. Vacío: todo lo hace `KIMI_MODEL`. |
| `KIMI_MODEL_VISION` | Modelo que lee imágenes, para calcar un plano adjunto. Vacío: lo hace `KIMI_MODEL` (tiene que aceptar imágenes). |
| `REDIS_URL`, `REDIS_PREFIX` | Persistencia del asistente (prefijo de claves `blockk:`). |
| `ASSISTANT_HOURLY_LIMIT`, `ASSISTANT_DAILY_LIMIT` | Mensajes al asistente por hora por IP (60) y por día en total (500). |
| `ADMIN_API_TOKEN` | Token de la API de administración (`/api/admin/*`, crear casas desde fuera del navegador). Vacío: la API no existe. Generarlo largo y aleatorio. |

### Producción

El `Dockerfile` arma una imagen PHP 8.4 + Apache que escucha en el **puerto 8080**, con los assets compilados y la
caché precalentada. Se despliega en Dokploy desde la rama `main` de este repo; las variables se cargan en el panel (o con
el MCP del laboratorio, ver [CLAUDE.md](CLAUDE.md)).

```bash
docker build -t blockk . && docker run -p 8080:8080 -e APP_SECRET=… blockk
```

## Verificación

`.claude/skills/verificar/scripts/verificar.sh` corre PHPUnit, la sintaxis PHP, ESLint y pruebas de punta a punta en
Chromium (todas las plantillas, dibujo con el mouse y el asistente de IA contra un Kimi simulado). Es lo que se corre
antes de cada push a `main`, que despliega.

## Alcance y aviso

Los controles son de **predimensionado y coherencia geométrica**: capacidades de pallet, luces de madera, consumos y
esbelteces son referenciales y **no reemplazan el cálculo estructural** (CIRSOC 501 / Eurocódigo 6) ni las fichas del
fabricante. Los precios son de ejemplo y editables.
