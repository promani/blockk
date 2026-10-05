# HCCA — tecnología constructiva, catálogo y cálculo de materiales

## La tecnología

El **Hormigón Celular Curado en Autoclave (HCCA)** es un hormigón liviano con millones de poros cerrados, fabricado en
bloques de medidas precisas. Se coloca con **mortero adhesivo de junta delgada** (2–3 mm, llana dentada) en lugar de
mortero tradicional, se corta con sierra o serrucho de widia y funciona a la vez como estructura (muros portantes) y
aislación térmica. El manual técnico del fabricante está en [docs/](docs/).

Reglas que aplica el sistema (en `src/Domain/Hcca.php` y el motor):

| Regla | Valor | Dónde |
| --- | --- | --- |
| Bloque | Lika 50 × 25 cm (por defecto) o genérico 62,5 × 25 cm, según `BLOCK_SYSTEM`; retícula de 12,5 cm | `Hcca::SYSTEMS`, `blockL()`, `GRID` |
| Altura de nivel | 12 hiladas = 3,00 m (11 de bloque + 1 de bloque U de corona) | `COURSES`, `CourseBuilder` |
| Niveles | Máximo 2 con muros (≤ 6,00 m); el techo apoya sobre el último | `MAX_LEVELS` |
| Espesores | Lika: portantes 15 / 20 cm, tabiques 10 cm. Genérico: además 7,5 cm | `thicknesses()` |
| Traba | Juntas verticales de hiladas consecutivas separadas ≥ 12,5 cm; encuentros a 90° alternados hilada a hilada | `CourseBuilder`, `Topology` |
| Piezas mínimas | Ningún corte menor a 12,5 cm | `MIN_PIECE` |
| Vanos | Dintel en bloque U (hilada 9; en tabiques sin bloque U, dintel de hormigón in situ), apoyo ≥ 25 cm a cada lado; jambas ≥ 25 cm contra esquinas y muros transversales | `ProjectValidator` |
| Vanos en muro portante | Suma ≤ 60 % del tramo (advertencia) | `ProjectValidator` |
| Encuentros en T y cruz | Anclajes metálicos (planchuela) uno cada 2 hiladas | `ANCHORS_PER_TEE/CROSS` |
| Nivel 2 | Muros portantes sobre muros portantes del Nivel 1; tabiques sobre la losa del Nivel 2 | `ProjectValidator` |
| Losa | Maciza de 12 cm bajo cada habitación del Nivel 2 (automática, sin el hueco de la escalera); pisos extra (balcón, terraza) de 10–20 cm, voladizo ≤ 1,20 m sin pilares (advertencia); luz de referencia ≤ 4,00 m | `SlabPlanner` |
| Techo | Cabios sobre muros portantes con corona; sección según la luz (3″×8″, 3″×10″, 3″×12″) y largo comercial ≤ 6 m | `RoofPlanner` |

## Sistema de bloques

`BLOCK_SYSTEM` elige el sistema (por defecto `lika`). Todo lo que depende del bloque (largo, espesores, pallets,
adhesivo, bloques U y su canal) sale de `Hcca::SYSTEMS`; el editor lo recibe en `ClientConfig` (`blockL`, `blockUnits`,
`thicknesses`) y el catálogo lo muestra.

| | `lika` (por defecto) | `generico` |
| --- | --- | --- |
| Bloque | 50 × 25 cm (4 unidades de 12,5) | 62,5 × 25 cm (5 unidades) |
| Espesores | 10, 15, 20 cm | 7,5, 10, 15, 20 cm |
| Bloques U | 15U (canal 12 × 9) y 20U (canal 12 × 14) | todos los espesores |
| Pallets | 120 u (10), 72 u (15), 60 u (20); U: 42 (15), 40 (20) | 128 / 96 / 72 / 56 u |
| Adhesivo | 3,25 / 4,70 / 6,25 kg/m² | 1,5–2,5 kg/m² |

Con Lika, un vano en un tabique de 10 cm lleva un **dintel de hormigón armado in situ** (no hay bloque U de 10): el
cómputo lo cuenta como bloques equivalentes y hormigón.

## Catálogo de piezas (Lika)

| Código | Pieza | Medidas | Uso |
| --- | --- | --- | --- |
| B20 / B15 | Bloque portante | 50 × 25 × 20 (o 15) cm | Muros portantes de PB y PA. |
| B10 | Bloque para tabique | 50 × 25 × 10 cm | Divisorios interiores no portantes. |
| U15 / U20 | Bloque canal «U» | 50 × 25 × espesor | Dinteles, encadenados y viga corona; se rellena con hormigón y armadura. |
| O | Pieza con cavidad vertical | según fabricante | Pilaretes en nudos y extremos (informativa: no se despieza sola). |
| ½ · ¼ | Medio bloque y cortes | 25 · 12,5 cm y a medida | Trabas, jambas y remates. |
| M 3″×8″ | Tirante de pino tratado | 7,5 × 20 cm | Cabios del techo. |

