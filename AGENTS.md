# Blockk Studio — guía para agentes

Diseñador de casas de bloques HCCA con cómputo de materiales y un asistente de IA. Symfony 7.4 / PHP 8.4,
monolito sin base de datos (Redis sólo para lo que la persona guarda) y editor en el navegador con JS nativo
(AssetMapper, sin build). Este archivo es el mapa; el detalle está en [ARCHITECTURE.md](ARCHITECTURE.md),
[EDITOR.md](EDITOR.md), [LLM.md](LLM.md), [HCCA.md](HCCA.md), [docs/DESIGN.md](docs/DESIGN.md) y [CLAUDE.md](CLAUDE.md).

## Módulos principales

| Qué | Dónde |
| --- | --- |
| Motor de cálculo y reglas constructivas (PHP puro, sin framework) | `src/Domain/` — constantes en `Hcca.php` |
| Modelo y validación de entrada (`ProjectFactory` es la frontera de confianza) | `src/Domain/Model/` |
| Geometría: normalización de muros, topología, ambientes | `src/Domain/Geometry/` |
| Hiladas y trabas | `src/Domain/Masonry/` |
| Cortes y aprovechamiento de bloques | `src/Domain/Cutting/` |
| Losas y escaleras / techos / sol | `src/Domain/Floor/`, `src/Domain/Roof/`, `src/Domain/Solar/` |
| Cómputo y precios | `src/Domain/Bom/` |
| Observaciones de la Revisión | `src/Domain/Validation/` |
| Generador y editor de casas (programa de ambientes → proyecto) | `src/Domain/Design/` |
| Plantillas de la Galería | `src/Domain/Templates/` |
| API HTTP | `src/Controller/Api/` (cálculo, asistente, Mis casas, compartidos, admin); páginas en `src/Controller/PageController.php` y `templates/` |
| Asistente de IA (Kimi, dos modelos) | `src/Assistant/` + `assets/lib/ai-chat.js` |
| Mis casas / enlaces compartidos (Redis) | `src/Houses/`, `src/Share/` |
| Editor en el navegador | `assets/editor/` |
| Cómputo, Galería, Catálogo, comparador | `assets/{bom,gallery,catalog,compare}/` |

## Cómo fluye una request típica

1. El editor (`assets/editor/`) arma el proyecto JSON y hace `POST /api/analyze` (`ProjectApiController`).
2. `ProjectFactory` valida e hidrata el `Project` (`422` si es inválido).
3. `ProjectAnalyzer` ejecuta el pipeline: `WallNormalizer` → `Topology` → `RegionAnalyzer` → `CourseBuilder` →
   `StockPacker`/`CutPlanner` → planificadores de losas, escaleras y techo → `BomCalculator` → `ProjectValidator`.
4. La respuesta trae el proyecto normalizado y el análisis (hiladas, ambientes, cómputo, observaciones); el
   cliente reemplaza su estado y redibuja en Canvas 2D. El cliente no duplica reglas.

El asistente (`/api/assistant/*`) usa el mismo motor como herramienta: el modelo elige un programa u operación,
`HouseGenerator`/`HouseEditor` construyen y el motor valida.

## Comandos

```bash
composer install               # dependencias (+ pdf.js vía importmap:install)
vendor/bin/phpunit             # tests (también `composer test`); ~30 s, sin red ni credenciales
composer start                 # servidor local en 127.0.0.1:8000
```

`.claude/skills/verificar/scripts/verificar.sh` suma ESLint y pruebas en Chromium (Playwright); necesita
`.claude/tools/preparar.sh` la primera vez. En el contenedor del agente sólo `composer install` y
`vendor/bin/phpunit` están garantizados; no hay comando de lint ni de build de PHP definido (el front no tiene build).
CI (`.github/workflows/ci.yml`) corre `composer install` y `vendor/bin/phpunit`.

## Convenciones

- Idioma: interfaz, mensajes, comentarios y commits en español rioplatense, breve y concreto.
- Reglas constructivas y cálculo **sólo en PHP** (`src/Domain`); el JS no las duplica.
- Unidades: coordenadas en unidades de 12,5 cm (enteros); geometría interna en ticks de 0,5 mm.
- Bloques: nada de largos fijos; usar `Hcca::blockL()`/`thicknesses()` en PHP y `config.blockL`/`blockUnits` en JS.
  Los tests del módulo de 62,5 cm llaman a `Hcca::useSystem('generico')`.
- Tests en `tests/` (PHPUnit); `phpunit.dist.xml` fuerza variables de Kimi falsas: nunca credenciales reales ni red.
- Secretos (`KIMI_API_KEY`, `LAB_MCP_TOKEN`, `ADMIN_API_TOKEN`) nunca se versionan; las variables están en el README.
- Rutas que el agente no toca: ver `.agent/protected-paths`.
- Git: los humanos del repo trabajan sobre `main`; el agente de Zordon siempre usa rama `agent/<KEY>` + PR.
