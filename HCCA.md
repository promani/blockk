# HCCA — tecnología constructiva, catálogo y cálculo de materiales

## La tecnología

El **Hormigón Celular Curado en Autoclave (HCCA)** es un hormigón liviano con millones de poros cerrados, fabricado en
bloques de medidas precisas. Se coloca con **mortero adhesivo de junta delgada** (2–3 mm, llana dentada) en lugar de
mortero tradicional, se corta con sierra o serrucho de widia y funciona a la vez como estructura (muros portantes) y
aislación térmica. El manual técnico del fabricante está en [docs/](docs/).

Reglas que aplica el sistema (en `src/Domain/Hcca.php` y el motor):

| Regla | Valor | Dónde |
| --- | --- | --- |
| Módulo del bloque | 62,5 × 25 cm; retícula de 12,5 cm | `Hcca::BLOCK_L`, `GRID` |
| Altura de nivel | 12 hiladas = 3,00 m (11 de bloque + 1 de bloque U de corona) | `COURSES`, `CourseBuilder` |
| Niveles | Máximo 2 con muros (≤ 6,00 m); el techo apoya sobre el último | `MAX_LEVELS` |
| Espesores | Portantes 15 / 20 cm; tabiques 10 / 7,5 cm | `THICKNESSES_CM` |
| Traba | Juntas verticales de hiladas consecutivas separadas ≥ 12,5 cm; encuentros a 90° alternados hilada a hilada | `CourseBuilder`, `Topology` |
| Piezas mínimas | Ningún corte menor a 12,5 cm | `MIN_PIECE` |
| Vanos | Dintel en bloque U (hilada 9), apoyo ≥ 25 cm a cada lado; jambas ≥ 25 cm contra esquinas y muros transversales | `ProjectValidator` |
| Vanos en muro portante | Suma ≤ 60 % del tramo (advertencia) | `ProjectValidator` |
| Encuentros en T y cruz | Anclajes metálicos (planchuela) uno cada 2 hiladas | `ANCHORS_PER_TEE/CROSS` |
| Nivel 2 | Muros portantes sobre muros portantes del Nivel 1; tabiques sobre losa o entrepiso | `ProjectValidator` |
| Entrepiso de madera | Tirantes 3″×8″ (luz ≤ 3,75 m) o 3″×10″ (≤ 4,75 m) a 40 cm, apoyo ≥ 10 cm sobre la corona con banda elástica | `TimberPlanner` |
| Losa | Maciza, luz de referencia ≤ 4,00 m; sobre la superficie cerrada de abajo | `SlabPlanner` |
| Techo | Cabios sobre muros portantes con corona; sección según la luz (3″×8″, 3″×10″, 3″×12″) y largo comercial ≤ 6 m | `RoofPlanner` |

## Catálogo de piezas

| Código | Pieza | Medidas | Uso |
| --- | --- | --- | --- |
| B20 / B15 | Bloque portante | 62,5 × 25 × 20 (o 15) cm | Muros portantes de PB y PA. |
| B10 / B7,5 | Bloque para tabique | 62,5 × 25 × 10 (o 7,5) cm | Divisorios interiores no portantes. |
| U20 / U15 / U10 | Bloque canal «U» | 62,5 × 25 × espesor | Dinteles, encadenados y viga corona; se rellena con hormigón y armadura. |
| O | Pieza con cavidad vertical | según fabricante | Pilaretes en nudos y extremos (informativa: no se despieza sola). |
| ½ · ¼ | Medio bloque y cortes | 31,25 · 25 · 12,5 cm y a medida | Trabas, jambas y remates. |
| M 3″×8″ | Tirante de pino tratado | 7,5 × 20 cm | Entrepiso en seco y cabios. |

Vanos predefinidos (`Hcca::openingPresets`): puertas P75, P87, P100, P150 (doble); ventanas V62, V100, V125, V150,
V187; ventiluces VT62, VT100 (antepecho alto); ventanal VG150 (hasta el piso). Todas miden múltiplos de 12,5 cm y el
dintel queda en la hilada 9.

La página `/catalogo` muestra las fichas, las reglas críticas, el módulo, una calculadora rápida de paño y mortero y
preguntas frecuentes de obra seca.

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
| Bloques y bloques U | Por espesor, con reserva por rotura configurable (3 %); **pallets** completos por espesor (referencia: 128 u de 7,5 cm, 96 u de 10 cm, 72 u de 15 cm, 56 u de 20 cm). |
| Mortero adhesivo | 1,5–2,5 kg/m² de paño según espesor; bolsas de 25 kg. |
| Mortero de nivelación | Primera hilada, 2 cm de espesor, 1.900 kg/m³. |
| Hormigón | Relleno del canal de los bloques U (ancho interior según espesor × 20 cm de alto). |
| Hierro | Ø8 mm en dinteles y vigas U (0,395 kg/m); Ø10 mm en la corona (0,617 kg/m). |
| Anclajes | Uno cada 2 hiladas en cada T (6) y cruz (12). |
| Madera | Tirantes por largo comercial (3,00–6,00 m), cenefa, OSB 18 mm, banda elástica y placas de reparto. |
| Losas y escaleras | Hormigón, malla (+10 %), encofrado; peldaños (contrahuella 15–19 cm, Blondel 60–66 cm) y descansos. |
| Techo | Cabios por largo, cumbrera, clavaderas, cubierta en m² y bloques de los hastiales hilada por hilada. |

5. **Presupuesto**: precios de ejemplo **editables** en el Cómputo (`Hcca::defaultPrices`), moneda configurable,
   exportación CSV/PDF y envío a un distribuidor por correo o WhatsApp.

Los valores de pallets, consumos y luces son **referenciales** y varían por fabricante: verificar con la ficha del
distribuidor. El sistema predimensiona; no reemplaza el cálculo estructural (CIRSOC 501 / Eurocódigo 6).
