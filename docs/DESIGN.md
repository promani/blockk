# Diseño de casas — lineamientos

Criterios para diseñar casas en Blockk Studio, sirvan o no para una plantilla de la Galería: los usan quien dibuja a
mano, el generador (`src/Domain/Design/`), el asistente de IA y la skill `nueva-plantilla`. Lo que **controla el
motor** (jambas, luces, apoyos) está en [HCCA.md](../HCCA.md) y [EDITOR.md](../EDITOR.md); acá va lo que **no controla
nadie** y es de buen diseño: cómo se circula, hacia dónde abre cada puerta, qué ambiente va junto a cuál.

Al final hay un caso de estudio (un plano real que se recreó) y las **brechas del diseñador** que salieron de hacerlo.

## 1. Programa y zonas

- **Tres zonas**: social (estar, comedor, cocina), íntima (dormitorios y baños) y de servicio (garaje, lavadero,
  despensa, depósito). Cada zona se agrupa; la social toca la entrada y la íntima queda lejos de ella.
- **Gradiente de privacidad**: entrada → social → distribución → dormitorios. Una visita no debería ver un dormitorio
  desde la puerta de calle.
- **Superficies de referencia** (útiles, entre caras): dormitorio principal 12–16 m², secundario 9–12 m² (lado
  mínimo 2,6 m), baño completo ≥ 3,5 m² (≥ 1,5 × 2,3 m), lavabo social 1,2 × 1,5 m, cocina 7–12 m² (o integrada), estar
  y comedor 20–30 m² juntos, lavadero ≥ 2 m², garaje 3,0 × 5,5 m útiles como mínimo (3,5 × 6 con holgura para abrir
  puertas del auto).
- **Placards**: profundidad útil 0,60 m; se cuentan aparte, no restan al dormitorio. Un vestidor con paso necesita ≥ 1,2 m
  de ancho libre.

## 2. Orientación (hemisferio sur, `north = 0` arriba)

- **Estar, comedor y dormitorios al norte**: el sol de invierno entra, el de verano se corta con alero (0,5 m).
- **Baños, lavadero, despensa, escalera y garaje al sur u oeste**: funcionan de amortiguador térmico; sus ventanas
  son pequeñas (ventiluz).
- **Ventanas grandes al norte; al oeste, mínimas** (sol bajo de verano). Ventilación cruzada: cada ambiente habitable
  con aberturas en dos paredes, o en una pared y una puerta que dé a un ambiente ventilado.
- **Luz natural**: vidrio ≥ 1/8 de la superficie del ambiente (lo mide la Revisión). Cocina y baños pueden ir con
  ventiluz (`VT62`, `VT100`); dormitorios y estar, no.

## 2 bis. El terreno: pileta, patio y árboles

Las **zonas** y los **árboles** del editor no suman material, pero deciden cómo se vive la casa:

- **Pileta y deck** al norte o al oeste del estar, donde pega el sol; lejos de la medianera si el reglamento pide retiro, y
  cerca de la salida del estar o del alfresco, no de los dormitorios. Un deck de 1 m alrededor evita pisar el pasto mojado.
- **Árboles de hoja caduca al norte y al oeste**: dan sombra en verano y dejan pasar el sol de invierno (hemisferio sur).
  Los perennes, en el lado sur como pantalla del viento. Ninguno a menos de un radio de copa de la pared ni sobre la pileta.
- **Un camino** (o el acceso del garaje) que llegue sin cruzar el jardín ni el deck; el camino al hall de entrada, directo.
- La **sombra** de los árboles se ve en la isométrica con el sol activado: sirve para comprobar que no tapan las
  ventanas del estar en invierno.

## 3. Circulación

- **Un recorrido claro**: entrada → distribución → cada ambiente, sin atravesar otro para llegar. Excepciones aceptables:
  cocina abierta al estar, vestidor o baño en suite dentro del dormitorio principal.
- **Anchos libres**: pasillo ≥ 0,90 m (mejor 1,00–1,10 m; el generador usa 1,125 m entre ejes, `HALL = 9 u`), paso
  entre muebles ≥ 0,70 m, hall de entrada ≥ 1,20 m.
- **Pasillos cortos**: un pasillo que supera el 15 % de la planta es superficie perdida. Mejor una **distribución** (un
  estar o hall central) de la que cuelgan las puertas.
