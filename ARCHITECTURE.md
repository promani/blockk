# Arquitectura — Blockk Studio

## Arquitectura

Una aplicación Symfony monolítica y sin estado para el cálculo, con el editor en el navegador. **El motor de cálculo es
la única fuente de las reglas constructivas y vive en PHP** (`src/Domain`, sin dependencias del framework): el cliente
dibuja y arma intenciones («agregar un muro»), el servidor normaliza, valida y calcula, y el cliente reemplaza su estado
con la respuesta. El asistente de IA es una capa aparte (`src/Assistant`) que usa ese mismo motor como herramienta.

## Componentes

| Componente | Qué hace | Dónde |
| --- | --- | --- |
| Editor (navegador) | Herramientas, cámara isométrica/planta, render Canvas 2D por algoritmo del pintor, paneles, deshacer/rehacer, guardado en `localStorage` | `assets/editor/` |
| Cómputo, Galería, Catálogo | Páginas Twig + módulos ES: exportación CSV/PDF (generados en el navegador), plantillas, fichas | `templates/`, `assets/{bom,gallery,catalog}/` |
| API de cálculo | `POST /api/analyze` y afines; sin estado | `src/Controller/Api/ProjectApiController.php` |
| Motor (dominio) | Normalización, topología, ambientes, hiladas, cortes, losas, escaleras, techos, cómputo, validación, sol | `src/Domain/` |
| Generador y editor de casas | Programa de ambientes → casa válida; operaciones puntuales sobre un proyecto; calcado de un plano desde sus ambientes | `src/Domain/Design/` |
| Mis casas | Casas guardadas por navegador, privadas (el enlace para compartir es aparte: `src/Share/`) | `src/Houses/`, `src/Controller/Api/HousesController.php`, `assets/lib/houses.js`, `assets/editor/houses.js`, `assets/gallery/houses.js` |
| Asistente de IA | Conversación, herramientas, dos modelos (liviano/pesado), persistencia, límites | `src/Assistant/`, `src/Controller/Api/AssistantController.php`, `assets/lib/ai-chat.js` |
| Kimi (externo) | LLM por API compatible con OpenAI | `KIMI_*` |
| Redis (lab) | Conversaciones, diseños por navegador y contadores de uso | `REDIS_URL` |

## Diagrama

```mermaid
graph TD
    Usuario[Navegador: editor, galería, cómputo] -->|POST /api/analyze| API[API de cálculo]
    Usuario -->|/api/assistant/*| Asistente[Asistente de IA]
    API --> Motor[Motor HCCA - src/Domain]
    Asistente --> Motor
    Asistente --> Generador[HouseGenerator / HouseEditor]
    Generador --> Motor
    Asistente -->|chat/completions| Kimi[Kimi API]
    Asistente -->|conversaciones, diseños, límites| Redis[(central-redis)]
```

Pipeline del análisis (`ProjectAnalyzer`):

```mermaid
graph LR
    F[ProjectFactory<br/>valida e hidrata] --> N[WallNormalizer<br/>T, cruces, fusiones]
    N --> T[Topology<br/>nodos y encuentros]
    T --> R[RegionAnalyzer<br/>ambientes]
    R --> C[CourseBuilder<br/>hiladas, trabas, U]
    C --> K[StockPacker + CutPlanner<br/>cortes]
    K --> P[Slab / Stair / Roof planners]
    P --> B[BomCalculator<br/>cómputo y precios]
    B --> V[ProjectValidator<br/>observaciones]
```

Un turno del asistente:

```mermaid
sequenceDiagram
    participant U as Persona
    participant A as Assistant
    participant L as Modelo liviano
    participant H as Modelo pesado
    participant G as Generador + motor
    U->>A: mensaje (texto o respuestas del formulario)
    alt formulario inicial de la Galería
        A->>G: programa → generar_casa (sin modelo)
    else texto libre o ajuste
        A->>L: historia + casa actual
        L-->>A: preguntar (termina el turno) o delegar
        A->>H: historia + instrucciones
        H-->>A: generar_casa / editar_casa
        A->>G: construir y validar
    end
    A-->>U: eventos (pregunta, casa, texto)
```

