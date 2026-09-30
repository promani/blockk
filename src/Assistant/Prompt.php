<?php

declare(strict_types=1);

namespace App\Assistant;

use App\Domain\Design\HouseEditor;
use App\Domain\Design\HouseGenerator;
use App\Domain\Hcca;

/** Instrucciones del asistente y definición de sus herramientas. */
final class Prompt
{
    /** @param array<string, string> $templates slug => nombre */
    public static function system(array $templates): string
    {
        $list = implode("\n", array_map(static fn (string $slug, string $name): string => "- {$slug}: {$name}", array_keys($templates), $templates));

        return <<<TXT
            Sos el asistente de diseño de Blockk Studio, una app para proyectar casas con bloques de hormigón celular (HCCA)
            sobre una grilla de 12,5 cm. Hablás en español rioplatense, con frases cortas y sin markdown pesado.

            Objetivo: entender qué casa quiere la persona y dejarle un proyecto construido que pueda abrir en el editor.

            Cómo trabajar:
            1. Hacé preguntas de opción múltiple con la herramienta `preguntar`, UNA por vez, con 2 a 6 opciones cortas.
               Usá `multiple: true` cuando tenga sentido elegir varias (por ejemplo, ambientes extra). La persona siempre
               puede escribir otra cosa, así que no agregues una opción «Otro».
            2. Lo esencial: cuántas plantas (1 o 2), cuántos dormitorios, cuántos baños, cocina integrada al estar o
               separada, extras (lavadero, escritorio, toilette, depósito) y techo (a dos aguas o a un agua). No hagas más
               de 5 preguntas antes de proponer una casa: para lo que no sepas usá valores razonables y decilo.
            3. Generá la casa con `generar_casa` pasando el programa completo. El estar-comedor va siempre en la planta
               baja; en 2 plantas la escalera la agrega el sistema.
            4. Después de cada casa, resumí en 1–2 frases lo que salió (ambientes, m² útiles, bloques) usando SOLO los
               números que devolvió la herramienta, y preguntá con `preguntar` cómo seguir (por ejemplo: «Me gusta, la
               abro en el editor», «Agregar un ambiente», «Cambiar el techo», «Pasarla a 2 plantas»).
            5. Para cambiar el programa (más o menos ambientes, plantas, techo) volvé a llamar a `generar_casa` con el
               programa entero modificado. Para cambios puntuales sobre una casa que no generaste vos (una plantilla o el
               proyecto de la persona) usá `ver_casa` para conocer los ids y después `editar_casa`.
            6. Si una herramienta devuelve observaciones de severidad «error», corregilas antes de dar la casa por buena.
            7. Si piden algo fuera de diseñar casas con este sistema, explicá amablemente que sólo podés ayudar con eso.

            Plantillas de la Galería que podés cargar con `cargar_plantilla`:
            {$list}
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
            self::fn('preguntar', 'Muestra una pregunta con opciones para que la persona elija. Termina tu turno: esperá la respuesta.', [
                'pregunta' => ['type' => 'string', 'description' => 'La pregunta, corta.'],
                'opciones' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 6, 'items' => ['type' => 'object', 'properties' => [
                    'id' => ['type' => 'string', 'description' => 'Identificador corto, sin espacios.'],
                    'texto' => ['type' => 'string', 'description' => 'Lo que ve la persona (máx. 6 palabras).'],
                    'detalle' => ['type' => 'string', 'description' => 'Aclaración opcional, una línea.'],
                ], 'required' => ['id', 'texto']]],
                'multiple' => ['type' => 'boolean', 'description' => 'true si se pueden elegir varias opciones.'],
            ], ['pregunta', 'opciones']),
            self::fn('generar_casa', 'Genera una casa completa y válida a partir del programa de ambientes. Devuelve el resumen (ambientes con nombre, m², bloques, costo) y las observaciones.', [
                'nombre' => ['type' => 'string', 'description' => 'Nombre corto del proyecto (opcional).'],
                'niveles' => ['type' => 'integer', 'enum' => [1, 2]],
                'techo' => ['type' => 'string', 'enum' => ['dos_aguas', 'un_agua']],
                'ambientes' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                    'tipo' => ['type' => 'string', 'enum' => $types, 'description' => 'estar_comedor_cocina = cocina integrada; si la cocina va aparte, usá estar_comedor + cocina.'],
                    'nivel' => ['type' => 'integer', 'enum' => [1, 2], 'description' => 'Planta (1 = baja). Por defecto 1.'],
                    'cantidad' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 8],
                    'm2' => ['type' => 'number', 'description' => 'Superficie deseada, opcional.'],
                ], 'required' => ['tipo']]],
            ], ['niveles', 'ambientes']),
            self::fn('editar_casa', 'Aplica cambios puntuales a la casa actual (ids y metros de ver_casa) y la vuelve a validar.', [
                'operaciones' => ['type' => 'array', 'minItems' => 1, 'items' => ['type' => 'object', 'properties' => [
                    'accion' => ['type' => 'string', 'enum' => HouseEditor::ACTIONS],
                    'muro' => ['type' => 'string', 'description' => 'agregar_vano / quitar_muro: id del muro.'],
                    'vano' => ['type' => 'string', 'description' => 'quitar_vano / cambiar_vano: id del vano.'],
                    'tipo' => ['type' => 'string', 'description' => 'Vanos: '.implode(', ', array_keys(Hcca::openingPresets())).'. Techo: dos_aguas o un_agua.'],
                    'desde' => ['type' => 'number', 'description' => 'agregar_vano: metros desde el inicio del muro (si falta, se centra).'],
                    'nivel' => ['type' => 'integer', 'enum' => [1, 2]],
                    'x1' => ['type' => 'number'], 'y1' => ['type' => 'number'], 'x2' => ['type' => 'number'], 'y2' => ['type' => 'number'],
                    'espesorCm' => ['type' => 'number', 'enum' => Hcca::THICKNESSES_CM],
                    'pendiente' => ['type' => 'integer', 'description' => 'cambiar_techo: pendiente en %.'],
                    'nombre' => ['type' => 'string', 'description' => 'renombrar'],
                ], 'required' => ['accion']]],
            ], ['operaciones']),
            self::fn('cargar_plantilla', 'Carga una plantilla de la Galería como casa actual.', [
                'slug' => ['type' => 'string', 'enum' => $templateSlugs],
            ], ['slug']),
            self::fn('ver_casa', 'Describe la casa actual: ambientes, muros y vanos con ids y medidas en metros, techos y observaciones.', [], []),
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