- **Sin pasillos ciegos**: un pasillo que termina en una pared sin puerta ni ventana se evita o se aprovecha como
  placard o nicho.
- **Entrada**: a cubierto (porche o alero), abre a un hall, no directo a la cocina ni a un dormitorio. El garaje se conecta
  a la casa por una puerta al hall (no por la cocina ni por un dormitorio).
- **Baño social** (lavabo) accesible desde la zona social sin entrar a la íntima; baño de dormitorios accesible desde el
  pasillo íntimo, no desde el estar.
- **Cocina**: triángulo heladera–bacha–cocina con lados de 1,2 a 2,7 m; el recorrido a la despensa, al lavadero y al
  comedor, corto. La puerta de la cocina no pega contra la heladera.
- **Dos plantas**: la escalera nace en el hall o el estar (se ve al entrar, pero no frente a la puerta de calle), llega
  arriba a un **hall de distribución** y no directamente a un dormitorio. Ancho útil ≥ 0,90 m (en el editor, `w = 8 u` =
  1,00 m), descanso donde gira, contrahuella ≈ 17–18 cm (el editor apunta a 18), huella 28 cm. El espacio debajo se aprovecha (lavabo, depósito).
- **Orden vertical**: dormitorios arriba y baños uno sobre otro, para que las cañerías bajen juntas y los tabiques
  de arriba apoyen sobre muros de abajo (el motor lo revisa: `support.*`).

## 4. Puertas: tamaño y sentido

Una abertura se define con **tipo** (puerta, ventana, portón), **ancho**, **alto** y **apertura**; la posición no se
escribe, se arrastra por el muro. Si la apertura es batiente, se elige el **giro** (en qué extremo va la bisagra y hacia
qué lado abre); si es corrediza, hacia dónde corre la hoja. Anchos habituales: puerta 75 / 87,5 / 100 / 150 cm, ventana
62,5 a 187,5 cm, portón 250 o 300 cm.

| Regla | Detalle |
| --- | --- |
| **Abre hacia adentro del ambiente que sirve** | Dormitorios, baños, placards, vestidores, despensa y depósito: la hoja gira hacia adentro. El pasillo queda libre y la hoja no estorba a quien pasa. |
| **Excepción: espacios muy chicos** | Un baño o lavabo de menos de 1,5 m de lado abre hacia afuera (o corre) si la hoja pega con el inodoro o la ducha. |
| **Entrada y puertas de calle** | Abren hacia adentro (se ven protegidas de la lluvia y no invaden la vereda). |
| **Garaje → casa** | Abre hacia la casa (el garaje no tiene espacio) y, si hay desnivel, con un escalón de ≥ 5 cm. |
| **La hoja abre contra la pared**, no al medio de la habitación | La bisagra va del lado de la pared más cercana, a 90° sin chocar con muebles ni con otra hoja. |
| **Dos puertas enfrentadas no se pisan** | Si dos arcos se cruzan, se desplazan o una pasa a corrediza. |
| **No tapa una ventana ni un paso** | La hoja abierta no debe cubrir una ventana ni cortar una circulación. |
| **Anchos** | 75 cm: baños, placards, despensa. 87,5 cm: dormitorios y estar. 100 cm: entrada y accesibles. 150 cm (doble): entrada principal, patio. Los pasos con muebles grandes, 87,5 como mínimo. |
| **Corrediza donde la hoja no tiene lugar** | Baños y placards chicos, o un paso ancho al patio: la hoja corre junto al muro y no gira (apertura «Corrediza»). Necesita ese tramo de pared libre al costado. |
| **Portón** | Garaje o acceso de vehículos de 2,5 a 3 m (apertura «Seccional» o «Corrediza»): no gira, y por su luz el dintel se verifica con cálculo (`opening.span`). |
| **Ubicación en el muro** | ≥ 25 cm entre cada jamba y la esquina o el muro transversal (error `opening.pier` si no). Una puerta junto a una esquina abre hacia la pared que queda cerca. |
| **Enfrentar la salida a un patio** | Una puerta-ventana (`VG150`, ventanal 150 × 200) o doble `P150` enfrentada al estar. |

## 5. Ventanas