Vanos predefinidos (`Hcca::openingPresets`): puertas P75, P87, P100, P150 (doble); ventanas V62, V100, V125, V150,
V187; ventiluces VT62, VT100 (antepecho alto); ventanal VG150 (hasta el piso). Todas miden múltiplos de 12,5 cm y el
dintel queda en la hilada 9.

La página `/catalogo` muestra las fichas (con fotos e imágenes del manual técnico de Lika, en `public/img/piezas/`), las
reglas críticas, el módulo, una calculadora rápida de paño y mortero y preguntas frecuentes de obra seca.

### Datos del fabricante: Lika ([manual técnico](docs/Lika-Manual-tecnico.pdf))

| Bloque | Medidas (cm) | Uso | u/pallet | Peso pallet | Bloques/m² | Adhesivo |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 50 × 25 × 10 | Tabiques interiores | 120 | 1.320 kg | 8 | 3,25 kg/m² |
| 15 | 50 × 25 × 15 | Muros exteriores o tabiques | 72 | 1.200 kg | 8 | 4,70 kg/m² |
| 20 | 50 × 25 × 20 | Muros exteriores o portantes | 60 | 1.320 kg | 8 | 6,25 kg/m² |
| 15U | 50 × 25 × 15 (canal 12 × 9) | Dinteles y encadenados | 42 | 700 kg | — | — |
| 20U | 50 × 25 × 20 (canal 12 × 14) | Dinteles y encadenados | 40 | 860 kg | — | — |

Otras recomendaciones del manual: juntas de hasta 8 mm con cuchara dentada; primera hilada sobre faja de nivelación
hidrófuga (1:3 + hidrófugo), empezando por las esquinas; muros de más de 6 m con refuerzos verticales; dinteles de bloque
U con apoyo ≥ ½ bloque y luz ≤ 2,5 m; no usar los bloques antes de 28 días de fabricados; pallets de 1,00 × 1,00 m
(1,60 m de alto los bloques, 0,85 m los U).

## Cálculo de materiales

1. **Normalización y topología**: los muros se parten en T y cruces y se fusionan tramos colineales; cada nodo sabe si
   es esquina, T o cruz.
2. **Hiladas** (`CourseBuilder`): cada muro se despieza hilada por hilada con la traba alternada en los encuentros,
   dejando los vanos y colocando bloques U en dinteles, encadenados y corona. Cada pieza es entera o un corte.
3. **Cortes** (`StockPacker` en línea + `CutPlanner`): los cortes se empaquetan sobre bloques enteros; el sobrante de un
   corte se reutiliza como jamba o inicio de la hilada siguiente. Resultado: bloques a comprar y **% de descarte**
   (las plantillas quedan < 4 %, típicamente 0,5–1 %).
4. **Cómputo** (`BomCalculator`):

| Rubro | Cómo se calcula |
| --- | --- |
| Bloques y bloques U | Por espesor, con reserva por rotura configurable (3 %); **pallets** completos por espesor, con las capacidades del sistema. |
| Mortero adhesivo | Consumo por m² de paño según espesor y sistema; bolsas de 25 kg. |
| Mortero de nivelación | Primera hilada, 2 cm de espesor, 1.900 kg/m³. |
| Hormigón | Relleno del canal de los bloques U (canal del sistema) y dinteles in situ. |
| Hierro | Ø8 mm en dinteles y vigas U (0,395 kg/m); Ø10 mm en la corona (0,617 kg/m). |
| Anclajes | Uno cada 2 hiladas en cada T (6) y cruz (12). |
| Losas y escaleras | Hormigón, malla (+10 %), encofrado; peldaños (contrahuella 15–19 cm, Blondel 60–66 cm) y descansos. |
| Techo | Cabios por largo, cumbrera, clavaderas, cubierta en m² y bloques de los hastiales hilada por hilada. |

5. **Presupuesto**: precios de ejemplo **editables** en el Cómputo (`Hcca::defaultPrices`), moneda configurable,
   exportación CSV/PDF y envío a un distribuidor por correo o WhatsApp.

Los valores de pallets, consumos y luces son **referenciales** y varían por fabricante: verificar con la ficha del
distribuidor. El sistema predimensiona; no reemplaza el cálculo estructural (CIRSOC 501 / Eurocódigo 6).
