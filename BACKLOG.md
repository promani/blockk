# Backlog — lo que sumaría valor de verdad

Cosas que la aplicación **debería tener a futuro**: agregan algo de complejidad, pero aportan valor sustantivo a quien
la usa para lo que fue pensada (calcular materiales de una casa de bloques con poco esfuerzo). Lo que ya existe y lo que
queda fuera a propósito está en [FEATURES.md](FEATURES.md); las brechas de diseño detectadas con un plano real, en
[docs/DESIGN.md](docs/DESIGN.md) (sección 9).

## Cómo se decide qué entra

Un ítem entra al backlog si cumple **las tres**:

1. **Mejora el resultado central** (el cómputo, la confianza en él o la facilidad de llegar a él), no solo la apariencia.
2. **Se puede explicar sin un manual**: no obliga a elegir entre muchas opciones ni agrega modos.
3. **Pierde detalle a propósito**: si pide más detalle del que cambia el cómputo o la coherencia constructiva, se
   descarta o se achica.

Lo que queda **fuera** aunque pidan: texturas y muebles de catálogo con marcas y colores (los **gabaritos** simples de tamaño real ya existen), render fotorrealista, curvas y diagonales, cálculo estructural
detallado, instalaciones completas, edición colaborativa en tiempo real.

Escala: **valor** 1–5 (cuánto mejora el uso) · **costo** S (días) / M (1–2 semanas) / L (más de dos semanas o con riesgo).

## Resumen priorizado

| # | Ítem | Valor | Costo | Por qué ahora |
| --- | --- | :---: | :---: | --- |
| 1 | Muebles: lo que falta (revisión de paso, asistente) | 3 | S–M | Los gabaritos ya se colocan; falta que la Revisión avise cuando no hay paso o una puerta los pisa. |
| 2 | Pedido por etapas y lista de compra | 4 | S–M | Nadie compra todo junto: cimientos, paredes, techo. |
| 3 | Precios por distribuidor (listas importables) | 4 | M | Pasa de «referencia» a «presupuesto que se puede llevar al corralón». |
| 4 | El asistente con todas las operaciones | 4 | M | La conversación pierde sentido si no puede hacer lo que hace el editor. |
| 5 | Cotas internas y fachadas en los planos | 4 | M | Sin cotas internas la planta no se le puede dar a un albañil. |
| 6 | Techo a cuatro aguas y cubiertas libres | 3 | M | Es la forma de techo más pedida que hoy no existe. |
| 7 | Vigas libres y estructura de pórticos | 3 | M | Completa los pilares: alfresco, galerías y portones anchos con respaldo. |
| 8 | Estimación térmica de la envolvente | 4 | M | La razón de elegir HCCA es la aislación; hoy no se ve. |
| 9 | Generador con más plantas (L, patio, en U) | 3 | M | El generador solo arma una «tira»; las casas en L se dibujan a mano. |
| 10 | Cálculo de mano de obra (sección propia, más abajo) | 5 | M | El presupuesto de hoy es sólo de materiales: falta la otra mitad del costo. |
| 11 | Entrepisos y losas (sección propia, más abajo) | 4 | M–L | Hoy hay una losa maciza y un entrepiso de madera; la losa más usada (viguetas) no existe. |

## Detalle

### 1. Muebles: lo que falta (valor 3 · S–M)
- **Hecho**: herramienta «Mueble» con un catálogo corto de **gabaritos de tamaño real** (camas, mesa de luz, placard,
  mesas con sillas, sillones, mesadas, isla, heladera, cocina, lavarropas, artefactos de baño, escritorio), dibujados
  como rectángulos con su nombre en la planta y cajas bajas en la isométrica. Se colocan, se giran de a 90°, se
  arrastran, se copian y se apagan con un interruptor (igual que los árboles). No entran al cómputo ni a la Revisión.
- **Qué falta**: revisiones de uso con sus huellas (arco de una puerta que pisa un mueble, paso libre menor a 70 cm,
  mueble que tapa una ventana), que el tipo de ambiente proponga los muebles habituales, y que el asistente los
  pueda pedir («poné una cama de dos plazas en el dormitorio 2»).
- **Qué no hace**: sin materiales, marcas ni colores, y sin render. Es el mínimo detalle que mejora la decisión.

### 2. Pedido por etapas y lista de compra (valor 4 · S–M)
- **Qué**: dividir el cómputo en etapas (cimientos y primera hilada, mampostería de Nivel 1, entrepiso, Nivel 2,
  techo) y una lista de compra por pallets completos con los sueltos aparte.
- **Por qué**: se compra a medida que se avanza; la etapa define cuándo hace falta cada cosa y reduce el material
  inmovilizado, que es el dolor que dio origen a la herramienta.
- **Complejidad**: agrupar lo que el cómputo ya sabe por nivel y rubro; el detalle de «cimientos» no existe hoy.

### 3. Precios por distribuidor (valor 4 · M)
- **Qué**: importar una lista de precios (CSV) o elegir un distribuidor cargado, con vigencia y unidad de venta.
- **Por qué**: hoy los precios son un ejemplo editable a mano; con precios reales el cómputo se vuelve presupuesto.
- **Complejidad**: formato de la lista, validación y a quién pertenece; sin integración en línea (sigue siendo un
  archivo), que es lo que mantiene la simpleza.

