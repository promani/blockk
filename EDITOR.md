# Editor — funcionalidades y controles

El editor (`/`) es donde se dibuja la casa. Todo se apoya en la grilla del bloque: los muros van a 90° y en múltiplos de
12,5 cm, y el motor del servidor recalcula despiece, cómputo y revisión con cada cambio.

## Pantalla

- **Pestañas de nivel**: *Nivel 1*, *Nivel 2* (aparece con «+ Agregar nivel»; máximo 2 niveles con muros) y *Techo*.
- **Barra de herramientas** (izquierda): cambia según la pestaña. Lo avanzado queda bajo «Más».
- **Vista**: *Isométrica* o *Planta* (`Tab`). Abajo a la izquierda, el **selector de vistas**: un cuadrado en cuatro
  cuartos con una flecha diagonal en cada uno (las cuatro vistas isométricas) y un ojo al centro; también `[` `]`.
- **Ver adentro**: un deslizador baja la altura visible de los muros del nivel (no cambia el proyecto). Lo que queda a la vista
  detrás de la parte recortada de un muro se elige con un clic, como se ve.
- **Terreno y pasto**: fuera del lote el suelo sigue del mismo color que el terreno, con matas de pasto; adentro queda
  liso con la retícula. Con «Mostrar terreno» apagado, el fondo es liso.
- **Frente del terreno**: del lado de la calle se dibujan (por fuera del lote) una **vereda** de baldosas, una franja de pasto y una **calle** que sigue de borde a borde, para ver
  hacia dónde da el frente. El lado se elige en *Configuraciones generales* → «Frente (calle)»: abajo (por defecto),
  arriba, izquierda o derecha de la planta. Se guarda con el proyecto (`lot.front`); no entra al cómputo ni a la Revisión.
- **Muebles y árboles se pueden apagar**: en *Configuraciones generales*, las casillas «Muebles» y «Árboles». Apagadas,
  no se dibujan ni se pueden elegir, y su herramienta sale de la barra (el atajo no hace nada). Es una preferencia del
  navegador, como «Mostrar terreno»: el proyecto no cambia y los muebles y árboles siguen guardados.
- **Plano de fondo** (en «Configuraciones generales»): «Cargar plano…» pone una imagen (JPG, PNG, WebP) o la primera
  página de un PDF sobre el terreno, debajo del dibujo, en planta y en isométrica, para calcar encima con las
  herramientas de siempre. «Poner a escala»: se marcan dos puntos de una medida conocida y se escribe la distancia
  real en metros. «Mover» lo arrastra; además, opacidad, mostrar u ocultar, cambiar y quitar. No entra al proyecto, al
  `.json` ni al cómputo y no viaja al servidor: queda en este navegador (IndexedDB), atado al nombre del proyecto;
  «Nuevo» y «Abrir» lo quitan. Después de que el asistente calca un plano adjunto, su tarjeta ofrece «Usar el plano
  como fondo» para corregir el resultado contra el original (`assets/editor/backdrop.js`).
- **Brújula con el sol** (arriba a la derecha) y sombras según época, latitud y hora.
- **Panel derecho**: *Selección* o *Configuraciones generales* (terreno —con «Mostrar terreno» y «Mostrar cuadrícula»—,
  **norte** con una brújula que se arrastra (de a 5°, Mayús de a 1°, o escribiendo el ángulo), sol y ajustes del
  proyecto cuando no hay nada elegido). El sol se calcula con latitud, longitud y huso horario (ciudades cargadas o a
  mano): la hora del deslizador es la oficial y se informa el mediodía solar. Los lados de techos y escaleras se
  nombran por el plano (arriba, derecha…), sin puntos cardinales, **Resumen** y **Revisión**, que se adaptan a lo que se está haciendo.
- **Guía «Próximo paso»**: propone la siguiente acción (habitación, puerta, ventanas, nivel 2, piso, escalera, techo) y
  abre la herramienta con un clic. Se minimiza.
- **Botón flotante «✦ IA»** (abajo a la derecha, si el asistente está configurado): ver [LLM.md](LLM.md).

