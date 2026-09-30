<?php

declare(strict_types=1);

namespace App\Assistant;

/**
 * Primer paso del asistente de la Galería: un formulario fijo (no hace falta el modelo para saber qué preguntar) y
 * la traducción de sus respuestas a un programa para el generador. Así la primera casa sale al instante.
 */
final class Wizard
{
    public const string FORM_ID = 'programa';

    /** @return list<array<string, mixed>> */
    public static function questions(): array
    {
        $q = static fn (string $id, string $text, array $options, bool $multiple = false): array => [
            'id' => $id, 'pregunta' => $text, 'multiple' => $multiple,
            'opciones' => array_map(static fn (string $k, string $v): array => ['id' => $k, 'texto' => $v, 'detalle' => ''], array_keys($options), $options),
        ];

        return [
            $q('plantas', '¿Cuántas plantas?', ['1' => '1 planta', '2' => '2 plantas']),
            $q('dormitorios', '¿Cuántos dormitorios?', ['1' => '1', '2' => '2', '3' => '3', '4' => '4']),
            $q('banos', '¿Baños?', ['1' => '1 baño', '2' => '2 baños', 'bt' => 'Baño + toilette']),
            $q('cocina', '¿La cocina?', ['integrada' => 'Integrada al estar', 'separada' => 'Separada']),
            $q('extras', '¿Algo más? (opcional)', ['lavadero' => 'Lavadero', 'escritorio' => 'Escritorio', 'deposito' => 'Depósito'], true),
            $q('techo', '¿Techo?', ['dos_aguas' => 'A dos aguas', 'un_agua' => 'A un agua']),
        ];
    }

    /**
     * @param array<string, list<string>> $answers id de pregunta => ids elegidos
     *
     * @return array<string, mixed> programa para HouseGenerator
     */
    public static function program(array $answers): array
    {
        $one = static fn (string $k, string $default): string => (string) ($answers[$k][0] ?? $default);
        $levels = '2' === $one('plantas', '1') ? 2 : 1;
        $beds = max(1, min(4, (int) $one('dormitorios', '2')));
        $up = $levels; // en 2 plantas los dormitorios y el baño principal van arriba
        $rooms = [['tipo' => 'separada' === $one('cocina', 'integrada') ? 'estar_comedor' : 'estar_comedor_cocina']];
        if ('separada' === $one('cocina', 'integrada')) {
            $rooms[] = ['tipo' => 'cocina'];
        }
        if ($beds >= 2) {
            $rooms[] = ['tipo' => 'dormitorio_principal', 'nivel' => $up];
        }
        $rooms[] = ['tipo' => 'dormitorio', 'nivel' => $up, 'cantidad' => $beds >= 2 ? $beds - 1 : 1];
        $rooms[] = ['tipo' => 'bano', 'nivel' => $up];
        match ($one('banos', '1')) {
            '2' => $rooms[] = ['tipo' => 'bano', 'nivel' => 1],
            'bt' => $rooms[] = ['tipo' => 'toilette', 'nivel' => 1],
            default => null,
        };
        foreach ($answers['extras'] ?? [] as $extra) {
            if (in_array($extra, ['lavadero', 'escritorio', 'deposito'], true)) {
                $rooms[] = ['tipo' => $extra, 'nivel' => 1];
            }
        }

        return ['niveles' => $levels, 'techo' => 'un_agua' === $one('techo', 'dos_aguas') ? 'un_agua' : 'dos_aguas', 'ambientes' => $rooms];
    }
}