### 4. El asistente con todas las operaciones (valor 4 · M)
- **Qué**: que `editar_casa` conozca pilares, nombres de ambiente y las aberturas nuevas (tipo, ancho, alto,
  apertura), y que pueda **nombrar** y **cambiar el sentido de las puertas** sin romper el resto.
- **Complejidad**: más operaciones en `HouseEditor` y en el prompt; la validación sigue siendo la del motor.

### 5. Cotas internas y fachadas en los planos (valor 4 · M)
- **Qué**: los planos (`/planos`) ya salen en PDF con planta por nivel, planta de techos y un alzado por muro con el
  despiece; faltan las **cotas internas** (ambientes, vanos a ejes) y las cuatro **fachadas** en línea, a escala A4/A3.
- **Por qué**: es lo que se le muestra a quien construye. No pretende ser un plano municipal.
- **Complejidad**: el acotado automático sin que las cotas se pisen.

### 6. Techo a cuatro aguas y cubiertas libres (valor 3 · M)
- **Qué**: techo a cuatro aguas (con faldones y limatesas) y, más adelante, cubiertas planas con pendiente mínima.
- **Por qué**: casi toda casa de dos plantas real los usa; hoy solo hay dos aguas y un agua.
- **Complejidad**: geometría del `RoofPlanner` y de los hastiales; el cómputo de madera se calcula por faldón.

### 7. Vigas libres y estructura de pórticos (valor 3 · M)
- **Qué**: viga entre pilares o entre un pilar y un muro (hoy el encadenado U solo va sobre muros), con luz máxima y
  carga puntual sobre los pilares.
- **Por qué**: completa los pilares; permite alfresco, galerías y vanos de más de 3 m con respaldo.
- **Complejidad**: un elemento nuevo y sus reglas en la Revisión; el cómputo suma hormigón y hierro de la viga.

### 8. Estimación térmica de la envolvente (valor 4 · M)
- **Qué**: transmitancia de muros y techo según el espesor de bloque y un indicador simple (por ejemplo, pérdidas por
  m² de envolvente y por orientación) con una escala de colores.
- **Por qué**: el HCCA se elige por su aislación; es la comparación más natural contra otros sistemas y nadie la
  muestra junto al cómputo.
- **Riesgo**: que se lea como un cálculo certificado. Debe presentarse como referencia, igual que las luces de madera.
- **Complejidad**: valores por espesor en `Hcca` y un resumen; no cambia el despiece.

### 9. Generador con más plantas (valor 3 · M)
- **Qué**: casas en L, en U y con patio; hoy el generador solo arma una «tira» (bloque social, pasillo y dos bandas).
- **Por qué**: lo que se pide en el asistente y no sale hoy se termina dibujando a mano.
- **Complejidad**: esqueletos nuevos, siempre deterministas y probados con programas al azar, como el actual.

## Cálculo de mano de obra

Hoy el presupuesto es **sólo de materiales**. En una obra chica la mano de obra pesa tanto como los materiales, y es
la pregunta que sigue a «¿cuánto compro?»: «¿cuánto me sale levantarla y cuánto tarda?».

- **Qué**: jornales y costo de mano de obra por rubro, calculados con lo que el cómputo ya sabe:
  - **Mampostería**: m² de muro por espesor, con un rendimiento por cuadrilla (oficial + ayudante) distinto para la
    primera hilada (nivelación con mortero), las hiladas corrientes y los cortes.
  - **Dinteles, encadenados y pilares**: metros de bloque U y de pilar: armado, llenado y curado.
  - **Losas y entrepisos**: m² de encofrado, armado y colado, o m² de tirantes y tablero (ver la sección siguiente).
  - **Escaleras y techo**: por unidad y por m² de cubierta (estructura, clavaderas, cubierta).
- **Cómo se carga**: una tabla de **rendimientos de referencia** (m² o metros por jornal) y un **valor del jornal**
  por categoría, editables igual que los precios de materiales. Cada distribuidor o constructor pone los suyos.
- **Qué muestra**: jornales por rubro y por nivel, **días de obra** para una cuadrilla elegida (1 oficial + 1
  ayudante, 2 + 1…), costo de mano de obra y el total materiales + mano de obra en el Cómputo, el CSV y el PDF.
- **Por qué**: completa el presupuesto, permite comparar alternativas por costo total y es el argumento del sistema
  (el HCCA se levanta más rápido que el ladrillo: hoy ese ahorro no se ve en ningún número).
- **Encadena con**: el pedido por etapas (2), que pasa a tener también su plazo; y la comparación entre dos casas
  guardadas, que podría sumar el costo y el plazo de mano de obra.
- **Qué no hace**: no liquida sueldos ni cargas sociales, no arma un plan de obra con dependencias y no incluye
  rubros que el cómputo no tiene (cimientos, revoques, instalaciones) hasta que existan.
