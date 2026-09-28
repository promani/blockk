# Blockk Studio

Plataforma web de **modelado modular y cómputo constructivo en Hormigón Celular Curado en Autoclave (HCCA)**.
Se dibuja una vivienda con muros ortogonales a 90° (estilo bloques modulares), se ve en isométrica o en planta,
y el sistema genera el **despiece real pieza por pieza**, la **optimización de cortes**, el **cómputo de materiales**
(bloques, pallets, morteros, hormigón, armadura, madera) y una cotización referencial exportable.

> **Stack:** PHP 8.4 · Symfony 7.4 (LTS) · Twig · AssetMapper (ES modules, sin Node ni paso de build) · Canvas 2D · PHPUnit 12.

Alcance implementado: **Fase 1 (MVP)** del PRD. Ver [Alcance](#alcance-y-lo-que-queda-para-fases-2-y-3).

## Ejecutar

Requisitos: PHP ≥ 8.4 (extensiones habituales de Symfony: `ctype`, `iconv`, `intl`, `mbstring`, `xml`) y Composer.

```bash
composer install
composer start            # php -S 127.0.0.1:8000 -t public   →   http://127.0.0.1:8000
composer test             # PHPUnit (118 tests)
```

En producción: `APP_ENV=prod composer install --no-dev -o && php bin/console asset-map:compile && php bin/console cache:warmup`
y servir `public/` con PHP-FPM/Nginx/Apache o FrankenPHP. No hay base de datos: el proyecto vive en el navegador
(`localStorage`, con exportar/abrir `.json`) y el servidor es una API de cálculo sin estado.

## Pantallas

| Ruta | Pantalla |
|---|---|
| `/` | **Editor 3D e isométrico**: herramientas Sala (R), Muro (W), Bloque (B), Puerta (P), Ventana (N), Viga U (U), Entrepiso (E), Viga de madera (T); vistas Isométrica / Planta (`Tab`), giro `[` `]`, niveles PB/PA, asoleamiento, telemetría en vivo, validación. |
| `/computo` | **Cómputo y despiece**: KPIs, desglose por nivel, patrones de corte, madera, cotización con precios editables, envío a distribuidor (correo/WhatsApp), exportación **CSV** y **PDF vectorial** (generados en el navegador). |
| `/galeria` | **Plantillas modulares** (1 planta, 2 plantas, evolutiva, quincho, dúplex, luz libre) con miniaturas SVG y métricas calculadas por el motor; proyecto en blanco con retícula parametrizable. |
| `/catalogo` | **Catálogo técnico**: fichas de piezas, reglas de modulación, calculadora rápida de paño y mortero, FAQ de obra seca. |

Atajos: `V R W B P N U E T` herramientas · `Ctrl+Z / Ctrl+Y` deshacer/rehacer · `Supr` eliminar · `1`/`2` nivel ·
rueda = zoom · clic central o `Espacio`+arrastre = paneo · `F` encuadrar · `X` gira el bloque.

## Reglas constructivas que aplica el motor

| Regla (PRD) | Dónde |
|---|---|
| Solo muros ortogonales (90°) | `Wall`, `ProjectFactory` |
| **Máximo 2 niveles** autoportantes (PB + PA ≤ 6,00 m); el 3.er nivel está inhabilitado con advertencia | `Hcca::MAX_LEVELS`, `ProjectFactory`, UI |
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

## Alcance y lo que queda para Fases 2 y 3

Implementado (Fase 1): editor ortogonal con vistas isométrica/cenital, piezas HCCA de 7,5/10/15/20 cm y U, entrepiso de madera,
límite de 2 pisos, simulador solar, cómputo con exportación y catálogo.

No implementado (según el roadmap del PRD): planos de replanteo con cotas acumuladas, guardado en la nube y enlace público
(Fase 2); integración con API de distribuidores, flete por geolocalización y exportación IFC (Fase 3). La cotización usa
**precios de ejemplo editables**; el envío a distribuidores es por correo/WhatsApp.

Los controles del editor son de **predimensionado y coherencia geométrica**: capacidades por pallet, luces máximas de madera, consumos
y esbelteces son valores referenciales y **no reemplazan el cálculo estructural** (CIRSOC 501 / Eurocódigo 6) ni las fichas del
fabricante. El «Asistente bioclimático» es un motor de reglas determinístico (no usa IA generativa). La pieza «O» del catálogo es
informativa: no se despieza automáticamente.
