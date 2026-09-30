<?php

declare(strict_types=1);

namespace App\Assistant;

use App\Domain\Design\HouseEditor;
use App\Domain\Design\HouseGenerator;
use App\Domain\Hcca;

/** Instrucciones del asistente y definición de sus herramientas. */
final class Prompt
{
    /**
     * @param array<string, string>     $templates slug => nombre
     * @param array<string, mixed>|null $house     resumen de la casa actual (con `programa` si la generó el sistema)
     */
    public static function system(array $templates, string $mode, ?array $house): string
    {
        $list = implode("\n", array_map(static fn (string $slug, string $name): string => "- {$slug}: {$name}", array_keys($templates), $templates));
        $modeText = 'editor' === $mode
            ? <<<TXT
                MODO EDITOR: la persona está en el editor mirando su casa y te pide cambios desde un diálogo. Si el pedido
                es claro, hacelo directamente sin preguntar. Preguntá sólo si es ambiguo (por ejemplo «agrandala» sin decir
                qué). Los cambios se aplican solos al editor y se pueden deshacer. No rehagas la casa entera con
                `generar_casa` salvo que la persona lo pida o lo acepte: preferí `editar_casa`.
                TXT
            : <<<TXT
                MODO GALERÍA: la persona arma una casa paso a paso. Si describe lo que quiere en texto libre y alcanza para
                armarla, generala directamente; si faltan datos importantes, preguntalos TODOS juntos en un solo `preguntar`.
                TXT;
        $context = null === $house
            ? 'Todavía no hay casa.'
            : "Casa actual (ya cargada, NO la vuelvas a cargar):\n".json_encode($house, JSON_UNESCAPED_UNICODE);

        return <<<TXT
            Sos el asistente de diseño de Blockk Studio: casas de bloques de hormigón celular sobre una grilla de 12,5 cm.
            Hablás en español rioplatense, breve y sin markdown.

            {$modeText}

            Reglas:
            - Preguntas: con `preguntar`, que acepta VARIAS preguntas a la vez (se muestran una debajo de la otra). Nunca
              preguntes de a una si necesitás varias cosas. Opciones cortas; la persona siempre puede escribir otra cosa,
              así que no agregues «Otro». No preguntes «¿cómo seguimos?» ni ofrezcas «abrir en el editor»: la interfaz
              ya muestra la casa, sus números, sugerencias y el botón para abrirla.
            - Casas: `generar_casa` arma una casa completa desde el programa (estar-comedor siempre en planta baja; en 2
              plantas la escalera la pone el sistema). Para cambiar el programa (ambientes, plantas, techo) volvé a llamarla
              con el programa ENTERO modificado; si la casa actual tiene `programa`, partí de ese. Si no lo tiene (plantilla o
              casa dibujada a mano) y hay que agregar ambientes, generá una nueva parecida y avisá que se rearma.
            - Cambios puntuales: `editar_casa`. Para ventanas usá `agregar_ventana` con el id del ambiente (N1-A2) y,
              si importa, la orientación (N, E, S, O); no hace falta `ver_casa`. Usá `ver_casa` sólo si necesitás ids de
              muros o vanos.
            - Si el coordinador te delegó instrucciones (herramienta `delegar`), ejecutalas: no vuelvas a preguntar lo que
              ya está respondido. No uses `delegar`.
            - Podés llamar varias herramientas en la misma respuesta. Si asumiste algo, decilo en una frase en ese mismo
              mensaje. No anuncies el resultado («hecho», «listo») antes de que la herramienta responda. No repitas
              números de la casa: ya se ven en pantalla.
            - Si una herramienta devuelve un error o la casa tiene observaciones de severidad «error», corregilo.
            - Fuera de diseñar casas con este sistema, explicá amablemente que sólo podés ayudar con eso.

            {$context}

            Plantillas de la Galería (`cargar_plantilla`):
            {$list}
            TXT;
    }

    /**
     * Instrucciones del coordinador (modelo liviano): entiende el pedido, pregunta si hace falta y delega la
     * construcción al modelo pesado.
     *
     * @param array<string, mixed>|null $house
     */
    public static function coordinator(string $mode, ?array $house): string
    {
        $context = null === $house ? 'Todavía no hay casa.' : "Casa actual:\n".json_encode($house, JSON_UNESCAPED_UNICODE);
        $modeText = 'editor' === $mode
            ? 'La persona está en el editor y pide cambios sobre su casa. Si el pedido es claro, delegalo enseguida; preguntá sólo si es ambiguo.'
            : 'La persona arma una casa en la Galería. Si su descripción alcanza para armarla, delegá; si faltan datos importantes, preguntalos TODOS juntos.';

        return <<<TXT
            Sos el coordinador del asistente de diseño de Blockk Studio (casas de bloques de hormigón celular). Hablás en
            español rioplatense, breve y sin markdown. {$modeText}

            Tu trabajo NO es armar la casa: es entender qué quiere la persona.
            - Si falta información importante o el pedido es ambiguo, usá `preguntar` con todas las preguntas juntas
              (una debajo de la otra), opciones cortas y sin «Otro».
            - Cuando ya tenés todas las órdenes, llamá a `delegar` con instrucciones completas y concretas para el
              constructor (qué ambientes, plantas, techo, qué cambiar y dónde). No uses otras herramientas.
            - Para charla o preguntas sobre el sistema, respondé en texto, en una o dos frases.
            - Fuera de diseñar casas con este sistema, explicá amablemente que sólo podés ayudar con eso.
            - No preguntes «¿cómo seguimos?»: la interfaz ya muestra la casa y sugerencias.

            Tipos de ambiente que el constructor sabe armar: estar, comedor, estar_comedor, estar_comedor_cocina, cocina,
            dormitorio, dormitorio_principal, escritorio, bano, toilette, lavadero, deposito, libre. Hasta 2 plantas.
            Puede agregar o quitar ventanas y puertas, muros, cambiar el techo (dos aguas o un agua) y renombrar.

            {$context}
            TXT;
    }

