# Funcionalidades — qué tiene Blockk Studio y qué no

Inventario de lo que la aplicación **hace** y **no hace**, pensado para compararla con otras herramientas de diseño de
casas. Cada «no» está marcado como **a propósito** (es parte de la propuesta) o **todavía no** (candidato al
[BACKLOG.md](BACKLOG.md)). Para el detalle de uso ver [EDITOR.md](EDITOR.md), [LLM.md](LLM.md) y [HCCA.md](HCCA.md).

## 1. La propuesta en una página

Blockk Studio responde **una sola pregunta**: *«si construyo esta casa con bloques de hormigón celular, ¿cuántas piezas,
pallets, bolsas, hierro y madera compro?»*. Todo lo demás existe para llegar a ese número con el menor esfuerzo.

| Principio | Qué significa en la práctica |
| --- | --- |
| **Simple antes que completo** | Se dibuja con muros a 90° sobre una retícula de 12,5 cm, con pocas herramientas. No hay modos, capas, materiales ni parámetros por elemento más allá de lo que cambia el cómputo. |
| **Conversar antes que dibujar** | Se puede pedir la casa («2 plantas, 3 dormitorios, cocina integrada») y ajustarla hablando. La IA no dibuja: conversa y usa un generador determinista que siempre devuelve una casa válida. |
| **El bloque es la unidad** | El modelo *es* la pared de bloques: hilada por hilada, con trabas, cortes, dinteles y corona. No es un dibujo al que después se le calcula algo: el dibujo se construye con las reglas del sistema. |
| **Calcular bien lo que importa** | Bloques por espesor, cortes con reutilización, pallets, adhesivo, hormigón y hierro de los bloques U, madera, losas, escaleras, pilares y presupuesto. Cada número sale de una pieza concreta. |
| **Perder detalle a propósito** | Sin muebles de catálogo, texturas, cotas de taller, instalaciones ni curvas. Lo que no cambia el cómputo o la coherencia constructiva se deja afuera. |
| **Avisar, no calcular estructuras** | La Revisión marca lo que no se puede construir (vanos pegados a una esquina, apoyos, luces de madera). Predimensiona; no reemplaza a un profesional. |

## 2. Cómo se compara (a grandes rasgos)

Comparación por **tipo de herramienta**, no contra un producto en particular: describe lo habitual en cada familia y
puede no valer para todos los productos. Referencias: *planificadores de plantas* (Floorplanner, RoomSketcher, Sweet
Home 3D y similares), *modeladores 3D* (SketchUp y similares), *BIM* (Revit, ArchiCAD) y *calculadoras de
materiales* de fabricantes y corralones.

| Capacidad | Blockk | Planificadores de plantas | Modeladores 3D | BIM | Calculadoras de fabricante |
| --- | :---: | :---: | :---: | :---: | :---: |
| Curva de aprendizaje baja | ● | ● | ◐ | ○ | ● |
| Diseño conversacional (pedir la casa hablando) | ● | ◐ (asistentes de IA en algunos) | ○ | ○ | ○ |
| Despiece pieza por pieza de un sistema de bloques | ● | ○ | ○ | ◐ (con familias a medida) | ◐ (por m², sin cortes) |
| Cortes optimizados y reutilización de sobrantes | ● | ○ | ○ | ○ | ○ |
| Cómputo y presupuesto de referencia exportable | ● | ◐ | ○ | ● | ● |
| Revisión de reglas constructivas del sistema | ● | ○ | ○ | ◐ | ○ |
| Orientación y sol (ganancia solar, ventanas sugeridas) | ● | ◐ | ◐ | ● | ○ |
| Muebles, texturas y render fotorrealista | ○ | ● | ● | ◐ | ○ |
| Formas libres (curvas, diagonales, terreno) | ○ | ◐ | ● | ● | ○ |
| Planos de documentación (cotas, cortes, carpinterías) | ○ | ◐ | ◐ | ● | ○ |
| Cálculo estructural e instalaciones | ○ | ○ | ○ | ● | ○ |
| Varias personas, nube, versiones | ○ | ● | ◐ | ● | ○ |
| Costo de adopción (sin cuenta, sin instalación) | ● | ◐ | ◐ | ○ | ● |

