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

Cada puerta se define por **ancho** (`P75`, `P87`, `P100`, `P150`), **lado** (hacia qué ambiente abre: casilla «Abre hacia
el otro lado», `flip`) y **bisagra** (hoy siempre en el extremo inicial del vano; ver brechas).

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
| **Ubicación en el muro** | ≥ 25 cm entre cada jamba y la esquina o el muro transversal (error `opening.pier` si no). Una puerta junto a una esquina abre hacia la pared que queda cerca. |
| **Enfrentar la salida a un patio** | Una puerta-ventana (`VG150`, ventanal 150 × 200) o doble `P150` enfrentada al estar. |

## 5. Ventanas

- **Antepecho 1,00 m** (`sill 4 u`) en estar y dormitorios; **ventiluz** (`sill 6 u`, alto 50 cm) en baños y cocinas
  arriba de la mesada; **ventanal** al piso (`VG150`) al patio.
- **Un solo ancho por muro** si se puede: ritmo visual y menos cortes de bloque.
- **Total de vanos ≤ 60 % del tramo** de un muro portante entre cruces (advertencia `opening.ratio`); ventanas de más
  de 2,00 m de luz piden dintel armado (`opening.span`).
- **Fachada con dos plantas**: las ventanas de arriba se alinean con las de abajo (y, mejor, con los vanos), así los dinteles
  y cargas bajan parejos.

## 6. Estructura con bloques HCCA

- **Módulo**: medidas entre ejes múltiplo de **0,50 m** (4 u): dan pocos cortes, y el descarte baja del 4 %. Tabla
  rápida: 1 m = 8 u; 3 m = 24 u; 4 m = 32 u; 5 m = 40 u; 9 m = 72 u.
- **Espesores**: perimetrales y portantes de 20 cm (o 15 cm si el sistema lo permite); tabiques de 10 cm sólo
  separan y no cargan.
- **Alineación vertical**: los portantes de la planta alta apoyan sobre portantes de la baja; los tabiques apoyan en la
  losa o entrepiso. La **luz de losa** (lado corto) hasta 4 m sin vigas: una losa grande se parte en paños que
  apoyan sobre muros.
- **Planta baja más grande que la alta**: el techo bajo apoya contra la pared de arriba (un agua), sin alero ni hastial
  de ese lado.
- **Techos**: dos aguas con cumbrera a lo largo del lado más largo; pendiente 30 %, alero 0,5 m. En L o con alas, techos
  cruzados con limahoya. Luces de cabios según la sección (`3x8` hasta 3,75 m, `3x10` 4,75 m, `3x12` 5,75 m).
- **Altura**: 3,00 m de muro (12 hiladas) y hasta 2 niveles.

## 7. Lista de chequeo antes de dar por buena una casa

1. ¿Se llega a cada ambiente sin atravesar otro (salvo las excepciones)?
2. ¿Todas las puertas abren hacia donde corresponde y ninguna hoja pisa a otra?
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

Salieron de dibujar el plano anterior. Ordenadas por cuánto destraban, con el costo estimado (S/M/L) de cada una.

### 9.1 Nombres de ambiente y zonas (alto, M)

- Hoy cada ambiente cerrado se llama **«Ambiente N»** con sus m². En el plano de arriba, el estar, la cocina, el comedor y el
  hall son **un solo «Ambiente 1» de 66,7 m²**: el detector de ambientes sólo conoce paredes y no puede dividir un espacio
  abierto.
- **Propuesta**: un arreglo `rooms: [{x, y, name, type}]` en el proyecto (un punto dentro de cada ambiente, su nombre y su
  tipo: estar, dormitorio, baño…). La vista cenital (planta) dibuja **nombre + m²** en el centro del ambiente o de la
  zona; en un espacio abierto se pueden poner varios puntos, y cada uno nombra una **zona** sin pared.
- Con tipo, la **Revisión puede ser más inteligente**: dormitorio sin ventana, baño sin ventilación, cocina sin
  ventilación, superficies mínimas por tipo; y el **Cómputo** puede separar m² por tipo. El asistente ya trabaja con
  nombres (`HouseDescriber`, el generador): unificar con este campo evita traducir.