## En el celular

Con pantallas de hasta 760 px el editor es **de sólo lectura**: sin barra de herramientas, paneles ni controles, con
la casa completa (pestaña Techo) y un aviso abajo de que para editar se requiere una pantalla más grande. Un dedo mueve
la vista, dos dedos hacen zoom y un doble toque encuadra. El resto de las pantallas (Galería con el asistente, Cómputo y
Catálogo) se adaptan al ancho; la tarjeta «Proyecto en blanco» se oculta.

## Herramientas

| Herramienta | Tecla | Qué hace |
| --- | --- | --- |
| Elegir | `V` | Clic en un muro, vano, losa, escalera, techo o hastial para verlo y cambiarlo; doble clic en el piso elige la habitación. Manijas azules para estirar. **Toda pieza se mueve arrastrándola**: aberturas, pilares, muebles, escaleras, zonas, árboles y nombres, directamente; un muro (se corre perpendicular, igual que con su manija; sólo ese tramo: si queda un escalón con el tramo vecino de la misma recta, se cierra con un muro corto), una losa, un entrepiso, una viga de madera o un techo, una vez elegidos con un clic (sin elegir, arrastrar sobre ellos sigue siendo el rectángulo de selección). Arrastrando un rectángulo se eligen varios elementos (muros con sus vanos, escaleras, pisos y techos de todos los niveles) o `Ctrl+A` toda la casa; se borran juntos con `Supr` (o «Eliminar» en la barra), se arrastran o se corren con **Mayús + flechas** de a un bloque dentro del terreno (las flechas solas mueven la cámara). Lo elegido se **copia y pega** (`Ctrl+C` / `Ctrl+V`, o «Duplicar», `Ctrl+D`): ver más abajo. |
| Habitación | `R` | Arrastrar en diagonal dibuja cuatro muros; empezando desde una pared existente, se comparte. |
| Muro | `W` | Muro a muro; al volver al punto de partida la cadena se cierra sola (igual que Habitación). Con el primer punto puesto se puede **escribir el largo** en metros (`3,25`) y `Enter` coloca el tramo hacia donde apunta el cursor, redondeado a 12,5 cm; `Retroceso` corrige. |
| Abertura | `P` (`N`: ventana) | Una sola herramienta con **tipo** (puerta, **arcada** —el vano sin hoja—, ventana, portón), **medida** (de catálogo o «A medida», con **ancho** y **antepecho** libres) y **apertura** (batiente, corrediza, fija, seccional). Apuntar a un muro: el verde indica dónde entra respetando jambas de 25 cm. Después se mueve **arrastrándola** (también a otro muro). |
| Medir | `M` | Bajo «Más» (y en la pestaña Techo): clic en un punto y clic en otro muestra la distancia (y Δx / Δy si es diagonal). Los puntos se ajustan a la retícula de 12,5 cm y, cerca de un muro, a su **cara**: así se mide la luz libre entre paredes. No cambia el proyecto; `Esc` borra la medida. |
| Zona | `Z` | Bajo «Más»: arrastrar un rectángulo sobre el terreno y elegir su tipo: pileta, patio o deck, jardín, camino o **genérica** (cualquier otro sector, con el nombre que se le ponga). Marca cómo se usa el espacio; **no es parte de la casa ni entra al cómputo**. Se arrastra para moverla y, una vez elegida, los puntos azules de sus cuatro lados la agrandan o la achican de a 12,5 cm; el panel cambia tipo, nombre y medidas. |
| Árbol | `O` | Bajo «Más»: clic para plantar un árbol chico, mediano o grande, con tronco, copa y sombra (con el sol activado, la sombra sigue su posición). Se arrastra para moverlo. En la isométrica, el árbol que queda delante de la casa se transparenta sobre ella: las hojas casi no tapan y las ramas se insinúan (el que queda detrás, tapado). No entra al cómputo. |
| Mueble | `G` | Bajo «Más»: al entrar se abre el **menú de muebles** y no se coloca nada hasta elegir uno (después, «cambiar» lo reabre). Catálogo (camas, mesa de luz, placard, mesas con sillas, sillones, mesada, isla, heladera, cocina, lavarropas, inodoro, bidet, lavatorio, ducha, bañera, escritorio) y hacer clic para colocarlo; `X` lo gira de a 90°. Son **gabaritos de tamaño real** para ver si el ambiente alcanza: un rectángulo con su nombre en la planta y una caja lisa en la isométrica. Se arrastra para moverlo (de a 12,5 cm). **No entra al cómputo ni a la Revisión.** |
| Pilar | `C` | Clic en un punto de la retícula: pilar de hormigón armado (20, 25, 30 o 40 cm) de piso a techo. Se arrastra para moverlo; sostiene techos o losas donde no hay muro (alfresco, galería). |
| Nombre | `A` | Elegir un **tipo** de ambiente o escribir un nombre libre (o las dos cosas) y hacer clic dentro de un ambiente: se ve en la planta. El tipo da las recomendaciones de la Revisión y agrupa los m² del Resumen; sin tipo elegido se deduce del nombre. En un espacio abierto se pueden poner varios; se arrastran. También desde el campo «Nombre» al elegir una habitación. |
| Escalera | `S` | Clic dentro de una habitación del Nivel 1: recta, en L o en U. Sigue al cursor, se acomoda dentro de la habitación y, si no entra, se gira sola. `X` gira. Después se mueve arrastrándola con Elegir, como cualquier objeto. |
| Piso | `L` | En el Nivel 2: clic dentro de una habitación de abajo; losa de hormigón o entrepiso de madera, con el hueco de la escalera recortado. |
| Techo | `H` | Siempre en la barra; desde un nivel lleva a la pestaña Techo. Ahí: clic sobre una habitación (alta o baja: se elige la que se ve bajo el cursor) o un rectángulo sobre los muros. El techo apoya en los muros que lo rodean (el nivel sale solo), el alero va sólo donde cae el agua y, pegado a la planta alta, se propone a un agua bajando desde esa pared. Los cabios se eligen solos según la luz y los techos no generan observaciones: son para ver la casa completa y computar la madera. |
| Bloque, Viga U, Viga de madera | `B`, `U`, `T` | Bajo «Más»: un bloque suelto, un encadenado U intermedio, una viga de madera. |

