<?php

declare(strict_types=1);

namespace App\Domain\Validation;

use App\Domain\Hcca;
use App\Domain\LevelAnalysis;
use App\Domain\Model\OpeningKind;

/**
 * Tipo de cada ambiente y recomendaciones de uso según el tipo (ventana, ventilación, superficie de referencia). El
 * tipo sale del nombre que se puso en el ambiente: el elegido o, si no se eligió, el que se deduce del texto.
 * Son recomendaciones, no normativa: avisan, no impiden.
 */
final class RoomReview
{
    /** @return array<int, string> id de ambiente => tipo (sólo los que tienen uno) */
    public function types(LevelAnalysis $l): array
    {
        $types = [];
        foreach ($l->level->labels as $label) {
            $room = $l->regions->roomAtCell($label->x, $label->y);
            $type = '' !== $label->type ? $label->type : Hcca::roomTypeOf($label->name);
            // en un espacio abierto con varios nombres (cocina + estar) manda el primero
            if ($room > 0 && null !== $type && !isset($types[$room])) {
                $types[$room] = $type;
            }
        }

        return $types;
    }

    /** @return list<Issue> */
    public function review(int $index, LevelAnalysis $l): array
    {
        $types = $this->types($l);
        if ([] === $types) {
            return [];
        }
        $catalog = Hcca::roomTypes();
        $windows = $this->roomsWithWindow($l);
        $issues = [];
        foreach ($l->regions->rooms as $room) {
            $spec = $catalog[$types[$room->id] ?? ''] ?? null;
            if (null === $spec) {
                continue;
            }
            // la observación apunta al nombre del ambiente: está siempre adentro, aunque la planta sea en L
            $label = array_find($l->level->labels, static fn ($lb): bool => $l->regions->roomAtCell($lb->x, $lb->y) === $room->id);
            $name = '' !== ($label?->name ?? '') ? $label->name : $spec['label'];
            $at = [$label->x, $label->y];
            if (null !== $spec['window'] && !isset($windows[$room->id])) {
                $issues[] = 'luz' === $spec['window']
                    ? new Issue(Issue::WARN, 'room.window', sprintf('«%s» no tiene ventana: conviene que tenga luz y ventilación natural.', $name), $index, null, $at[0], $at[1])
                    : new Issue(Issue::INFO, 'room.vent', sprintf('«%s» no tiene ventana: prever la ventilación (ventiluz o extractor).', $name), $index, null, $at[0], $at[1]);
            }
            if ($spec['minM2'] > 0 && $room->netM2 < $spec['minM2']) {
                $issues[] = new Issue(Issue::INFO, 'room.small', sprintf('«%s» mide %s m² útiles: la referencia para %s es de %s m² o más.', $name, $this->n($room->netM2), mb_strtolower($spec['label']), $this->n($spec['minM2'])), $index, null, $at[0], $at[1]);
            }
        }

        return $issues;
    }

    /**
     * Superficie útil por tipo de ambiente, de mayor a menor (los ambientes sin tipo van juntos al final).
     *
     * @param list<LevelAnalysis> $levels
     *
     * @return list<array{type: ?string, label: string, m2: float, rooms: int}>
     */
    public function areas(array $levels): array
    {
        $catalog = Hcca::roomTypes();
        $sum = [];
        foreach ($levels as $l) {
            $types = $this->types($l);
            foreach ($l->regions->rooms as $room) {
                $type = $types[$room->id] ?? '';
                $sum[$type] ??= ['type' => '' === $type ? null : $type, 'label' => $catalog[$type]['label'] ?? 'Sin tipo', 'm2' => 0.0, 'rooms' => 0];
                $sum[$type]['m2'] += $room->netM2;
                ++$sum[$type]['rooms'];
            }
        }
        $out = array_map(static fn (array $s): array => ['m2' => round($s['m2'], 2)] + $s, array_values($sum));
        usort($out, static fn (array $a, array $b): int => [null === $a['type'], $b['m2']] <=> [null === $b['type'], $a['m2']]);

        return $out;
    }

    /** @return array<int, true> ambientes que tienen al menos una ventana en alguno de sus muros */
    private function roomsWithWindow(LevelAnalysis $l): array
    {
        $rooms = [];
        foreach ($l->level->openings as $o) {
            $wall = OpeningKind::Window === $o->kind ? $l->level->wall($o->wallId) : null;
            if (null === $wall) {
                continue;
            }
            $horizontal = $wall->y1 === $wall->y2;
            $from = ($horizontal ? min($wall->x1, $wall->x2) : min($wall->y1, $wall->y2)) + $o->pos;
            // las celdas de la retícula a cada lado del eje del muro, a lo largo del vano
            for ($k = $from; $k < $from + $o->w; ++$k) {
                foreach ([-1, 0] as $side) {
                    $room = $horizontal ? $l->regions->roomAtCell($k, $wall->y1 + $side) : $l->regions->roomAtCell($wall->x1 + $side, $k);
                    if ($room > 0) {
                        $rooms[$room] = true;
                    }
                }
            }
        }

        return $rooms;
    }

    private function n(float $v): string
    {
        return rtrim(rtrim(number_format($v, 1, ',', ''), '0'), ',');
    }
}