### 9.2 Columnas, pilares y vigas (alto, L)

- No hay **apoyo puntual**: el techo y la losa sólo apoyan sobre muros. Por eso no se pudo dibujar el **alfresco**, un
  porche cubierto, una galería, un garaje abierto ni un voladizo grande.
- **Propuesta**: elemento `column` (pilar de bloque lleno de hormigón, hormigón armado o madera; sección 20 × 20 o 30 × 30;
  altura) y la **viga** que lo une con el muro (el encadenado U ya existe: extenderlo a vigas libres). Con ellas se
  pueden hacer pórticos, vanos de más de 3 m (garaje, ventanal corredizo), losas con apoyos intermedios y
  voladizos con tensor.
- Reglas para la Revisión: carga puntual sobre fundación, esbeltez, luz de la viga, techo apoyado sin sostén.

### 9.3 Puertas y ventanas (alto, M)

| Falta | Hoy | Por qué importa |
| --- | --- | --- |
| **Bisagra a izquierda o derecha** | Sólo se elige el lado (`flip`); la bisagra va siempre al inicio del vano | Son 4 combinaciones (lado × bisagra); sin ella, el arco choca con la pared o con otra hoja |
| **Puerta corrediza / de embutir** | No existe | Baños chicos, placards, comedor al patio; sin arco de giro |
| **Puerta plegadiza o de placard** | No existe | Placards y lavaderos |
| **Portón de garaje seccional (2,4–3,0 m)** | El máximo es `P150` y se dibuja con arco | El garaje del plano pide ≥ 2,4 m y no gira |
| **Paso sin hoja (arco o vano libre)** | No existe | Cocina–comedor, pasillo–estar |
| **Ventana esquinera, ventana fija, vidriera** | Sólo ventanas rectas de 62 a 187 cm | Estar al norte y fachadas con más luz |
| **Puerta-ventana corrediza de 2–3 m** | `VG150` (1,5 m) y `P150` | Salida al patio y al alfresco |
| **Alto y antepecho propios por vano** | Editables sólo sobre los presets | Ventanas de cocina sobre mesada, ventiluz de baño |

### 9.4 Escaleras (medio, M)

- Hay **recta, en L y en U**, con ancho, huella y giro. Faltan:
  - **Con descanso intermedio** (recta de 2 tramos) y **en L con escalones compensados** (abanico) en el giro, que ahorran
    espacio.
  - **Caracol**, para altillos y salidas chicas.
  - **Baranda o muro bajo lateral** («wall balustrade» y *dwarf wall* de 1,10 m del plano): hoy se puede dibujar un muro de
    media altura, pero no queda ligado a la escalera ni al hueco de la losa.
  - **Hueco de doble altura** (sin escalera) en la losa.
- La Revisión no verifica **cabeza libre** (≥ 2,00 m bajo el descanso o la losa) ni que el hueco no corte un tabique.

### 9.5 Exteriores y elementos de transición (medio, M)

- **Balcón, terraza y voladizo**: una losa sin muros debajo, con baranda, que no cuenta como ambiente.
- **Porche con techo** apoyado en columna (ver 9.2) y **escalones de acceso** o desniveles de piso.
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
- **Losas partidas** por la regla de 4 m de luz se ven con una línea punteada en la planta: conviene mostrarlas como un
  solo paño con un apoyo intermedio.
- **Lote**: retiros, vereda, acceso vehicular y rampa de garaje.

### 9.8 Otras observaciones del proceso

- La planta abierta (cocina + estar + comedor) es la regla en casas modernas y el editor la trata como un ambiente solo:
  la luz natural por habitación se mide sobre los 66 m² juntos, así que no puede avisar si la cocina o el comedor quedaron mal iluminados por separado.
- El **`TemplateBuilder`** no tenía forma de elegir el sentido de las puertas; se le agregó el parámetro `flip` en esta
  versión.
- Dibujar una casa «de plano» pide traducir metros a unidades y ajustarlas al módulo de 0,50 m a mano; una herramienta
  que importe un croquis o una lista de ambientes con medidas (el generador de `HouseGenerator` va por ese camino)
  ahorraría el paso.