● lo hace como fuerte · ◐ parcial o según el producto · ○ no.

**Lectura**: Blockk gana donde las otras familias son débiles (el cálculo exacto de un sistema constructivo concreto y
la conversación) y pierde, **por decisión**, donde son fuertes (apariencia, libertad de forma, documentación y
trabajo en equipo).

## 3. Lo que hay

### 3.1 Dibujar (editor 3D)

- **Muros ortogonales** sobre la retícula de 12,5 cm (el bloque entero de 50 cm es el paso). Herramientas: Habitación,
  Muro, Bloque suelto. Espesores del sistema: 10, 15 y 20 cm; alto de 50 cm a 3 m (hasta 4 m si no hay nada arriba).
- **Aberturas**: una sola herramienta con **tipo** (puerta, ventana, portón), **ancho**, **alto** y **apertura**
  (batiente con bisagra y lado, corrediza, fija, seccional); en las ventanas, el **antepecho** (distancia desde el suelo).
  Se colocan apuntando al muro (el verde marca lugar
  válido) y se mueven arrastrándolas, también a otro muro. Se eligen por **medida comercial** de carpintería (puerta
  80 × 200, ventana 120 × 110…), que fija el vano modular que la contiene, o **a medida**.
- **Pilares** de hormigón armado (20 a 40 cm) y **nombres de ambiente** que se ven en la planta. El nombre es libre y
  se le puede elegir un **tipo** (dormitorio, baño, cocina…); si no se elige, se deduce del nombre.
- **Terreno**: **zonas** rectangulares (pileta, patio o deck, jardín, camino) y **árboles** simples (tronco, copa y
  sombra, en tres tamaños). Sirven para pensar la disposición del espacio; no entran al cómputo ni a la Revisión.
- **Muebles simples** como gabarito de tamaño real (camas, placard, mesas con sillas, sillones, mesadas, artefactos de
  baño…): rectángulos con su nombre en la planta y cajas bajas en la isométrica. Sirven para ver si un ambiente
  alcanza; no entran al cómputo. Los muebles y los árboles se **apagan** con un interruptor: dejan de verse y sus
  herramientas salen de la barra.
- **Dos niveles + techo**: Nivel 1, Nivel 2 (con piso: losa de hormigón o entrepiso de madera) y pestaña Techo.
- **Escaleras**: recta, en L y en U, con ancho, huella y giro; abren el hueco en el piso de arriba.
- **Techos** rectangulares a dos aguas o a un agua, que se apoyan solos en los muros, se cruzan y se cortan entre sí
  (limahoya); alero, pendiente, cabios y hastiales de bloque despiezados.
- **Imán y guías** al dibujar, mover muros arrastrando (el resto se estira), selección múltiple con rectángulo y
  movimiento en grupo, deshacer y rehacer ilimitado, guía «Próximo paso».
- **Medidas exactas**: la cota se ve mientras se dibuja; en un muro se puede **escribir el largo** y Enter; el ancho y
  el fondo de una habitación se escriben en el panel; la herramienta **Medir** da la distancia entre dos puntos,
  también entre caras de muros (luz libre).
- **Copiar y pegar** (`Ctrl+C` / `Ctrl+V`, `Ctrl+D` duplica): un elemento o un grupo, también de un nivel al otro para
  repetir la planta arriba.
- **Terreno** configurable (hasta 100 m por lado), norte que se orienta con una brújula, ciudad y huso horario.

### 3.2 Entender (vistas y revisión)

- **Isométrica** (4 esquinas) y **planta cenital**; «ver adentro» baja la altura visible de los muros.
- **Sol y sombras** según latitud, época y hora; trayectoria solar; **luz natural por habitación** (referencia 1/8 del
  piso), vidrio por orientación y **sugerencia de ventanas por el sol** (ganancia de invierno y ventilación cruzada).
- **Revisión constructiva** en vivo, con errores, advertencias e información, cada una vinculada al elemento que la
  causa: jambas de 25 cm, 60 % de vanos en muros portantes, luces de dintel, esbeltez, apoyos del Nivel 2 y de
  pilares, luces de losa y de madera. Los techos se dibujan para ver la casa completa y computar la madera: no generan observaciones.
