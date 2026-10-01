# Asistente de IA

El asistente arma o modifica casas conversando. Principio de diseño: **la IA no dibuja**. Conversa, pregunta lo que
falta y llama herramientas; el código construye y el motor valida. Toda casa que muestra la IA pasa por la misma
Revisión que una dibujada a mano.

## Dónde aparece

- **Galería → «✦ Diseñá tu casa con IA → Empezar»**: un diálogo por pasos (*Tu casa · Propuesta · Ajustes*).
  1. *Tu casa*: formulario fijo con 6 preguntas (plantas, dormitorios, baños, cocina, extras, techo). **No llama a
     ningún modelo**: las respuestas se traducen a un programa (`Wizard::program`) y la primera casa sale en < 1 s. Si
     en vez de responder la persona escribe («somos una familia de 5»), va al modelo.
  2. *Propuesta*: tarjeta con planta, m², plantas, bloques, costo, ambientes y estado de la Revisión; sugerencias
     rápidas y «Abrir en el editor».
  3. *Ajustes*: cada pedido es una vuelta al modelo.
- **Galería → «✦ Modificar con IA»** en cada plantilla: arranca con la plantilla cargada, sin llamar al modelo.
- Antes de empezar, si el editor tiene un proyecto con muros, se pide confirmación porque se va a reemplazar.
- **Editor → botón flotante «✦ IA»**: diálogo lateral para pedir cambios sobre la casa abierta. Si el pedido es claro
  actúa directo; si es ambiguo, pregunta. Cada casa que devuelve se aplica al editor como un paso de deshacer («Cambio
  del asistente») y la tarjeta ofrece «Deshacer este cambio». Con cada mensaje viaja el proyecto del editor, así la IA ve
  también lo que se cambió a mano.

## Preguntas

`preguntar` recibe **varias preguntas a la vez** y se muestran una debajo de la otra. Las de opción única se responden
con un clic (si todas son de opción única, se envía sola al completar la última); si hay alguna de opción múltiple,
aparece «Enviar». Siempre se puede escribir en lugar de elegir. Las preguntas ya respondidas se achican a una línea.

## Modelos

Kimi (Moonshot AI) por su API compatible con OpenAI (`KIMI_BASE_URL`, `KIMI_API_KEY`), con dos modelos:

| Variable | Rol |
| --- | --- |
| `KIMI_MODEL_LIGHT` | **Coordinador** (más barato). Arranca cada turno: responde charla, pregunta si falta información y, cuando tiene las órdenes, llama a `delegar` con instrucciones completas. |
| `KIMI_MODEL` | **Constructor**. Recibe la delegación y llama `generar_casa` / `editar_casa` / `cargar_plantilla` / `ver_casa`. |

Si el coordinador intenta construir directamente, esa llamada no se ejecuta y se delega. Sin `KIMI_MODEL_LIGHT`, todo lo
hace `KIMI_MODEL`. Los tests fuerzan modelos falsos (`phpunit.dist.xml`) para no usar credenciales reales.

## Herramientas

| Herramienta | Qué hace |
| --- | --- |
| `preguntar` | Formulario de 1 a 6 preguntas con opciones. Termina el turno. |
| `delegar` | Sólo el coordinador: pasa instrucciones al constructor. |
| `generar_casa` | Programa (`niveles`, `techo`, `ambientes[{tipo, nivel, cantidad, m2}]`) → casa completa con `HouseGenerator`. |
| `editar_casa` | Operaciones con `HouseEditor`: `agregar_ventana` (por ambiente `N1-A2` y orientación), `agregar_vano`, `quitar_vano`, `cambiar_vano`, `agregar_muro`, `quitar_muro`, `cambiar_techo`, `renombrar`. |
| `cargar_plantilla` | Reemplaza la casa por una plantilla de la Galería. |
| `ver_casa` | Muros y vanos con ids y medidas en metros (sólo si hacen falta ids). |

El modelo recibe en el prompt de sistema la **casa actual** (ambientes con id y nombre, m², techo, observaciones y, si la
generó el sistema, su **programa**), así la mayoría de los pedidos se resuelven en una sola llamada. Cuando una
herramienta deja la casa **sin errores**, el turno termina sin otra vuelta al modelo (la tarjeta ya muestra los números).

### El generador (`src/Domain/Design/HouseGenerator.php`)

