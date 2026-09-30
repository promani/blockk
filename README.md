# Blockk Studio

Plataforma web de **modelado modular y cómputo constructivo en Hormigón Celular Curado en Autoclave (HCCA)**.
Se dibuja una vivienda con muros ortogonales a 90° (estilo bloques modulares), se ve en isométrica o en planta,
y el sistema genera el **despiece real pieza por pieza**, la **optimización de cortes**, el **cómputo de materiales**
(bloques, pallets, morteros, hormigón, armadura, madera) y una cotización referencial exportable.

> **Stack:** PHP 8.4 · Symfony 7.4 (LTS) · Twig · AssetMapper (ES modules, sin Node ni paso de build) · Canvas 2D · PHPUnit 12.

Alcance implementado: **Fase 1 (MVP)** del PRD. Ver [Alcance](#alcance).

## Ejecutar

Requisitos: PHP ≥ 8.4 (extensiones habituales de Symfony: `ctype`, `iconv`, `intl`, `mbstring`, `xml`) y Composer.

```bash
composer install
composer start            # php -S 127.0.0.1:8000 -t public   →   http://127.0.0.1:8000
composer test             # PHPUnit (144 tests)
```

En producción: `APP_ENV=prod composer install --no-dev -o && php bin/console asset-map:compile && php bin/console cache:warmup`
y servir `public/` con PHP-FPM/Nginx/Apache o FrankenPHP. No hay base de datos: el proyecto vive en el navegador
(`localStorage`, con exportar/abrir `.json`) y el servidor es una API de cálculo sin estado.

## Pantallas

| Ruta | Pantalla |
|---|---|
| `/` | **Editor 3D e isométrico**: barra de herramientas con nombres que cambia según la pestaña — Nivel 1: Elegir (V), **Mover (M)**, Habitación (R), Muro (W), Puerta (P), Ventana (N), Escalera (S); Nivel 2: las mismas con **Piso** (L: losa de hormigón o entrepiso de madera) en lugar de Escalera; Techo: Elegir y **Techo** (H); bajo «Más»: Bloque (B), Viga U (U) y Viga de madera (T). Una guía **«Próximo paso»** propone qué hacer y abre la herramienta con un clic; vistas Isométrica / Planta (`Tab`), un **selector de vistas** abajo a la izquierda (un ojo en cada esquina de la planta; también `[` `]`), la brújula con el sol arriba a la derecha, pestañas Nivel 1 / Nivel 2 / **Techo**, asoleamiento, telemetría en vivo, validación. |
| `/computo` | **Cómputo y despiece**: KPIs, desglose por nivel, patrones de corte, madera, cotización con precios editables, envío a distribuidor (correo/WhatsApp), exportación **CSV** y **PDF vectorial** (generados en el navegador). |
| `/galeria` | **Plantillas modulares** (1 planta, 2 plantas, evolutiva, quincho, dúplex, luz libre) con miniaturas SVG y métricas calculadas por el motor; proyecto en blanco con retícula parametrizable. |
| `/catalogo` | **Catálogo técnico**: fichas de piezas, reglas de modulación, calculadora rápida de paño y mortero, FAQ de obra seca. |

Atajos: `V R W P N S L H B U T` herramientas · `Ctrl+Z / Ctrl+Y` deshacer/rehacer · `Supr` eliminar · 
rueda = zoom · clic central o `Espacio`+arrastre = paneo · `F` encuadrar · `X` gira el bloque / la escalera · `1` `2` `3` Nivel 1 / Nivel 2 / Techo.

Edición: la retícula del suelo es sólo una guía (línea por metro, más marcada cada 5 m); al dibujar aparecen puntos de ajuste junto al cursor y un **imán** azul pega el trazo al eje o extremo de la pared más cercana (del nivel o del de abajo). Todo se dibuja en bloques enteros de 62,5 cm (no hay que elegir cómo se colocan los bloques; el imán y los anclajes permiten pegarse a muros existentes). Habitación y Muro se comportan igual: dibujar las cuatro paredes a mano da la misma habitación que la herramienta Habitación, y al volver al punto de partida la cadena de muros se cierra sola. Los bordes se alinean con paredes vecinas para hacer habitaciones contiguas. Cada habitación cerrada se pinta con su propio color de piso; al elegirla (clic en el piso) aparecen **esquinas azules** que la agrandan o achican moviendo los muros que la forman. **Techos:** en la pestaña Techo se dibujan como habitaciones (rectángulo o clic dentro de un ambiente); cada uno tiene su tipo (a un agua / a dos aguas), pendiente, alero y cabios, y apoya sobre el Nivel 1 o el Nivel 2, así que se puede cubrir sólo parte de la casa. Los **hastiales** de bloque (y el muro alto de un techo a un agua) se despiezan hilada por hilada con traba de medio bloque y sus bloques se suman a «Bloques a comprar», pallets, mortero y costo; son seleccionables (se quitan o cambian de espesor). Los cabios apoyan sobre el borde exterior del muro. Al arrastrar un muro, una esquina o el borde de un techo aparecen **guías de alineación** (muros de abajo en naranja, paredes vecinas en azul) y a menos de 25 cm se pega a ellas; si el muro llega justo a la línea de la pared vecina, el tramo sobrante se absorbe y los muros que llegan se estiran. Al elegir una habitación (doble clic en su piso, o desde el muro), el panel **sugiere** agrandarla hasta los muros de abajo o la pared vecina con un clic. La losa o el entrepiso del Nivel 2 es una sola placa con el hueco de la escalera recortado y su cara superior queda al nivel del piso de arriba (la escalera llega sin escalón extra). Los techos se estiran desde sus esquinas o bordes, y **si dos techos se superponen sólo queda el más alto** (dos techos a dos aguas cruzados forman una cruz, con cubierta, cabios y hastiales computados sólo en lo visible). Cada muro tiene su **alto** (de 50 cm a 3,00 m; sin nada encima, hasta 4,00 m) y una **corona de bloques U** que se puede sacar en paredes que son sólo mampostería; el despiece, el cómputo y las validaciones (vanos que no entran, apoyo de la Planta Alta y del techo) lo tienen en cuenta. **Mover** elige varios elementos con un rectángulo (muros con sus vanos, escaleras, pisos y techos de todos los niveles) o toda la casa (Ctrl+A) y los corre juntos dentro del terreno (arrastre o flechas, de a 62,5 cm). Sin nada elegido, el panel **Configuraciones generales** tiene el tamaño del terreno, hacia dónde queda el norte y el sol (época, latitud, hora, sombras). El **Resumen** y la **Revisión** se adaptan a lo que se está haciendo: con Ventana/Puerta muestran vidrio, luz natural por habitación (referencia ≥ 1/8 del piso), vidrio por orientación y el botón para sugerir ventanas según el sol; con un muro, sus piezas, cortes y bloques U; con una habitación, su superficie y luz; con Piso o Escalera, losas, tirantes y escaleras; en la pestaña Techo, los techos. La Revisión muestra primero lo que corresponde y deja el resto del proyecto a un clic. Con un muro elegido, su **manija azul** (o los botones ▲▼◀▶) lo corre y estira los muros que llegan a él, y arrastra al muro de arriba.

## Reglas constructivas que aplica el motor

| Regla (PRD) | Dónde |
|---|---|
| Solo muros ortogonales (90°) | `Wall`, `ProjectFactory` |
| **Máximo 2 niveles con muros** (PB + PA ≤ 6,00 m). La casa nace con 1 nivel + pestaña **Techo**; «+ Agregar nivel» crea el Nivel 2 y el techo pasa a apoyar sobre él. No existe un 3.er nivel | `Hcca::MAX_LEVELS`, `Project::upper`, UI |
| Módulo 62,5 × 25 cm; submódulo de retícula 12,5 cm; nivel = 11 hiladas + 1 de bloque U = 12 hiladas = 3,00 m | `Hcca`, `CourseBuilder` |
| Espesores: portantes 15/20 cm, tabiques 10/7,5 cm | `Hcca::THICKNESSES_CM` |
| **Traba ≥ 12,5 cm** entre juntas verticales de hiladas consecutivas; encuentros a 90° alternados hilada a hilada; T con anclajes | `CourseBuilder`, `Topology`, `BomCalculator` |
| Dinteles y viga corona en **bloque U** relleno con hormigón y armadura; jambas y apoyos ≥ 25 cm | `CourseBuilder`, `OpeningPlacement`, `ProjectValidator` |
| Entrepiso de madera (3″×8″, 40 cm entre ejes), apoyo ≥ 10 cm sobre viga corona con banda elástica, muros ≥ 15 cm, placas de reparto | `TimberPlanner` |
| Algoritmo de aprovechamiento de cortes: el remanente se reasigna como jamba o inicio de la hilada siguiente | `StockPacker` (en línea) + `CutPlanner` (final) |
| Pallets completos (1,44–1,80 m³ según espesor), mortero adhesivo 1,5–2,5 kg/m² | `Hcca`, `BomCalculator` |
| Asoleamiento: rosa de los vientos, sol de 06:00 a 19:00, sombras, sugeridor de aberturas (ganancia solar + ventilación cruzada) | `SunCalculator`, `ExposureAnalyzer`, `OpeningSuggester` |

**Resultados medidos** (tests y plantillas; el motor además se sometió a fuzzing de ~22.000 proyectos aleatorios contra los invariantes de traba, cobertura, piezas mínimas y cómputo): descarte de material 0,7–1,2 % (objetivo PRD < 4 %); la superficie de mampostería
coincide exactamente con el cómputo manual (test `wallAreaMatchesTheManualComputationExactly`).

## Arquitectura

```
navegador (Canvas 2D, ES modules)            servidor (Symfony, sin estado)
 ├─ editor: herramientas, cámara,     POST   ├─ ProjectFactory  → valida/hidrata (frontera de confianza)
 │  render iso/planta, paneles      /api/    ├─ ProjectAnalyzer → orquesta:
 ├─ exportadores CSV / PDF          analyze  │    WallNormalizer → Topology → RegionAnalyzer
 └─ estado + historial (undo/redo)  ───────► │    CourseBuilder → TimberPlanner → BomCalculator
                                             │    ProjectValidator
                                             └─ Solar (posición, exposición, sugeridor)
```

Decisión de diseño: **el motor de cálculo es la única fuente de las reglas y vive en PHP** (`src/Domain`, sin dependencias de
framework, PHP 8.4: clases `readonly`, enums, `array_find`/`array_any`). El cliente solo dibuja y arma intenciones
("agregar un muro"); el servidor normaliza (divide en T/cruces, fusiona tramos, resuelve solapes), valida y calcula, y el
cliente reemplaza su estado con la respuesta. Para validar en vivo (p. ej. dónde cabe una puerta) el servidor devuelve
los tramos libres de cada muro (`slots`), de modo que la regla de jambas no se duplica en JavaScript.

- Geometría interna en **ticks enteros de 0,5 mm** (12,5 cm = 250 ticks): sin errores de coma flotante en trabas ni remanentes.
- Coordenadas del proyecto en **unidades de 12,5 cm** (enteros).
- Rendimiento: análisis ≈ 50 ms para una vivienda de 2 niveles. Presupuestos de entrada (API pública sin estado): 800 tramos de muro por nivel (se corta antes de materializar las intersecciones), 112,5 m de lado máximo, 1.500 vanos y 40 elementos de madera por nivel, ids que empiezan con letra.
  En el navegador el editor sostiene 60 FPS con render por software (capa estática en caché + descarte de cajas fuera de pantalla).

### API JSON

| Método y ruta | Descripción |
|---|---|
| `POST /api/analyze` | Proyecto → `{project (normalizado), analysis: {levels, timber, bom, issues, telemetry}}`. `422` si es inválido. |
| `POST /api/suggest` | Sugerencias bioclimáticas de aberturas. |
| `GET /api/solar?lat=&season=` | Trayectoria solar (06:00–19:00 cada 15 min). `season`: `winter`, `summer`, `equinox`. |
| `GET /api/templates`, `GET /api/templates/{slug}` | Plantillas. |
| `POST /api/thumbnail` | Miniatura SVG de un proyecto. |
| `GET /api/calc/panel?length=&height=&t=&openings=&waste=` | Calculadora rápida de paño. |

Formato del proyecto (`v1`): `{name, north, lat, lot:{w,d}, settings, levels:[{walls, openings, ubeams, timber}, …]}`; ver `ProjectFactory`.

### Seguridad

Frontera de validación estricta (tipos, rangos, ids, espesores, presets), límites de tamaño de cuerpo (1,5 MB), de muros por nivel y de
complejidad; Twig con autoescape, DOM del cliente sin `innerHTML` con datos del usuario; CSP restrictiva (sin CDN externos),
`X-Frame-Options`, `nosniff`. La API no tiene estado ni credenciales.

## Tests

`composer test` ejecuta PHPUnit: geometría (normalización, regiones, topología), motor de hiladas (traba, dinteles, corona,
cobertura total de cada corrida y ausencia de piezas superpuestas en **todas** las plantillas), empaquetado de cortes,
cómputo (áreas exactas, pallets, mortero, hormigón/hierro, cierre de la cotización), madera, validación, solar, sugeridor,
plantillas y la API HTTP.

## Diseño con IA

- **Galería**: «✦ Diseñá tu casa con IA → Empezar» abre un asistente por pasos (Tu casa · Propuesta · Ajustes). El
  primer paso es un formulario fijo (plantas, dormitorios, baños, cocina, extras, techo) y la primera casa sale al
  instante, sin esperar al modelo; después se ajusta con sugerencias o texto libre. Cada plantilla tiene «Usar» y
  «✦ Modificar con IA». Antes de empezar se avisa si se va a reemplazar el proyecto del editor.
- **Editor**: el botón flotante «✦ IA» abre un diálogo para pedir cambios sobre la casa abierta; el modelo actúa directo
  si el pedido es claro (pregunta sólo si es ambiguo) y cada cambio se aplica al editor como un paso que se puede
  deshacer. Con cada mensaje viaja el proyecto actual, así la IA ve también lo cambiado a mano.
- **Preguntas**: en formularios, una debajo de la otra; las de opción única se responden con un clic y, si hay alguna de
  opción múltiple, se confirma con «Enviar».
- **Modelo**: Kimi (Moonshot AI) por su API compatible con OpenAI, con llamadas a herramientas. El modelo no dibuja
  muros: conversa y llama a `preguntar`, `generar_casa`, `editar_casa` (incluye `agregar_ventana` por ambiente y
  orientación), `cargar_plantilla` y `ver_casa` (`src/Assistant/`). Toda casa pasa por el motor completo y sus
  observaciones vuelven al modelo; si la casa queda sin errores el turno termina ahí (una sola llamada por ajuste).
- **Generador** (`src/Domain/Design/HouseGenerator.php`): de un programa de ambientes a una casa válida y determinista
  (dormitorios al norte, servicios al sur, pasillo, losas y escalera en U en 2 plantas, techo con la sección de cabio
  que alcanza). Probado con programas al azar: o la casa sale sin errores ni advertencias, o se rechaza con un motivo.
- **Persistencia**: conversaciones y «Tus diseños» en Redis (`REDIS_URL`), 60 días; sin login, cada navegador tiene un id
  aleatorio y sólo ve lo suyo. Sin `REDIS_URL` se usan archivos en `var/assistant` (desarrollo).
- **Límites**: `ASSISTANT_HOURLY_LIMIT` por hora por IP, `ASSISTANT_DAILY_LIMIT` por día en total y 40 por conversación.

| Variable | Uso |
| --- | --- |
| `KIMI_API_KEY` | Clave de la API de Kimi. Sin clave el chat no aparece. |
| `KIMI_MODEL` | Modelo pesado: arma el JSON de la casa y las acciones directas. |
| `KIMI_MODEL_LIGHT` | Modelo liviano y más barato (misma clave y endpoint): arranca cada turno, pregunta y, cuando tiene las órdenes, delega al pesado. Vacío: todo lo hace `KIMI_MODEL`. |
| `KIMI_BASE_URL` | Por defecto `https://api.moonshot.ai/v1`. |
| `REDIS_URL`, `REDIS_PREFIX` | Redis y prefijo de claves (`blockk:`). |
| `ASSISTANT_DAILY_LIMIT`, `ASSISTANT_HOURLY_LIMIT` | Mensajes por día en total (500) y por hora por IP (60). |

## Skills para Claude Code

En `.claude/skills/` hay tres skills que Claude Code carga al trabajar en este repo (también se invocan con `/<nombre>`):

| Skill | Para qué |
| --- | --- |
| `verificar` | `scripts/verificar.sh`: PHPUnit, sintaxis PHP, ESLint y prueba de humo en Chromium (todas las plantillas + dibujo con el mouse). Correrla antes de cada push. |
| `capturas` | `scripts/capturas.cjs`: capturas del editor (niveles, techo, 4 vistas o primer plano) con Playwright, más ambientes, Revisión y totales en JSON. |
| `nueva-plantilla` | Cómo diseñar una casa para la Galería con `TemplateBuilder`: grilla, vanos y las reglas del validador. |

### Servidor MCP del laboratorio

`.mcp.json` declara el servidor `lab-mcp` (HTTP, `https://unab.dpdns.org/mcp`). El token se lee de la variable de entorno
**`LAB_MCP_TOKEN`**, que nunca se guarda en el repo: en tu máquina, exportala antes de abrir Claude Code; en Claude Code
en la web, cargala en la configuración del entorno y permití el dominio `unab.dpdns.org` en el acceso a la red.
Claude Code pide aprobar los servidores de `.mcp.json` la primera vez.

## Alcance

Implementado (Fase 1): editor ortogonal con vistas isométrica/cenital, piezas HCCA de 7,5/10/15/20 cm y U, entrepiso de madera,
límite de 2 pisos, simulador solar, cómputo con exportación y catálogo.

Fuera de alcance por decisión del proyecto: guardado en la nube y enlace público, integración con API de distribuidores,
flete por geolocalización, exportación IFC y toda la Fase 3 del PRD. El proyecto se guarda solo en el navegador (con exportar/abrir
`.json`). La cotización usa **precios de ejemplo editables** y el pedido a un distribuidor se canaliza por correo o WhatsApp.

Los controles del editor son de **predimensionado y coherencia geométrica**: capacidades por pallet, luces máximas de madera, consumos
y esbelteces son valores referenciales y **no reemplazan el cálculo estructural** (CIRSOC 501 / Eurocódigo 6) ni las fichas del
fabricante. El «Asistente bioclimático» es un motor de reglas determinístico (no usa IA generativa). La pieza «O» del catálogo es
informativa: no se despieza automáticamente.