## Datos

- **Proyecto** (`v1`, JSON): `{name, north, lat, lot:{w,d}, settings, upper, roofs:[…], levels:[{walls, openings,
  ubeams, slabs, stairs, columns, labels}, …]}` (las aberturas llevan `kind` puerta/ventana/portón y `mode`). Lo valida `ProjectFactory` (frontera de confianza: tipos, rangos, ids,
  espesores, presets y presupuestos de tamaño).
- **Unidades**: coordenadas del proyecto en unidades de **12,5 cm** (enteros); geometría interna en **ticks de 0,5 mm**
  (12,5 cm = 250 ticks), así no hay errores de coma flotante en trabas y remanentes.
- **Sistema de bloques**: `BLOCK_SYSTEM` (`lika` por defecto, o `generico`) elige largo, espesores, pallets, adhesivo y
  bloques U en `Hcca::SYSTEMS`; el motor usa `Hcca::blockL()` y compañía, nunca un largo fijo.
- **Asistente** (Redis, 60 días, claves con prefijo `blockk:`): `conv:{id}` (historia para el modelo, eventos para la
  interfaz, casa actual y su programa), `design:{id}`, contadores `rl:*`.
- **Proyectos compartidos** (Redis, 180 días desde el último cambio): `share:{id}` con `{project, version, updated}`;
  el id (32 hexadecimales al azar) es la credencial de lectura y escritura (`src/Share/SharedProjects.php`).
- **Mis casas** (Redis, 1 año desde el último uso): `house:{id}` `{id, client, name, project, summary, svg, created,
  updated}` e índice `houses:{client}` (hasta 30 por navegador); contadores `rl:houses:*`. Sin usuarios: `client` es el
  id aleatorio del navegador, nunca sale en una respuesta y sólo él puede leer, cambiar o borrar sus casas.
- **Traspaso de Mis casas** (Redis, 15 minutos, un solo uso): `transfer:{código}` con los ids a copiar; no guarda el
  navegador de origen.

## API

| Método y ruta | Descripción |
| --- | --- |
| `POST /api/analyze` | Proyecto → `{project (normalizado), analysis: {levels, floors, roof, bom, issues, telemetry}}`; `422` si es inválido. |
| `POST /api/suggest` | Sugerencias bioclimáticas de aberturas. |
| `GET /api/solar?lat=&season=` | Trayectoria solar (06:00–19:00 cada 15 min). |
| `GET /api/templates`, `GET /api/templates/{slug}` | Plantillas de la Galería. |
| `POST /api/thumbnail` | Miniatura SVG de un proyecto. |
| `GET /api/calc/panel?…` | Calculadora rápida de paño. |
| `GET /api/assistant/status` | ¿Está configurado el asistente? |
| `POST /api/assistant/conversations` | Nueva conversación `{client, modo, inicio:{tipo: nueva\|plantilla\|proyecto, …}, texto?, respuestas?, adjunto?}`. |
| `POST /api/assistant/conversations/{id}/messages` | Mensaje `{client, texto?, respuestas?, project?, adjunto?}`; `adjunto: {tipo, datos}` es la imagen de un plano en base64 para calcarlo. |
| `GET /api/assistant/conversations/{id}`, `GET /api/assistant/designs/{id}` | Retomar una conversación; casa de una conversación. |
| `POST /api/compartidos`, `GET/PUT /api/compartidos/{id}` | Enlaces para compartir editables: crear (`{project}` → `{id, version, url}`, 60 por hora por IP), leer y guardar (gana el último). |
| `GET /api/houses?client=` | «Mis casas»: las guardadas por ese navegador (id, name, summary, svg, created, updated). Nunca lista las de otros. |
| `POST /api/houses` | `{client, project, id?}`: crea (201) o actualiza la propia (200); `422` si el proyecto es inválido, `409` al pasar de 30. |
| `GET /api/houses/{id}?client=`, `DELETE /api/houses/{id}?client=` | Abrir o borrar una casa guardada: sólo el navegador que la guardó (para los demás, `404`). |
| `PATCH /api/houses/{id}` | `{client, name}`: renombra la propia; `404` si es ajena. |
| `POST /api/houses/transfer`, `POST /api/houses/transfer/{código}` | Llevar «Mis casas» a otro navegador: crea un código de un solo uso (`{client}` → `{codigo, casas, venceEn}`) y lo canjea (`{client}` → `{copiadas, omitidas}`; `404` si no existe, venció o ya se usó). |
| `GET /comparar?a=&b=` | Página que compara dos casas guardadas de ese navegador (las calcula con `/api/analyze`). |
| `GET /api/admin/ping`, `GET/POST /api/admin/galeria`, `GET/PUT/DELETE /api/admin/galeria/{slug}` | **API de administración de la Galería** (`Authorization: Bearer $ADMIN_API_TOKEN`; sin token configurado no existe). Crea, edita y borra modelos que ve todo el mundo en `/galeria` (guardados en Redis, clave `gallery:{slug}`, máx. 100). Cuerpo: `nombre`, `descripcion?`, `etiquetas?`, `slug?` y un dibujo: `programa` (generador), `plantilla` (clonar) o `project`; en `PUT` también `operaciones` sobre el actual. Las plantillas del código no se editan ni borran. |

