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

Lo que queda **fuera** aunque pidan: texturas y muebles de catálogo con marcas y colores (los **gabaritos** simples de tamaño real sí están en el backlog), render fotorrealista, curvas y diagonales, cálculo estructural
detallado, instalaciones completas, edición colaborativa en tiempo real.

Escala: **valor** 1–5 (cuánto mejora el uso) · **costo** S (días) / M (1–2 semanas) / L (más de dos semanas o con riesgo).

## Resumen priorizado

| # | Ítem | Valor | Costo | Por qué ahora |
| --- | --- | :---: | :---: | --- |
| 1 | Tipo de ambiente y revisión por tipo | 5 | M | Los nombres ya están; el tipo habilita avisos útiles y un cómputo por ambiente. |
| 2 | Calcar un plano (imagen de fondo a escala) | 5 | M | Convierte «tengo un plano en papel» en un proyecto en minutos. |
| 3 | Comparar alternativas de una casa | 4 | M | Responde «¿2 o 3 dormitorios?» con números lado a lado. |
| 4 | Muebles simples como gabarito | 4 | M | Con camas, mesas, mesadas y artefactos a escala se ve si una habitación alcanza y si la puerta abre. |
| 5 | Pedido por etapas y lista de compra | 4 | S–M | Nadie compra todo junto: cimientos, paredes, techo. |
| 6 | Precios por distribuidor (listas importables) | 4 | M | Pasa de «referencia» a «presupuesto que se puede llevar al corralón». |
| 7 | El asistente con todas las operaciones | 4 | M | La conversación pierde sentido si no puede hacer lo que hace el editor. |
| 8 | Cotas internas y fachadas en los planos | 4 | M | Sin cotas internas la planta no se le puede dar a un albañil. |
| 9 | Techo a cuatro aguas y cubiertas libres | 3 | M | Es la forma de techo más pedida que hoy no existe. |
| 10 | Vigas libres y estructura de pórticos | 3 | M | Completa los pilares: alfresco, galerías y portones anchos con respaldo. |
| 11 | Estimación térmica de la envolvente | 4 | M | La razón de elegir HCCA es la aislación; hoy no se ve. |
| 12 | Generador con más plantas (L, patio, en U) | 3 | M | El generador solo arma una «tira»; las casas en L se dibujan a mano. |

## Detalle

### 1. Tipo de ambiente y revisión por tipo (valor 5 · M)
- **Qué**: cada nombre de ambiente lleva un tipo (estar, dormitorio, baño, cocina, garaje…), que se elige al nombrar
  y que el generador y las plantillas ya conocen.
- **Qué habilita**: avisos de uso (dormitorio sin ventana, baño o cocina sin ventilación, superficie mínima, escalera
  que llega a un dormitorio), m² por tipo en el cómputo y el resumen, y ambientes «de servicio» que no cuentan como
  superficie habitable.
- **Complejidad**: baja en el modelo, media en las reglas; son reglas nuevas en el validador, no un editor nuevo.
- **Riesgo**: que las reglas parezcan normativa; se presentan como recomendaciones, igual que hoy.

### 2. Calcar un plano (valor 5 · M)
- **Qué**: cargar una imagen de plano como **fondo en la planta**, fijar la escala con una medida conocida y dibujar los
  muros encima con el imán de siempre. El fondo no entra al proyecto ni al cómputo.
- **Por qué**: casi toda casa real parte de un plano existente. Es el camino más corto entre un papel y un cómputo.
- **Variante futura**: un modelo con visión que proponga los muros desde la imagen (ver el punto 8).
- **Complejidad**: cámara, escala y opacidad en el renderer; sin cambios en el motor.

### 3. Comparar alternativas (valor 4 · M)
- **Qué**: guardar variantes de una casa («2 dormitorios», «3 dormitorios») y ver lado a lado superficie, bloques,
  pallets y costo, con la diferencia de cada una contra la base.
- **Por qué**: es el uso típico de evaluación y encaja con el asistente («probá con un dormitorio más»).
- **Complejidad**: varias versiones por proyecto y una vista de comparación; el motor ya calcula cualquier proyecto.