- **Riesgo**: los rendimientos varían mucho con la cuadrilla, la zona y el clima. Se presentan como referencia
  editable, con el mismo aviso que los precios; hacen falta valores de partida de alguien que construya con el sistema.
- **Complejidad** (M): una tabla de rendimientos en `Hcca`, un cálculo nuevo en `BomCalculator` con las cantidades
  que ya existen y su bloque en Cómputo, CSV y PDF. Sin cambios en el editor.

## Entrepisos y losas

Hoy el piso del Nivel 2 es una **losa maciza de hormigón** (espesor, hormigón, malla y encofrado por m²) o un
**entrepiso de madera** (tirantes, cenefa y OSB), rectangulares, con avisos de luz y de apoyo. Lo que falta:

- **Losa de viguetas pretensadas y bloques** (cerámicos o de EPS): es la losa más usada en vivienda y hoy no existe.
  Pide el sentido de las viguetas, su separación, la serie según la luz, la capa de compresión con su malla y los
  puntales. Cómputo: viguetas por largo comercial, bloques, hormigón, malla y puntales.
- **Losa de paneles de hormigón celular** (placas armadas del mismo sistema), donde el fabricante las ofrezca: largos,
  apoyos mínimos y juntas. Hace falta la ficha técnica del fabricante.
- **Hierro real de la losa maciza**: hoy se computa una malla por m². Falta armadura por dirección según la luz y el
  espesor, refuerzos en apoyos y bordes de huecos, y puntales y encofrado por día de uso.
- **Sentido de armado y apoyos**: marcar hacia dónde descarga cada paño y revisar que haya muro portante o viga en esos
  bordes (hoy sólo se revisa que la losa quede dentro de la planta de abajo y su luz menor).
- **Formas y huecos**: losas en L o recortadas, **hueco de doble altura** sin escalera, **balcones y voladizos** (una
  losa sin muros debajo, con baranda) y su contrapeso.
- **Cubierta plana**: una losa como techo (azotea) con pendiente mínima, aislación, membrana y parapetos; hoy el techo
  es sólo de madera a una o dos aguas.
- **Capas del piso**: contrapiso y carpeta sobre la losa, aislación acústica y cielorraso bajo el entrepiso de madera.
- **Entrepiso de madera**: vigas principales cuando la luz no la cubre un tirante, arriostres, y elección de la
  sección por carga de uso (dormitorio, depósito) además de la luz.
- **Cargas a los muros**: lo que cada losa descarga sobre los muros y pilares de abajo, para avisar cuando un tabique
  o un dintel recibe más de lo razonable. Se apoya en las vigas libres (7).
- **Mano de obra**: encofrado, armado, colado y desencofrado por m² (ver la sección anterior).
- **Riesgo**: es el rubro más cercano al cálculo estructural. Se predimensiona con tablas de referencia y se avisa;
  no reemplaza el cálculo de un profesional.
- **Orden sugerido**: viguetas (lo más pedido), sentido de armado y apoyos, hueco de doble altura y balcón, cubierta
  plana, y después el resto.

## Deuda técnica y de producto menor

Mejoras chicas que no justifican un ítem propio:

- **Calcado**: girar el plano de fondo y escribir su escala a mano; elegir la página de un PDF (hoy se usa la
  primera); que la escalera del plano se acomode sola dentro del ambiente cuando sus medidas no cierran.
- **Tipo de ambiente**: que el asistente lo pueda cambiar con `editar_casa`.
- **Comparación**: exportarla (PDF o CSV).
- Dibujar el giro de las **ventanas batientes** en la planta y agregar puerta plegadiza y paso sin hoja
  (ver [docs/DESIGN.md](docs/DESIGN.md) 9.3).
- **Escaleras**: descanso intermedio en las rectas, escalones compensados en el giro y baranda lateral.
- **Zonas con cómputo opcional**: una pileta de hormigón (m³, hierro, revoque) o un deck (m² y tirantes) hoy son solo
  dibujo; más adelante podrían sumar al presupuesto si la persona lo pide.
- **Árboles con más carácter**: especie (hoja caduca o perenne: la sombra de invierno cambia), altura y copa a medida,
  y que la sombra de la copa entre en la luz natural de las ventanas cercanas.
- **Zonas más libres**: formas en L o poligonales y desnivel (la pileta suele estar hundida).
- Mostrar en la Galería las **miniaturas** de los modelos creados por la API (hoy muestran la planta en SVG).
- Que el **PDF del cómputo** incluya nombres de ambientes y pilares en la planta.

## Preguntas abiertas

- **¿Cuentas opcionales?** El enlace para compartir y «Mis casas» (por navegador) cubren casi todo el uso sin login; tener cuentas solo se justifica
  si aparecen proyectos que se editan durante semanas o necesitan permisos.
- **¿El cómputo debe incluir cimientos y terminaciones?** Sería la ampliación de alcance más grande; hoy el foco son
  mampostería, estructura de madera, losas y cubierta.
- **¿Hasta dónde llega la «revisión»?** Mientras avise sin calcular, es una ayuda; si empieza a dar valores
  estructurales o térmicos con aspecto de certificación, necesita una advertencia legal y revisión profesional.