## Asistencias al dibujar

- Paso de dibujo de un bloque entero (50 cm con Lika) y puntos de ajuste junto al cursor.
- **Imán** azul: pega el trazo al eje o extremo del muro más cercano (del nivel o del de abajo), hasta 40 cm.
- **Guías de alineación** al arrastrar un muro, una esquina o un borde de techo: muros de abajo en naranja, paredes
  vecinas en azul; a menos de 25 cm se pega.
- Mover un muro estira los que llegan a él; si queda justo sobre la línea de un vecino, el tramo sobrante se absorbe.
- Al elegir una habitación, el panel **sugiere** agrandarla hasta los muros de abajo o la pared vecina.
- Cada habitación cerrada se pinta con su color de piso; sus **esquinas azules** la agrandan o achican.

## Copiar y pegar

- `Ctrl+C` copia lo elegido: el grupo del rectángulo o un elemento suelto (un muro lleva sus vanos y vigas U; también
  pilares, nombres, muebles, techos, losas, escaleras, madera, zonas y árboles). El portapapeles vive en la página (no pasa a
  otra pestaña).
- `Ctrl+V` deja el grupo como un fantasma azul que sigue al cursor, de a bloques enteros y dentro del terreno; un clic
  lo pega (un solo paso de deshacer, «Pegar») y queda elegido para seguir moviéndolo. `Esc` cancela.
- Si lo copiado es de un solo nivel y se pega con el otro nivel activo, los muros, vanos, vigas U, pilares y nombres van
  al **nivel activo**: sirve para repetir la planta arriba. Losas, escaleras, madera y techos no cambian de nivel.
- Una **abertura** sola, con otro **muro elegido**, se pega en ese muro (mismo tipo y medidas, en el lugar libre más
  cercano al centro; jambas de 25 cm). Sin elegir otro muro, se repite en el tramo libre más cercano del mismo muro.
