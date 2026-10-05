---
name: nueva-plantilla
description: Diseña una casa nueva para Blockk Studio y la agrega a la Galería como plantilla (TemplateCatalog.php), respetando la grilla modular de bloques HCCA y las reglas constructivas del validador. Usala cuando el usuario pida crear, dibujar o proponer una casa, un quincho o cualquier proyecto de ejemplo, o agregar una plantilla.
---

# Nueva plantilla de casa

Las plantillas viven en `src/Domain/Templates/TemplateCatalog.php` (método `definitions()`) y se arman con
`TemplateBuilder`. Aparecen solas en `/galeria` y en `GET /api/templates`.

Antes de dibujar, leé `docs/DESIGN.md` (zonas, circulación, orientación y **sentido de las puertas**: abren hacia adentro
del ambiente que sirven).

## Unidades y grilla

- **1 unidad = 12,5 cm.** Todas las coordenadas del builder son enteros en unidades: 8 u = 1 m, 40 u = 5 m.
- Un bloque Lika mide 50 cm (4 u) × 25 cm de alto (1 hilada) (con `BLOCK_SYSTEM=generico`, 62,5 cm = 5 u). Un muro
  normal tiene 12 hiladas (3 m).
- Medidas múltiplo de 4 u (50 cm) dan menos cortes; el test exige **descarte < 4 %**.
- Toda plantilla lleva **techo**; con dos plantas, además **escalera** (el piso del Nivel 2 es automático: cada
  habitación de arriba lleva su losa), y ninguna
  advertencia (`TemplateCatalogTest`). Un techo de la PB que choca contra un muro de la PA no lleva alero ni hastial
  de ese lado (lo resuelve el `RoofPlanner`).
- El terreno por defecto es de 24 × 20 m (192 × 160 u). El norte (`north = 0`) queda hacia arriba (y negativa) y
  la latitud por defecto es −34,6 (Buenos Aires): el sol viene del **norte**, así que el estar va al norte.

## API del builder

```php
(new TemplateBuilder('Nombre'))
    ->room($level, $x, $y, $w, $h, $t = 20)      // 4 muros perimetrales (nivel 0 = Nivel 1)
    ->wall($level, $x1, $y1, $x2, $y2, $t)        // muro suelto; tabiques de 10, portantes de 15 o 20
    ->opening($level, 'P87', 'x'|'y', $line, $start, flip: false, hingeEnd: false, mode: '')  // 'x' = muro horizontal en y=$line; $start = coordenada inicial;
                                                                  // flip: abre hacia arriba/izquierda; hingeEnd: bisagra en el extremo final; mode: swing|slide|fixed|overhead
    ->column($level, $x, $y, 25)                  // pilar de hormigón armado (20, 25, 30 o 40 cm), centrado en el nodo (x, y)
    ->label($level, $x, $y, 'Cocina')             // nombre del ambiente: celda dentro de él (se ve en la planta); varios en un espacio abierto
    ->shift($dx, $dy)                             // corre todo lo que sigue (deja lugar al norte, p. ej. para un alfresco)
    ->roofPart($level, $x, $y, $w, $h, 'gable'|'shed', 'x'|'y'|'N'|'S'|'E'|'W')
    ->slab($level, $x, $y, $w, $h)                // sólo balcón o terraza (piso extra fuera de las habitaciones del Nivel 2)
    ->stair($level, $x, $y, 'N')
    ->upper()                                     // habilita el Nivel 2
    ->build()
```

Vanos (`src/Domain/Hcca.php`, `openingPresets()`); `w` en unidades:

| Puertas | Ventanas |
| --- | --- |
| P75 (6), P87 (7), P100 (8), P150 doble (12) | V62 (5), V100 (8), V125 (10), V150 (12), V187 (15), VT62 ventiluz (5), VT100 (8), VG150 ventanal 150 × 200 (12) |

Los portones (`PG250`, `PG300`) superan los 2,00 m de luz y la Revisión los advierte (`opening.span`): una plantilla sin advertencias no los usa.
Nombrá todos los ambientes con `label()`.

Para un ala o un cuerpo pegado, no repitas el muro compartido: agregá sólo los muros nuevos (los colineales se unen
solos). Un vano se ubica en el tramo de muro que lo contiene; si no entra, el builder tira `LogicException`.

## Reglas que controla la Revisión (errores = la plantilla no pasa el test)

- **`opening.pier`**: cada vano a ≥ 25 cm de la esquina o de un muro transversal, medido desde la **cara** del muro
  que cruza. En la práctica: ≥ 3 u desde el eje de un muro de 20 cm y ≥ 2,5 u desde uno de 10 cm. Un tramo de muro
  entre dos cruces necesita el ancho del vano + ~6 u.
- **`opening.gap`**: dos vanos del mismo muro separados ≥ 25 cm (2 u).
- **`opening.height`**: el vano más el dintel U tiene que entrar en la altura del muro.
- **`opening.ratio`** (advertencia): en un muro portante, los vanos no pueden sumar más del 60 % del **tramo**
  (entre cruces), no del muro entero.
- **`opening.span`** (advertencia): vanos de más de 2,00 m.
- Con dos niveles: los muros portantes del Nivel 2 tienen que apoyar sobre portantes del Nivel 1 y los tabiques sobre
  la losa automática de una habitación de arriba (`support.*`).

Dejá la plantilla **sin errores ni advertencias**; una nota `info` (por ejemplo `roof.ridge`) es aceptable.

## Flujo

1. Esbozá la planta en unidades (ambientes, muros internos, vanos). Revisá la orientación: estar y dormitorios con
   ventanas al norte, baño con ventiluz.
2. Agregá la entrada en `definitions()` con `name`, `description`, `tags` (al menos `1 planta`/`2 plantas` y el tipo)
   y `build`. La etiqueta «Bajo descarte» se agrega sola.
3. Revisala y mirala con la skill `capturas`:
   ```bash
   .claude/skills/capturas/scripts/servidor.sh
   node .claude/skills/capturas/scripts/capturas.cjs --slug <slug> --out <scratchpad>/cap
   ```
   Corregí cada `issue` del JSON (trae el muro o vano al que apunta) hasta que no quede ninguno de severidad
   `error` o `warn`. Mirá las capturas: con techo y sin techo, al menos dos vistas.
4. Generá las miniaturas de la Galería (planta e isométrica, con Chromium): `COMPOSER_ALLOW_SUPERUSER=1 composer miniaturas`.
   Sólo dibuja las que faltan o cambiaron; `TemplateImagesTest` falla si quedaron viejas. Subí los `.webp` de
   `public/img/plantillas/`.
5. Corré la skill `verificar` (incluye `TemplateCatalogTest`) y recién ahí hacé commit.
6. Mostrale al usuario una o dos capturas y un resumen: ambientes, m² útiles, bloques, pallets y costo de referencia.
