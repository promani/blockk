# Editor — funcionalidades y controles

El editor (`/`) es donde se dibuja la casa. Todo se apoya en la grilla del bloque: los muros van a 90° y en múltiplos de
12,5 cm, y el motor del servidor recalcula despiece, cómputo y revisión con cada cambio.

## Pantalla

- **Pestañas de nivel**: *Nivel 1*, *Nivel 2* (aparece con «+ Agregar nivel»; máximo 2 niveles con muros) y *Techo*.
- **Barra de herramientas** (izquierda): cambia según la pestaña. Lo avanzado queda bajo «Más».
- **Vista**: *Isométrica* o *Planta* (`Tab`). Abajo a la izquierda, el **selector de vistas**: un cuadrado en cuatro
  cuartos con una flecha diagonal en cada uno (las cuatro vistas isométricas) y un ojo al centro; también `[` `]`.
- **Ver adentro**: un deslizador baja la altura visible de los muros del nivel (no cambia el proyecto).
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
| Elegir | `V` | Clic en un muro, vano, losa, escalera, techo o hastial para verlo y cambiarlo; doble clic en el piso elige la habitación. Manijas azules para estirar. Arrastrando un rectángulo se eligen varios elementos (muros con sus vanos, escaleras, pisos y techos de todos los niveles) o `Ctrl+A` toda la casa; se arrastran o se corren con flechas de a un bloque dentro del terreno. |
| Habitación | `R` | Arrastrar en diagonal dibuja cuatro muros; empezando desde una pared existente, se comparte. |
| Muro | `W` | Muro a muro; al volver al punto de partida la cadena se cierra sola (igual que Habitación). |
| Abertura | `P` (`N`: ventana) | Una sola herramienta con **tipo** (puerta, ventana, portón), **ancho**, **alto** (ventanas) y **apertura** (batiente, corrediza, fija, seccional). Apuntar a un muro: el verde indica dónde entra respetando jambas de 25 cm. Después se mueve **arrastrándola** (también a otro muro). |
| Pilar | `C` | Clic en un punto de la retícula: pilar de hormigón armado (20, 25, 30 o 40 cm) de piso a techo. Se arrastra para moverlo; sostiene techos o losas donde no hay muro (alfresco, galería). |
| Nombre | `A` | Escribir o elegir un nombre y hacer clic dentro de un ambiente: se ve en la planta. En un espacio abierto se pueden poner varios; se arrastran. También desde el campo «Nombre» al elegir una habitación. |
| Escalera | `S` | Clic dentro de una habitación del Nivel 1: recta, en L o en U. Sigue al cursor, se acomoda dentro de la habitación y, si no entra, se gira sola. `X` gira. |
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

## Propiedades por elemento

- **Muro**: espesor (los del sistema: 10 / 15 / 20 cm con Lika), **alto** (de 50 cm a 3,00 m; sin nada encima hasta 4,00 m) y **corona U**
  (se puede sacar en paredes que son sólo mampostería).
- **Abertura**: tipo, ancho y alto (en cm), apertura y, si abre, el giro (bisagra y lado) o el recorrido de la hoja. No tiene campo de posición: se arrastra.
- **Pilar**: lado (20 a 40 cm). **Nombre**: el texto.
- **Techo**: tipo, sentido de la cumbrera o de la caída, pendiente, alero, sección y separación de cabios. Si dos techos
  se superponen sólo queda el más alto (dos techos a dos aguas cruzados forman una cruz). Los **hastiales** de bloque se
  despiezan hilada por hilada y se pueden quitar o cambiar de espesor.
- **Losa / entrepiso / escalera**: espesor, sección y separación de tirantes, forma y giro de la escalera.

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
| Herramientas | `V R W P N S L H B U T` |
| Deshacer / rehacer | `Ctrl+Z` / `Ctrl+Y` (también los botones de la barra superior) |
| Eliminar lo elegido | `Supr` o `Retroceso` |
| Cancelar | `Esc` |
| Isométrica / planta | `Tab` |
| Girar la vista | `[` `]` o el selector de vistas |
| Zoom | rueda, `+` `-` o los botones de la esquina |
| Encuadrar | `F` |
| Paneo | clic central o `Espacio` + arrastre |
| Nivel 1 / Nivel 2 / Techo | `1` `2` `3` |
| Girar bloque o escalera | `X` |
| Elegir toda la casa | `Ctrl+A` |

## Archivo

*Nuevo*, *Guardar* (descarga el `.json`) y *Abrir*. El proyecto se guarda solo en el navegador (`localStorage`). El cómputo está en la pestaña «Cómputo» de la barra superior.

## Otras pantallas

- **Cómputo** (`/computo`): KPIs, desglose por nivel, patrones de corte, madera, presupuesto con **precios editables**,
  envío a un distribuidor (correo/WhatsApp) y exportación **CSV** y **PDF** vectorial.
- **Galería** (`/galeria`): asistente de IA, proyecto en blanco con retícula parametrizable y plantillas
  con métricas del motor y un carrusel de planta e isométrica (dibujadas con el renderer del editor; pasa solo mientras
  el mouse está encima). Las de las plantillas se pregeneran con `composer miniaturas` (`public/img/plantillas`, con
  hash del proyecto); los modelos creados por la API de administración no tienen imágenes pregeneradas y muestran la planta en SVG; cada una con «Usar» y «✦ Modificar con IA». Antes de reemplazar el proyecto del
  editor se pide confirmación.
- **Estilos** (`/estilos`): paletas (Vivo, Clásico, Tierra, Contraste) y cada color de la interfaz y del dibujo, con
  vista previa; se guarda en el navegador (`assets/lib/theme.js`). Las miniaturas pregeneradas de la Galería usan la
  paleta por defecto.
- **Catálogo técnico** (`/catalogo`): fichas de piezas, reglas críticas de colocación, módulo y niveles, calculadora
  rápida de paño y mortero y preguntas frecuentes. Ver [HCCA.md](HCCA.md).

## Código

`assets/editor/`: `main.js` (arranque, teclado, barra), `store.js` (estado, historial y llamadas a `/api/analyze`),
`tools.js` (herramientas), `scene.js` + `renderer.js` (cajas y dibujo; orden de pintor por capas), `snap.js` (imán y
anclajes), `wallmove.js`, `panels.js` + `context.js` (panel derecho según el contexto), `guide.js`, `ai.js` (botón
flotante). En la página, `window.blockk` expone store, cámara y render para las pruebas.