- Al elegir una abertura aparece junto a ella un **menú de tipo** (Puerta, Arcada, Ventana, Portón) para cambiarlo con
  un clic; el resto de sus datos, en el panel.
- `Ctrl+D` o el botón «Duplicar» de la barra de opciones hacen las dos cosas juntas.

## Propiedades por elemento

- **Muro**: espesor (los del sistema: 10 / 15 / 20 cm con Lika), **alto** (de 50 cm a 3,00 m; sin nada encima hasta 4,00 m) y **corona U**
  (se puede sacar en paredes que son sólo mampostería).
- **Abertura**: tipo, **medida** y apertura y, si abre, el giro (bisagra y lado) o el recorrido de la hoja. La medida es una
  **carpintería comercial** del catálogo (`Hcca::commercialOpenings()`: puertas 70 / 80 / 90 y doble 160 × 200, ventiluces,
  ventanas de 100 a 200 × 110 y 120 / 150 × 150, puertas ventana de 150 a 240 × 200 y portones de 240 y 300 × 200), que
  fija el **vano modular** que la contiene (ancho de a 12,5 cm y alto de a 25 cm: «Ventana 120 × 110 (vano 125 × 125)»),
  o «A medida», con el ancho (en cm) y el antepecho de las ventanas (distancia desde el suelo; el alto sale de ahí
  porque todas llegan a los 2,00 m). Son medidas de referencia: cada fabricante tiene las suyas. No tiene campo de
  posición: se arrastra.
- **Habitación** (rectangular): **ancho y fondo exactos** en metros, a ejes de muro (paso de 12,5 cm): corren el muro
  derecho o el de abajo, igual que arrastrar su manija.
- **Pilar**: lado (20 a 40 cm). **Nombre**: el texto.
- **Mueble**: cuál es (se puede cambiar por otro del catálogo), «Girar 90°», lo que ocupa y su alto. El catálogo está en
  `Hcca::furniture()` (medidas de referencia en cm; las mesas incluyen las sillas). En la isométrica ninguna caja pasa
  de 1 m de alto, para no tapar el ambiente.
- **Techo**: tipo, sentido de la cumbrera o de la caída, pendiente, alero, sección y separación de cabios. Si dos techos
  se superponen sólo queda el más alto (dos techos a dos aguas cruzados forman una cruz). Los **hastiales** de bloque se
  despiezan hilada por hilada y se pueden quitar o cambiar de espesor.
- **Losa / entrepiso / escalera**: espesor, sección y separación de tirantes, forma y giro de la escalera.
- Ningún panel tiene campos de posición X / Y: las piezas se ubican arrastrándolas con Elegir.

## Resumen y Revisión según el contexto

- Con Puerta o Ventana: vidrio total, **luz natural por habitación** (referencia ≥ 1/8 del piso), vidrio por
  orientación y «Sugerir ventanas según el sol».
- Con un muro: sus piezas, cortes y bloques U. Con una habitación: superficie y luz. Con Piso o Escalera: losas,
  tirantes y escaleras. En la pestaña Techo: los techos.
- La **Revisión** muestra primero las observaciones de lo que se está haciendo; el resto del proyecto queda a un clic.
  Cada observación lleva al elemento.

## Teclado y mouse

| Acción | Control |
| --- | --- |
| Herramientas | `V R W P N S L H B U T M` (`C` pilar, `A` nombre, `G` mueble, `Z` zona, `O` árbol) |
| Deshacer / rehacer | `Ctrl+Z` / `Ctrl+Y` (también los botones de la barra superior) |
| Eliminar lo elegido | `Supr` o `Retroceso` |
| Cancelar | `Esc` |
| Isométrica / planta | `Tab` |
| Girar la vista | `[` `]` o el selector de vistas |
| Zoom | rueda, `+` `-` o los botones de la esquina |
| Encuadrar | `F` |
| Paneo | clic central o `Espacio` + arrastre, o las flechas |
| Correr lo elegido de a un bloque | `Mayús` + flechas |
| Nivel 1 / Nivel 2 / Techo | `1` `2` `3` |
| Girar bloque o escalera | `X` |
| Elegir toda la casa | `Ctrl+A` |
| Copiar / pegar / duplicar lo elegido | `Ctrl+C` / `Ctrl+V` / `Ctrl+D` |
| Largo exacto del muro en curso | dígitos y coma, `Enter` |