### 4. Muebles simples como gabarito (valor 4 · M)
- **Qué**: un **catálogo corto de piezas de tamaño real**, dibujadas como símbolos planos en la planta (y como cajas
  simples en la isométrica), que se colocan, se arrastran y se giran de a 90°:
  - **Camas**: una plaza (90 × 190 cm), una plaza y media (105 × 190), dos plazas (140 × 190) y king size (180 × 200).
  - **Mesa con sillas**: para 2, 4, 6 y 8 sillas; una sola pieza con un selector de cantidad (la mesa crece con las
    sillas: 80 × 80, 120 × 80, 180 × 90, 240 × 100 cm aproximadamente).
  - **Mesadas**: lineal, en L, en U e isla, de 60 cm de profundidad, con símbolos de bacha y de anafe.
  - **Elementos de baño**: inodoro, bidet, lavatorio, ducha (80 × 80 o 90 × 90), bañera (170 × 70) y pileta de lavadero.
  - Después, si hace falta: placard (60 cm de fondo), sillón, escritorio.
- **Por qué**: son **gabaritos, no decoración**. Responden preguntas de diseño que hoy se hacen a ojo: ¿entra una cama
  de dos plazas con mesas de luz?, ¿la puerta del baño abre sin pegar en el inodoro?, ¿queda 70 cm entre la mesa y la
  pared? Es la forma más barata de validar los lineamientos de circulación de [docs/DESIGN.md](docs/DESIGN.md).
- **Qué no hace**: no entra al cómputo, no tiene materiales ni marcas ni colores, no se renderiza fotorrealista. Es el
  mínimo detalle que mejora la decisión; encaja con el principio de perder detalle a propósito.
- **Encadena con**: el tipo de ambiente (1) puede proponer los muebles de cada uno, y las revisiones de uso (arcos de
  puerta que pisan un mueble, paso libre ≥ 70 cm) usan sus huellas. El asistente podría pedirlos («poné una cama de
  dos plazas en el dormitorio 2»).
- **Complejidad**: un elemento nuevo con rotación y huella, sus símbolos y la interacción de colocar y girar; las
  reglas de revisión vienen después.

### 5. Pedido por etapas y lista de compra (valor 4 · S–M)
- **Qué**: dividir el cómputo en etapas (cimientos y primera hilada, mampostería de Nivel 1, entrepiso, Nivel 2,
  techo) y una lista de compra por pallets completos con los sueltos aparte.
- **Por qué**: se compra a medida que se avanza; la etapa define cuándo hace falta cada cosa y reduce el material
  inmovilizado, que es el dolor que dio origen a la herramienta.
- **Complejidad**: agrupar lo que el cómputo ya sabe por nivel y rubro; el detalle de «cimientos» no existe hoy.

### 6. Precios por distribuidor (valor 4 · M)
- **Qué**: importar una lista de precios (CSV) o elegir un distribuidor cargado, con vigencia y unidad de venta.
- **Por qué**: hoy los precios son un ejemplo editable a mano; con precios reales el cómputo se vuelve presupuesto.
- **Complejidad**: formato de la lista, validación y a quién pertenece; sin integración en línea (sigue siendo un
  archivo), que es lo que mantiene la simpleza.

### 7. El asistente con todas las operaciones (valor 4 · M)
- **Qué**: que `editar_casa` conozca pilares, nombres de ambiente y las aberturas nuevas (tipo, ancho, alto,
  apertura), y que pueda **nombrar** y **cambiar el sentido de las puertas** sin romper el resto.
- **Después**: partir de una **foto o PDF de un plano** (modelo con visión) y devolver el esqueleto de muros para
  ajustarlo en el editor.
- **Complejidad**: más operaciones en `HouseEditor` y en el prompt; la validación sigue siendo la del motor.

### 8. Cotas internas y fachadas en los planos (valor 4 · M)
- **Qué**: los planos (`/planos`) ya salen en PDF con planta por nivel, planta de techos y un alzado por muro con el
  despiece; faltan las **cotas internas** (ambientes, vanos a ejes) y las cuatro **fachadas** en línea, a escala A4/A3.