- **Antepecho** (la distancia desde el suelo, se elige por ventana): **1,00 m** en estar y dormitorios; **ventiluz** (`sill 6 u`, alto 50 cm) en baños y cocinas
  arriba de la mesada; **ventanal** al piso (`VG150`) al patio.
- **Un solo ancho por muro** si se puede: ritmo visual y menos cortes de bloque.
- **Total de vanos ≤ 60 % del tramo** de un muro portante entre cruces (advertencia `opening.ratio`); ventanas de más
  de 2,00 m de luz piden dintel armado (`opening.span`).
- **Fachada con dos plantas**: las ventanas de arriba se alinean con las de abajo (y, mejor, con los vanos), así los dinteles
  y cargas bajan parejos.

## 6. Estructura con bloques HCCA

- **Módulo**: medidas entre ejes múltiplo de **0,50 m** (4 u): dan pocos cortes, y el descarte baja del 4 %. Tabla
  rápida: 1 m = 8 u; 3 m = 24 u; 4 m = 32 u; 5 m = 40 u; 9 m = 72 u.
- **Espesores**: perimetrales y portantes de 20 cm (o 15 cm si el sistema lo permite).
- **Mampostería interior con bloques más finos**: todo lo que **no carga** (divisiones de ambientes, baños, placards,
  despensas, tabiques de la planta alta) se levanta con el bloque más delgado del sistema, **10 cm**, y no con el de 15 o
  20. Se gana superficie útil (cada tabique de 10 cm en lugar de 20 devuelve 10 cm de ancho al ambiente), se baja el peso
  sobre la losa y se abarata. Los muros de 15 y 20 cm quedan para el perímetro y para los portantes que
  apoyan losas, el nivel de arriba o el techo. Un tabique fino no lleva dinteles largos ni cargas colgadas
  (cocina, termotanque, mueble alto) sin refuerzo.
- **Pilares de hormigón armado** (20, 25, 30 o 40 cm de lado, de piso a techo): se usan donde el techo o la losa necesitan
  apoyo y no hay muro: alfresco, galería, porche, portón ancho. Se alinean con los de abajo o con un muro portante (el
  motor avisa con `support.column`) y se reparten a 2,5–3 m entre sí si sostienen un techo.
- **Alineación vertical**: los portantes de la planta alta apoyan sobre portantes de la baja; los tabiques apoyan en la
  losa del Nivel 2, que va sola bajo cada habitación de arriba (no se dibuja). Los pisos que se dibujan (balcón,
  terraza) tienen **luz** (lado corto) hasta 4 m sin vigas y vuelan hasta 1,20 m sin pilares.
- **Planta baja más grande que la alta**: el techo bajo apoya contra la pared de arriba (un agua), sin alero ni hastial
  de ese lado.
- **Techos**: dos aguas con cumbrera a lo largo del lado más largo; pendiente 30 %, alero 0,5 m. En L o con alas, techos
  cruzados con limahoya. Luces de cabios según la sección (`3x8` hasta 3,75 m, `3x10` 4,75 m, `3x12` 5,75 m).
- **Altura**: 3,00 m de muro (12 hiladas) y hasta 2 niveles.

## 6 bis. Nombrar los ambientes

Todo ambiente lleva nombre (herramienta «Nombre», o el campo «Nombre» al elegir la habitación): se ve en la planta junto
con sus m² y le sirve a quien lee el plano, al asistente y a la Revisión. En un espacio abierto (cocina + estar +
comedor) se pone **un nombre por zona**: la planta los muestra sin superficie, porque la zona no tiene paredes. Los
nombres de ambientes chicos (menos de 4 m²) se muestran sin los m² para no tapar a los vecinos. Usá nombres de uso
(«Dormitorio 2», «Baño en suite»), no de forma.

## 7. Lista de chequeo antes de dar por buena una casa

1. ¿Se llega a cada ambiente sin atravesar otro (salvo las excepciones)?
2. ¿Todas las puertas abren hacia donde corresponde y ninguna hoja pisa a otra? ¿Los tabiques que no cargan son de 10 cm?
3. ¿Estar y dormitorios miran al norte; baños, lavadero y garaje, al sur u oeste?
4. ¿Cada ambiente habitable tiene luz natural (≥ 1/8) y ventilación?
5. ¿La escalera llega a un hall y no a un dormitorio? ¿Los baños de arriba caen sobre los de abajo?
6. ¿La Revisión no marca errores ni advertencias? ¿El descarte queda < 4 %?
7. ¿Se ve bien en planta, en isométrica con y sin techo (skill `capturas`)?