Planta en «tira», determinista (mismo programa → misma casa): bloque social a la izquierda (estar-comedor, con la
escalera en U si hay 2 plantas), pasillo central y dos bandas: dormitorios al norte (sol de invierno) y servicios al
sur. En 2 plantas el Nivel 2 repite el esqueleto (muros exteriores sobre exteriores) y el piso es una losa por ambiente.
Elige la sección de cabio que cubre la luz; a un agua, dos faldones sobre un muro portante. Ventanas y puertas siempre
con jambas de 25 cm y sin pasar el 60 % de vanos de un muro portante. Probado con cientos de programas al azar: o sale
sin errores ni advertencias, o se rechaza con un motivo («quedaría de 23 m de largo…»).

## Flujo de un turno

`Assistant::reply` → (formulario inicial: programa directo, sin modelo) → coordinador → `delegar` → constructor →
herramientas → eventos. Límites: 6 llamadas por turno, 40 turnos por conversación, `ASSISTANT_HOURLY_LIMIT` por IP y
`ASSISTANT_DAILY_LIMIT` por día. Eventos para la interfaz: `usuario`, `asistente`, `pregunta {preguntas}`,
`casa {diseno, version, nombre, svg, resumen}`, `error`.

## Diagnóstico y problemas típicos

Cada llamada al modelo deja una línea en el log del contenedor (en Dokploy, «ver logs»):

```
[asistente] conv=3dd61a77 modo=galeria turno=2 paso=1 modelo=liviano 3.1s → delegar
[asistente] conv=3dd61a77 modo=galeria turno=2 paso=2 modelo=pesado 9.4s → generar_casa
```

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| «El asistente no está disponible» | Clave inválida, modelo inexistente o sin tool calling, endpoint caído. El log dice `ERROR El modelo X respondió 401/404…`. | Revisar `KIMI_API_KEY`, `KIMI_MODEL`, `KIMI_MODEL_LIGHT`. |
| La tarjeta de IA no aparece en la Galería | Falta `KIMI_API_KEY` o `KIMI_MODEL` (o el servidor no ve las variables; con `php -S` usar `-d variables_order=EGPCS`). | `GET /api/assistant/status` debe decir `enabled: true`. |
| «Se alcanzó el límite de uso» | Límite por IP u horario. | Subir `ASSISTANT_HOURLY_LIMIT`/`ASSISTANT_DAILY_LIMIT` o esperar. |
| Muchas vueltas / respuestas lentas (> 30 s) | El modelo pide `ver_casa` o encadena herramientas; modelos con razonamiento largo. | Mirar el log por paso; ajustar `Prompt.php`; usar un `KIMI_MODEL_LIGHT` rápido. |
| Rehízo la casa entera en el editor | Usó `generar_casa` sobre una casa sin programa. | Ya está prohibido en el prompt del editor y el error de `editar_casa` le avisa si no hay programa; se deshace con «Deshacer este cambio». |
| «A un agua no se puede» | Ningún cabio cubre el fondo y no hay muro portante interior. | Dejar a dos aguas o regenerar con `techo: un_agua` (el generador agrega el muro). |
| Advertencias de vanos (`opening.pier`, `opening.ratio`) | Ventanas pedidas por muro/posición. | Preferir `agregar_ventana` por ambiente, que ya respeta jambas y el 60 %. |
| Dice que un error «ya venía» | Alucinación del modelo. | El prompt lo prohíbe; la Revisión de la tarjeta muestra la verdad. |

## Probar

- **Unitario**: `tests/Assistant/*` con un modelo guionado (`tests/Support/ScriptedLlm.php`) y `KimiMock` para la API.
- **De punta a punta**: la skill `verificar` levanta `kimi-falso.cjs` (imita a Kimi, distingue liviano y pesado, y
  cuenta llamadas en `GET /__log`) y una instancia de la app en el puerto 8091, y recorre Galería y editor en Chromium.
- **Contra el Kimi real**: desde un entorno que llegue a la app desplegada, conversar con su API
  (`POST /api/assistant/conversations` y `/messages` con un `client` hexadecimal de 24 caracteres) y mirar tiempos y
  herramientas en el log.

## Código

`src/Assistant/`: `Assistant.php` (orquestador), `Prompt.php` (instrucciones y herramientas), `Wizard.php`
(formulario inicial y su programa), `KimiClient.php` / `LlmClient.php`, `Conversations.php` + `Store/` (Redis o
archivos). `src/Domain/Design/`: `HouseGenerator`, `HouseEditor`, `HouseDescriber`. Front: `assets/lib/ai-chat.js`
(componente compartido), `assets/gallery/assistant.js`, `assets/editor/ai.js`.