## Decisiones y trade-offs

- **Reglas sólo en el servidor.** El cliente no duplica reglas: para validar en vivo (p. ej. dónde entra una puerta) el
  servidor devuelve los tramos libres de cada muro. Costo: una ida y vuelta por edición (~50 ms por análisis de una
  casa de 2 plantas).
- **Sin base de datos ni cuentas para el editor.** El proyecto vive en el navegador: cero cuentas y cero datos
  personales. A Redis va sólo lo que la persona pide: «Compartir» guarda la casa sin dueño (el enlace es la
  credencial, y quien lo tiene la edita) y «Guardar» la deja en «Mis casas», atada al id aleatorio del navegador y
  visible sólo para él. A cambio, «Mis casas» no pasa sola de un navegador a otro.
- **La IA no dibuja.** El modelo elige un programa o una operación y el código construye y valida; así toda casa que
  muestra la IA pasa la misma Revisión que una dibujada a mano. Costo: el generador sólo produce plantas en «tira».
- **Dos modelos.** Uno liviano (barato) coordina y pregunta; uno pesado arma el JSON y las acciones. El formulario
  inicial no usa ningún modelo (la primera casa sale en < 1 s).
- **Sin paso de build en el front** (AssetMapper + import maps nativos): menos herramientas; a cambio, sin TypeScript
  ni bundling. La única dependencia de front es pdf.js (`pdfjs-dist`, para adjuntar un PDF o usarlo de fondo): está en
  `importmap.php`, se baja a `assets/vendor/` con `php bin/console importmap:install` (lo corre `composer install`) y
  el navegador la carga sólo cuando llega un PDF. Sin CDN en tiempo de ejecución. Fijada en la 5.4: la 6.x usa
  `Map.getOrInsertComputed`, que muchos navegadores todavía no tienen (falla en Chromium 141).
- **Render propio en Canvas 2D** (algoritmo del pintor por capas con orden topológico) en lugar de WebGL: liviano y
  exacto para cajas alineadas; sostiene 60 FPS en casas de 2 plantas.

## Seguridad

Validación estricta en la frontera, límites de tamaño de cuerpo (1,5 MB), de muros y de complejidad; Twig con
autoescape y DOM sin `innerHTML` con datos del usuario (las miniaturas SVG del servidor se muestran como `<img>`); CSP
restrictiva sin CDN, `X-Frame-Options`, `nosniff`. El asistente no tiene login: cada navegador usa un id aleatorio y
sólo accede a lo suyo; hay límites por IP, por día y por conversación porque cada mensaje consume el modelo. Las
claves (`KIMI_API_KEY`, `LAB_MCP_TOKEN`) nunca se versionan.

## Pendiente

- Exponer valores referenciales (pallets, consumos, precios) por distribuidor.
- Generador con más tipologías (L, patio central).
- Streaming de respuestas del modelo para no esperar el turno completo.