## 8. Caso de estudio: casa de dos plantas con garaje

Plano real de una casa familiar de dos plantas (con cotas en metros), recreada en la
Galería como **«Casa de dos plantas con garaje»** (`casa-doble-planta-garaje`, ~234 m² útiles, 3 dormitorios).

**Programa del plano** — planta baja: garaje simple (5,50 × 3,41), cocina con isla (2,91 × 3,55), *family* (4,50 × 4,07),
comedor (3,38 × 3,09), sala de cine (3,82 × 2,95), despensa (W.I.P.), depósito, lavabo, lavadero, escritorio
(2,74 × 3,10), hall de entrada con porche y alfresco (2,50 × 4,55); planta alta: dormitorio principal (4,10 × 4,39) con
vestidor y baño en suite, dos dormitorios (3,00 × 3,08) con placards, baño, estar (3,50 × 4,86), balcón opcional.

**Lo que enseña**

- **Un eje de circulación entra y distribuye**: el hall nace en el porche, sube entre el garaje y el escritorio y
  desemboca en el comedor; la escalera, el lavabo y el lavadero cuelgan de él. Arriba, el estar es el distribuidor
  y de él salen todas las puertas.
- **Planta abierta en el núcleo social**: cocina, family y comedor son un solo espacio de ~70 m²; los servicios
  (despensa, depósito, lavabo, lavadero) se agrupan en una franja cerrada.
- **El garaje es de una planta y sobresale a un costado**, y funciona de amortiguador del lado oeste; tiene puerta propia al hall.
- **Dormitorios chicos con placards**, y el principal con vestidor y baño en suite alineados sobre el garaje.
- **Las puertas abren hacia adentro** de cada ambiente.

**Qué se simplificó** (ver brechas): el garaje a ras de la fachada (en el plano sobresale y es de una planta), el alfresco
(no hay cómo apoyar su techo), el balcón, los placards del plano pasaron a ser ambientes con puerta, las medidas se
llevaron al módulo de 0,50 m, y el techo es a dos aguas sobre todo el volumen.

## 9. Brechas del diseñador

Salieron de dibujar el plano anterior. Ordenadas por cuánto destraban, con el costo estimado (S/M/L) de cada una. Las tres primeras se **resolvieron en su versión simple** (marcadas «hecho»); lo que sigue pendiente se detalla en cada una.

### 9.1 Nombres de ambiente y zonas — hecho (queda lo de tipos)

- **Hecho**: cada nivel guarda `labels: [{id, x, y, name}]` (una celda dentro del ambiente y su nombre). La planta dibuja el nombre
  y, si el ambiente tiene un solo nombre, sus m²; con varios nombres (planta abierta) sólo los nombres. El generador de
  casas y las plantillas los ponen solos.
- **Falta**: un **tipo** por ambiente (estar, dormitorio, baño…) para que la **Revisión** avise de un dormitorio sin
  ventana, un baño sin ventilación o una superficie mínima, y para que el **Cómputo** separe m² por tipo. Hoy el nombre es
  texto libre.

### 9.2 Columnas, pilares y vigas — hecho el pilar (queda la viga)

- **Hecho**: pilar de hormigón armado (`columns: [{id, x, y, size}]`, 20 a 40 cm de lado, de piso a techo), herramienta «Pilar»
  (`C`), se arrastra para moverlo, entra al Cómputo (hormigón, hierro Ø10 y Ø8, encofrado) y la Revisión controla que los de
  la Planta Alta tengan apoyo (`support.column`). Con él se dibuja el alfresco de la plantilla.
- **Falta**: la **viga libre** entre pilares o entre un pilar y un muro (el encadenado U existe pero va sobre muros), la
  carga puntual sobre la fundación y la esbeltez en la Revisión, y que un techo sin muros alrededor avise si le falta
  apoyo. Con vigas se podrían hacer pórticos, vanos de más de 3 m y voladizos.

### 9.3 Puertas y ventanas — hecho lo principal