## Archivo

*Nuevo*, *Guardar* (en «Mis casas»: en el servidor y sólo para este navegador), *Descargar* (el `.json`), *Abrir* (un
`.json`) y *Compartir* (enlace editable; ver más abajo). El proyecto en curso se guarda solo en el navegador
(`localStorage`). Las casas guardadas se ven en la Galería, en «Mis casas», con Abrir, Comparar (de a dos), Renombrar
y Eliminar, más «Llevar a otro navegador» (un enlace de un solo uso que las copia); nadie más las ve ni las puede
abrir. **Comparar** (`/comparar`) muestra dos casas guardadas lado a lado, con la diferencia de la segunda contra la
primera. El cómputo está en la pestaña
«Cómputo» de la barra superior.

## Otras pantallas

- **Cómputo** (`/computo`): KPIs, desglose por nivel, patrones de corte, madera, presupuesto con **precios editables**,
  envío a un distribuidor (correo/WhatsApp) y exportación **CSV** y **PDF** vectorial.
- **Galería** (`/galeria`): asistente de IA, proyecto en blanco con retícula parametrizable y plantillas
  con métricas del motor y un carrusel de planta e isométrica (dibujadas con el renderer del editor; pasa solo mientras
  el mouse está encima). Las de las plantillas se pregeneran con `composer miniaturas` (`public/img/plantillas`, con
  hash del proyecto); los modelos creados por la API de administración no tienen imágenes pregeneradas y muestran la planta en SVG; cada una con «Usar» y «✦ Modificar con IA». Antes de reemplazar el proyecto del
  editor se pide confirmación.
- **Planos** (`/planos`): lista de los planos del proyecto actual y botón «Generar planos», que arma un PDF vectorial
  (`assets/planos/planos.js`, con `assets/lib/pdf.js`): portada con la isométrica (JPEG del renderer), planta por
  nivel, planta de techos, un alzado por muro (código `N1-M3`: hiladas, cortes con medida, U, vanos, hastial y
  ubicación) y la lista de materiales.
- **Compartir** (botón de la barra del editor, `assets/editor/share.js`): guarda el proyecto en `/api/compartidos` y
  abre `/?compartido=<id>`; quien tenga el enlace edita y los cambios se guardan solos (1,2 s después del último). Al
  volver a la pestaña se trae la versión más nueva si no hay cambios propios sin guardar. «Nuevo» y «Abrir» dejan de
  usar el enlace.
- **Hastiales**: son mampostería como los muros: cada pieza del despiece del servidor se dibuja como un bloque (con sus
  juntas y los cortes en amarillo) y se recorta en diagonal con la pendiente. «Techos» (en Configuraciones generales)
  oculta los faldones para verlos.
- **Colores**: todos en `assets/styles/tema.css` (interfaz y dibujo, variables `--dibujo-*` que lee
  `assets/lib/theme.js`). Se edita el archivo y se recarga; las miniaturas de la Galería se regeneran con
  `composer miniaturas`.
- **Catálogo técnico** (`/catalogo`): fichas de piezas, reglas críticas de colocación, módulo y niveles, calculadora
  rápida de paño y mortero y preguntas frecuentes. Ver [HCCA.md](HCCA.md).

## Código

`assets/editor/`: `main.js` (arranque, teclado, barra), `store.js` (estado, historial y llamadas a `/api/analyze`),
`tools.js` (herramientas), `scene.js` + `renderer.js` (cajas y dibujo; orden de pintor por capas), `snap.js` (imán y
anclajes), `wallmove.js`, `panels.js` + `context.js` (panel derecho según el contexto), `guide.js`, `ai.js` (botón
flotante). En la página, `window.blockk` expone store, cámara y render para las pruebas.