- **Recomendaciones por tipo de ambiente**: estar, comedor, dormitorio o escritorio sin ventana (advertencia); baño,
  cocina o lavadero sin ventilación y superficie por debajo de la referencia (nota). Son recomendaciones, no normativa.
- **Resumen y panel contextual**: lo que se muestra cambia según la herramienta o el elemento elegido; incluye los
  **m² útiles por tipo de ambiente**.

### 3.3 Calcular (cómputo)

- **Despiece hilada por hilada** con trabas y encuentros alternados; **bloques U** en dinteles y corona; anclajes en T y
  cruz.
- **Cortes optimizados**: los sobrantes se reutilizan; el descarte de las plantillas queda por debajo del 4 %.
- **Cómputo completo**: bloques y pallets por espesor, adhesivo y mortero de nivelación, hormigón y hierro de bloques U y
  de pilares, madera (tirantes, cenefa, OSB, cabios), losas, escaleras y techo.
- **Presupuesto de referencia** con precios editables; exportación **CSV** y **PDF** vectorial con la planta; envío a un
  distribuidor por correo o WhatsApp.
- **Calculadora rápida de paño** y **catálogo técnico** de piezas con reglas de colocación.
- **Dos sistemas de bloque**: Lika 50 × 25 cm (por defecto) y genérico 62,5 × 25 cm, configurables por variable.

### 3.4 Conversar (asistente de IA)

- **Formulario inicial de 6 preguntas que no usa modelo**: la primera casa sale en menos de 1 s.
- **Ajustes por chat** («sumá un dormitorio», «más luz en el estar»): un modelo liviano conversa y un modelo pesado
  construye; cada cambio es un paso que se puede deshacer.
- **Generador determinista**: mismo programa, misma casa; siempre sin errores o rechazado con un motivo claro.
- **Ve lo que se cambió a mano**: con cada mensaje viaja el proyecto del editor. Se puede partir de una plantilla
  («✦ Modificar con IA»).
- **Calca un plano**: se adjunta la imagen de un plano con el clip del chat (JPG, PNG o WebP) y arma esa casa con sus
  ambientes, medidas y aberturas. Es un punto de partida: un plano simple sale casi exacto; uno complejo o de dos
  plantas queda aproximado. No calca la escalera ni el techo de plantas que no son un rectángulo.
- **Límites de uso** por IP y por día; sin la clave del modelo, el asistente directamente no aparece.

### 3.5 Guardar y compartir

- El proyecto vive en el **navegador** y se **descarga y abre como `.json`**; sin cuenta ni instalación.
- **Mis casas**: «Guardar» en el editor deja la casa en el servidor (hasta 30 por navegador, 1 año desde el último
  uso), sin cuenta: se reconoce al navegador por un id aleatorio y sólo él las ve (en la Galería), las abre y las
  borra. Es un guardado privado; para mostrarle la casa a otra persona está «Compartir».
- **Galería** con 3 plantillas calculadas por el mismo motor (casa en L, vivienda evolutiva, dos plantas con garaje y
  alfresco) más los modelos que se agreguen por la API, con miniaturas de planta e isométrica.
- **API de administración** con token para que otra herramienta (por ejemplo Claude Code) cree, edite y borre modelos
  de la Galería disponibles para todos.
- **Enlace para compartir editable**: «Compartir» guarda la casa en el servidor y da un enlace; quien lo abre la ve
  y la edita, y los cambios se guardan solos en el enlace (gana lo último guardado; vence a los 180 días sin cambios).
- **Planos en PDF** (`/planos`): portada con la isométrica, una planta por nivel, la planta de techos, un alzado por
  muro hilada por hilada (cada corte con su medida y el hastial encima) y la lista de materiales.
- **Colores** en un solo archivo (`assets/styles/tema.css`) y diseño que se adapta al celular, donde el editor es
  **de sólo lectura**.

## 4. Lo que no hay

### 4.1 A propósito (parte de la propuesta)