    /**
     * @param list<string> $templateSlugs
     *
     * @return list<array<string, mixed>>
     */
    public static function tools(array $templateSlugs): array
    {
        $types = [...HouseGenerator::LIVING_TYPES, ...array_keys(HouseGenerator::TYPES)];

        return [
            self::fn('preguntar', 'Muestra una o varias preguntas con opciones (una debajo de la otra). Termina tu turno hasta que la persona responda.', [
                'preguntas' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => ['type' => 'object', 'properties' => [
                    'id' => ['type' => 'string', 'description' => 'Identificador corto.'],
                    'pregunta' => ['type' => 'string', 'description' => 'La pregunta, corta.'],
                    'multiple' => ['type' => 'boolean', 'description' => 'true si se pueden elegir varias opciones.'],
                    'opciones' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 6, 'items' => ['type' => 'object', 'properties' => [
                        'id' => ['type' => 'string'],
                        'texto' => ['type' => 'string', 'description' => 'Máx. 5 palabras.'],
                    ], 'required' => ['id', 'texto']]],
                ], 'required' => ['id', 'pregunta', 'opciones']]],
            ], ['preguntas']),
            self::fn('generar_casa', 'Genera una casa completa y válida desde el programa de ambientes y la deja como casa actual.', [
                'nombre' => ['type' => 'string', 'description' => 'Nombre corto (opcional).'],
                'niveles' => ['type' => 'integer', 'enum' => [1, 2]],
                'techo' => ['type' => 'string', 'enum' => ['dos_aguas', 'un_agua']],
                'ambientes' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                    'tipo' => ['type' => 'string', 'enum' => $types, 'description' => 'estar_comedor_cocina = cocina integrada; cocina aparte = estar_comedor + cocina.'],
                    'nivel' => ['type' => 'integer', 'enum' => [1, 2], 'description' => 'Planta (1 = baja). Por defecto 1.'],
                    'cantidad' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 8],
                    'm2' => ['type' => 'number', 'description' => 'Superficie deseada (opcional).'],
                ], 'required' => ['tipo']]],
            ], ['niveles', 'ambientes']),
            self::fn('editar_casa', 'Cambios puntuales a la casa actual; se valida con el motor completo.', [
                'operaciones' => ['type' => 'array', 'minItems' => 1, 'items' => ['type' => 'object', 'properties' => [
                    'accion' => ['type' => 'string', 'enum' => HouseEditor::ACTIONS],
                    'ambiente' => ['type' => 'string', 'description' => 'agregar_ventana: id del ambiente (N1-A2).'],
                    'orientacion' => ['type' => 'string', 'enum' => ['N', 'E', 'S', 'O'], 'description' => 'agregar_ventana (opcional).'],
                    'muro' => ['type' => 'string', 'description' => 'agregar_vano / quitar_muro: id del muro (de ver_casa).'],
                    'vano' => ['type' => 'string', 'description' => 'quitar_vano / cambiar_vano: id del vano.'],
                    'tipo' => ['type' => 'string', 'description' => 'Vanos: '.implode(', ', array_keys(Hcca::openingPresets())).' (VG150 = ventanal hasta el piso). Techo: dos_aguas o un_agua.'],
                    'desde' => ['type' => 'number', 'description' => 'agregar_vano: metros desde el inicio del muro (si falta, se centra).'],
                    'nivel' => ['type' => 'integer', 'enum' => [1, 2]],
                    'x1' => ['type' => 'number'], 'y1' => ['type' => 'number'], 'x2' => ['type' => 'number'], 'y2' => ['type' => 'number'],
                    'espesorCm' => ['type' => 'number', 'enum' => Hcca::THICKNESSES_CM],
                    'pendiente' => ['type' => 'integer', 'description' => 'cambiar_techo: pendiente en %.'],
                    'nombre' => ['type' => 'string', 'description' => 'renombrar'],
                ], 'required' => ['accion']]],
            ], ['operaciones']),
            self::fn('cargar_plantilla', 'Reemplaza la casa actual por una plantilla de la Galería.', [
                'slug' => ['type' => 'string', 'enum' => $templateSlugs],
            ], ['slug']),
            self::fn('ver_casa', 'Muros y vanos de la casa actual con ids y medidas en metros (para editar_casa).', [], []),
            self::fn('delegar', 'Sólo el coordinador: pasa al constructor las instrucciones completas para armar o cambiar la casa.', [
                'instrucciones' => ['type' => 'string', 'description' => 'Qué hacer, con todos los datos que dio la persona.'],
            ], ['instrucciones']),
        ];
    }

    /**
     * @param array<string, mixed> $properties
     * @param list<string>         $required
     *
     * @return array<string, mixed>
     */
    private static function fn(string $name, string $description, array $properties, array $required): array
    {
        return ['type' => 'function', 'function' => ['name' => $name, 'description' => $description, 'parameters' => [
            'type' => 'object', 'properties' => (object) $properties, 'required' => $required,
        ]]];
    }
}
