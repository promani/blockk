# Blockk Studio — guía para Claude Code

Diseñador de casas de bloques HCCA con cómputo de materiales y un asistente de IA. Antes de tocar algo, leé el
documento del área: [VISION.md](VISION.md), [ARCHITECTURE.md](ARCHITECTURE.md), [EDITOR.md](EDITOR.md),
[LLM.md](LLM.md), [HCCA.md](HCCA.md).

## Convenciones

- Idioma: interfaz, mensajes, comentarios y commits en **español rioplatense**, breve y concreto.
- Se trabaja **directo sobre `main`** y cada push despliega en Dokploy (<https://blockk.unab.dpdns.org>). A veces el
  push no dispara el deploy: forzarlo con la herramienta `redeployar_app_dokploy` del MCP `lab-mcp` y confirmar que la
  versión nueva esté en línea.
- **Antes de cada push, la skill `verificar`** (`.claude/skills/verificar/scripts/verificar.sh`): PHPUnit, ESLint y
  pruebas en Chromium, incluido el asistente contra un Kimi simulado. No subir con fallas.
- Cambios visuales del editor: mirarlos con la skill `capturas` antes de darlos por buenos.
- Casas nuevas para la Galería: skill `nueva-plantilla`.

## Dónde está cada cosa

- Reglas constructivas y cálculo: **sólo en PHP** (`src/Domain`); el JS no duplica reglas. Constantes en
  `src/Domain/Hcca.php`.
- Unidades: coordenadas en unidades de 12,5 cm (enteros); geometría interna en ticks de 0,5 mm.
- Editor: `assets/editor/`; asistente: `src/Assistant/` + `assets/lib/ai-chat.js`; generador de casas:
  `src/Domain/Design/`.
- Tests: `tests/` (PHPUnit). `phpunit.dist.xml` fuerza variables de Kimi falsas: los tests nunca usan credenciales
  reales ni la red.

## Entorno

- Variables: ver la tabla del [README.md](README.md). En producción se cargan en Dokploy (o con
  `setear_variables_dokploy` del MCP; `ver_variables_dokploy` muestra sólo los nombres).
- `.mcp.json` declara `lab-mcp` (token en `LAB_MCP_TOKEN`): deploy, variables, logs, Redis del laboratorio.
- En las sesiones en la nube la API de Kimi puede estar bloqueada por la red; para probar el modelo real, conversar con
  la API de la app desplegada y leer los logs (`ver_logs_dokploy`, líneas `[asistente]`).
- Servidor local: `composer start`; con el asistente contra Kimi simulado: `.claude/skills/verificar/scripts/servidor-ia.sh`
  (puerto 8091).