- **Por qué**: es lo que se le muestra a quien construye. No pretende ser un plano municipal.
- **Complejidad**: el acotado automático sin que las cotas se pisen.

### 9. Techo a cuatro aguas y cubiertas libres (valor 3 · M)
- **Qué**: techo a cuatro aguas (con faldones y limatesas) y, más adelante, cubiertas planas con pendiente mínima.
- **Por qué**: casi toda casa de dos plantas real los usa; hoy solo hay dos aguas y un agua.
- **Complejidad**: geometría del `RoofPlanner` y de los hastiales; el cómputo de madera se calcula por faldón.

### 10. Vigas libres y estructura de pórticos (valor 3 · M)
- **Qué**: viga entre pilares o entre un pilar y un muro (hoy el encadenado U solo va sobre muros), con luz máxima y
  carga puntual sobre los pilares.
- **Por qué**: completa los pilares; permite alfresco, galerías y vanos de más de 3 m con respaldo.
- **Complejidad**: un elemento nuevo y sus reglas en la Revisión; el cómputo suma hormigón y hierro de la viga.

### 11. Estimación térmica de la envolvente (valor 4 · M)
- **Qué**: transmitancia de muros y techo según el espesor de bloque y un indicador simple (por ejemplo, pérdidas por
  m² de envolvente y por orientación) con una escala de colores.
- **Por qué**: el HCCA se elige por su aislación; es la comparación más natural contra otros sistemas y nadie la
  muestra junto al cómputo.
- **Riesgo**: que se lea como un cálculo certificado. Debe presentarse como referencia, igual que las luces de madera.
- **Complejidad**: valores por espesor en `Hcca` y un resumen; no cambia el despiece.

### 12. Generador con más plantas (valor 3 · M)
- **Qué**: casas en L, en U y con patio; hoy el generador solo arma una «tira» (bloque social, pasillo y dos bandas).
- **Por qué**: lo que se pide en el asistente y no sale hoy se termina dibujando a mano.
- **Complejidad**: esqueletos nuevos, siempre deterministas y probados con programas al azar, como el actual.

## Deuda técnica y de producto menor

Mejoras chicas que no justifican un ítem propio:

- Dibujar el giro de las **ventanas batientes** en la planta y agregar puerta plegadiza y paso sin hoja
  (ver [docs/DESIGN.md](docs/DESIGN.md) 9.3).
- **Escaleras**: descanso intermedio en las rectas, escalones compensados en el giro y baranda lateral.
- **Hueco de doble altura** en el piso de arriba, sin escalera.
- **Balcón y voladizo**: una losa sin muros debajo, con baranda.
- **Zonas con cómputo opcional**: una pileta de hormigón (m³, hierro, revoque) o un deck (m² y tirantes) hoy son solo
  dibujo; más adelante podrían sumar al presupuesto si la persona lo pide.
- **Árboles con más carácter**: especie (hoja caduca o perenne: la sombra de invierno cambia), altura y copa a medida,
  y que la sombra de la copa entre en la luz natural de las ventanas cercanas.
- **Zonas más libres**: formas en L o poligonales y desnivel (la pileta suele estar hundida).
- Mostrar en la Galería las **miniaturas** de los modelos creados por la API (hoy muestran la planta en SVG).
- Que el **PDF del cómputo** incluya nombres de ambientes y pilares en la planta.

## Preguntas abiertas

- **¿Cuentas opcionales?** El enlace compartible (2) cubre casi todo el uso sin login; tener cuentas solo se justifica
  si aparecen proyectos que se editan durante semanas o necesitan permisos.
- **¿El cómputo debe incluir cimientos y terminaciones?** Sería la ampliación de alcance más grande; hoy el foco son
  mampostería, estructura de madera, losas y cubierta.
- **¿Hasta dónde llega la «revisión»?** Mientras avise sin calcular, es una ayuda; si empieza a dar valores
  estructurales o térmicos con aspecto de certificación, necesita una advertencia legal y revisión profesional.