- **Hecho**: una **abertura** tiene tipo (puerta, ventana, portón), ancho, alto y apertura (batiente con bisagra a izquierda o
  derecha y lado, corrediza, fija, seccional); la posición se arrastra, no se tipea. El portón (`PG250`, `PG300`) no dibuja
  arco.
- **Falta**:

| Falta | Por qué importa |
| --- | --- |
| **Puerta plegadiza o de placard** | Placards y lavaderos |
| **Paso sin hoja (arco o vano libre)** | Cocina–comedor, pasillo–estar |
| **Ventana esquinera y vidriera** | Estar al norte y fachadas con más luz |
| **Ventana batiente con bisagra** (hoy se dibuja igual que una fija) | Ventanas que abren al pasillo o al patio |
| **Alto de puerta distinto de 2,00 m** | Portones y puertas-ventana más altas |

### 9.4 Escaleras (medio, M)

- Hay **recta, en L y en U**, con ancho, huella y giro. Faltan:
  - **Con descanso intermedio** (recta de 2 tramos) y **en L con escalones compensados** (abanico) en el giro, que ahorran
    espacio.
  - **Caracol**, para altillos y salidas chicas.
  - **Baranda o muro bajo lateral** («wall balustrade» y *dwarf wall* de 1,10 m del plano): hoy se puede dibujar un muro de
    media altura, pero no queda ligado a la escalera ni al hueco de la losa.
  - **Hueco de doble altura** (sin escalera) en la losa.
- La Revisión no verifica **cabeza libre** (≥ 2,00 m bajo el descanso o la losa) ni que el hueco no corte un tabique.

### 9.5 Exteriores y elementos de transición (medio, M) — hecho lo del terreno

- **Hecho**: **zonas** del terreno (pileta, patio o deck, jardín, camino) y **árboles** con tronco, copa y sombra; el porche
  o alfresco con techo ya se puede dibujar sobre pilares (ver 9.2).
- **Hecho**: **balcón y terraza** como piso extra del Nivel 2 fuera de las habitaciones, también en voladizo (advertencia
  si vuela más de 1,20 m sin pilares); no cuenta como ambiente.
- **Falta**: la **baranda** del balcón y **escalones de acceso** o desniveles de piso.
- **Techo de cuatro aguas** (`hip`): hoy sólo hay dos aguas y un agua (`gable`, `shed`); el plano no muestra la cubierta, pero en una casa así es habitual.

### 9.6 Validaciones de uso (medio, M)

Con ambientes nombrados (9.1) y puertas con bisagra (9.3) se puede revisar lo de los lineamientos de arriba:

- Un ambiente sin acceso, o al que se llega atravesando otro (grafo de puertas desde la entrada).
- Un pasillo con menos de 0,90 m libres, o más largo que cierto porcentaje de la planta.
- Dos arcos de puerta que se pisan, o que pisan un artefacto o la escalera.
- Dormitorio sin ventana; baño sin ventilación; escalera que llega a un dormitorio.
- La escalera no tiene cabeza libre; los baños de arriba no caen sobre los de abajo.

### 9.7 Dibujo y comunicación (bajo, S)

- **Cotas** (medidas por ambiente y totales) en la planta, y **leyenda** de tipos de ambiente por color.
- **Artefactos fijos** como símbolos (inodoro, lavabo, bacha, ducha, heladera, cocina): no hace falta mobiliario completo, pero
  sirven para medir si abre una puerta o cabe una ducha.
- **Lote**: retiros, vereda, acceso vehicular y rampa de garaje.

### 9.8 Otras observaciones del proceso

- La planta abierta (cocina + estar + comedor) es la regla en casas modernas y el editor la trata como un ambiente solo:
  la luz natural por habitación se mide sobre los 66 m² juntos, así que no puede avisar si la cocina o el comedor quedaron mal iluminados por separado.
- El **`TemplateBuilder`** no tenía forma de elegir el sentido de las puertas; se le agregaron `flip`, `hingeEnd` y `mode`, y `shift()` para correr el dibujo y dejar lugar a un alfresco al norte.
- Dibujar una casa «de plano» pide traducir metros a unidades y ajustarlas al módulo de 0,50 m a mano; una herramienta
  que importe un croquis o una lista de ambientes con medidas (el generador de `HouseGenerator` va por ese camino)
  ahorraría el paso.