| No hay | Por qué |
| --- | --- |
| Texturas, materiales de terminación y muebles de catálogo | No cambian el cómputo de mampostería; agregan peso y distraen. Los **muebles simples como gabarito** (camas, mesas, mesadas, artefactos de baño) sí existen: sirven para validar medidas, no para decorar. |
| Render fotorrealista y recorrido virtual | El dibujo es esquemático para entender la casa, no para venderla. |
| Cortes y planos de taller completos | Los planos son de obra gruesa (plantas, techos, alzados con despiece); no documentan instalaciones ni detalles. |
| Muros curvos o diagonales, retículas libres | Todo el motor (trabas, cortes, jambas) depende de muros a 90° sobre la retícula del bloque. |
| Más de 2 plantas con muros portantes | Es el límite autoportante del sistema (PB + PA ≤ 6 m). |
| Cálculo estructural, sísmico y térmico detallado | Se predimensiona y se avisa; el cálculo es de un profesional. |
| Instalaciones (agua, gas, electricidad) | Fuera del foco de mampostería; ni siquiera un cómputo grueso (sería de precisión muy baja). |
| Otros sistemas constructivos y marcas | El producto es para bloques HCCA Lika; el motor aísla los datos del bloque, pero sin datos reales de fabricantes no se suman. |
| Terreno en pendiente y retiros | El terreno es un rectángulo plano: la pendiente toca cimientos, que están fuera del cómputo. |
| Edición desde el celular | En pantallas chicas el editor es de sólo lectura; dibujar con el dedo no justifica la complejidad. |
| Cuentas y trabajo en equipo con permisos | Cero fricción de entrada: el enlace compartido es la credencial, «Mis casas» se reconoce por el navegador y el `.json` sigue sirviendo de respaldo. |
| Precios reales, stock y flete de distribuidores | Los precios son de referencia y editables; cada distribuidor cotiza lo suyo. |

### 4.2 Todavía no (ver [BACKLOG.md](BACKLOG.md))

- Reglas de circulación por tipo de ambiente (dormitorio de paso, baño que abre a la cocina).
- Que la Revisión use los muebles (paso libre, puertas que los pisan) y que el asistente los coloque.
- Vigas libres, techo a cuatro aguas o de forma libre, balcones y voladizos.
- Cotas internas y fachadas en los planos; el plano como fondo en la planta para corregir el calcado a mano; adjuntar
  un PDF al asistente.
- **Mano de obra**: jornales, plazo y costo por rubro (hoy el presupuesto es sólo de materiales).
- **Losas y entrepisos**: viguetas, paneles, voladizos, doble altura y cubierta plana (hoy, losa maciza o madera).
- Comparar dos casas guardadas lado a lado.
- El asistente con todas las operaciones del editor (pilares, nombres, aberturas).

## 5. Cuándo conviene y cuándo no

| Conviene si… | No conviene si… |
| --- | --- |
| Querés saber **cuánto material comprar** para una casa de bloques HCCA, con pocos datos de entrada. | Necesitás **planos de obra** o documentación para presentar ante un municipio. |
| Estás evaluando **alternativas rápidas** (¿2 o 3 dormitorios? ¿1 o 2 plantas?) y ver el costo de cada una. | Querés **ambientar, amoblar o renderizar** una casa para mostrarla. |
| Sos autoconstructor, constructor chico o corralón que asesora y quiere un **pedido sin sobras ni faltantes**. | Tu casa tiene **formas curvas, muros diagonales o más de dos plantas portantes**. |
| Preferís **explicar lo que querés** antes que aprender un programa de dibujo. | Necesitás **trabajar en equipo** sobre el mismo proyecto o llevar historial en la nube. |

## 6. Límites numéricos

| Dimensión | Valor |
| --- | --- |
| Niveles con muros | 2 (más el techo); altura total ≤ 6,00 m |
| Retícula / bloque | 12,5 cm / 50 × 25 cm (Lika) o 62,5 × 25 cm (genérico) |
| Terreno | hasta 100 m por lado; la construcción hasta 112,5 m |
| Techos | hasta 20 por proyecto; rectangulares, a una o dos aguas |
| Escaleras | hasta 10 por nivel; recta, L o U |
| Pilares / nombres | hasta 40 por nivel cada uno |
| Zonas / árboles del terreno | hasta 30 zonas y 60 árboles |
| Pedidos al asistente | 6 llamadas por turno, 40 turnos por conversación, límites por IP y por día |
| Tamaño de proyecto | hasta 1,5 MB de JSON |
