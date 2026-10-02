<?php

declare(strict_types=1);

namespace App\Domain\Validation;

use App\Domain\Hcca;
use App\Domain\LevelAnalysis;
use App\Domain\Model\OpeningKind;

/**
 * Tipo de cada ambiente y recomendaciones de uso según el tipo (ventana, ventilación, superficie de referencia y
 * circulación: dormitorios de paso, baño que abre a la cocina o al comedor, escalera que llega a un dormitorio). El
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

    /**
     * @param list<array{int, int}> $arrivals celdas del nivel donde llega una escalera desde abajo
     *
     * @return list<Issue>
     */
    public function review(int $index, LevelAnalysis $l, array $arrivals = []): array
    {
        $types = $this->types($l);
        if ([] === $types) {
            return [];
        }
        $catalog = Hcca::roomTypes();
        $windows = $this->roomsWithWindow($l);
        $doors = $this->doors($l);
        $arriving = array_map(static fn (array $c): int => $l->regions->roomAtCell($c[0], $c[1]), $arrivals);
        // nombre y punto de cada ambiente con tipo: la observación apunta al nombre, que está siempre adentro
        $named = [];
        foreach ($l->regions->rooms as $room) {
            $spec = $catalog[$types[$room->id] ?? ''] ?? null;
            $label = array_find($l->level->labels, static fn ($lb): bool => $l->regions->roomAtCell($lb->x, $lb->y) === $room->id);
            if (null !== $spec && null !== $label) {
                $named[$room->id] = ['' !== $label->name ? $label->name : $spec['label'], $label->x, $label->y];
            }
        }
        $issues = [];
        foreach ($l->regions->rooms as $room) {
            $type = $types[$room->id] ?? '';
            $spec = $catalog[$type] ?? null;
            if (null === $spec || !isset($named[$room->id])) {
                continue;
            }
            [$name, $x, $y] = $named[$room->id];
            $at = [$x, $y];
            $next = array_keys($doors[$room->id] ?? []);
            if (in_array($type, ['bano', 'toilette'], true)) {
                foreach ($next as $other) {
                    if (in_array($types[$other] ?? '', ['cocina', 'comedor'], true)) {
                        $issues[] = new Issue(Issue::INFO, 'room.bath-door', sprintf('«%s» abre directo a «%s»: conviene que dé a un paso o a un pasillo.', $name, $named[$other][0]), $index, null, $at[0], $at[1]);
                    }
                }
            }
            // Dormitorio de paso: otro ambiente (que no es de servicio) al que sólo se llega atravesando dormitorios.
            if ([] !== $next && !in_array($type, Hcca::SERVICE_ROOMS, true) && !array_any($next, static fn (int $o): bool => 'dormitorio' !== ($types[$o] ?? ''))) {
                foreach ($next as $bedroom) {
                    if (isset($named[$bedroom])) {
                        $issues[] = new Issue(Issue::WARN, 'room.pass-through', sprintf('«%s» es de paso: a «%s» sólo se llega atravesándolo.', $named[$bedroom][0], $name), $index, null, $named[$bedroom][1], $named[$bedroom][2]);
                    }
                }
            }
            if ('dormitorio' === $type && in_array($room->id, $arriving, true)) {
                $issues[] = new Issue(Issue::INFO, 'room.stair', sprintf('La escalera llega a «%s»: conviene que llegue a un hall o a un pasillo.', $name), $index, null, $at[0], $at[1]);
            }
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
     * @return list<array{type: ?string, label: string, m2: float, rooms: int, habitable: bool}>
     */
    public function areas(array $levels): array
    {
        $catalog = Hcca::roomTypes();
        $sum = [];
        foreach ($levels as $l) {
            $types = $this->types($l);
            foreach ($l->regions->rooms as $room) {
                $type = $types[$room->id] ?? '';
                $sum[$type] ??= ['type' => '' === $type ? null : $type, 'label' => $catalog[$type]['label'] ?? 'Sin tipo', 'm2' => 0.0, 'rooms' => 0, 'habitable' => !in_array($type, Hcca::NON_HABITABLE_ROOMS, true)];
                $sum[$type]['m2'] += $room->netM2;
                ++$sum[$type]['rooms'];
            }
        }
        $out = array_map(static fn (array $s): array => ['m2' => round($s['m2'], 2)] + $s, array_values($sum));
        usort($out, static fn (array $a, array $b): int => [null === $a['type'], $b['m2']] <=> [null === $b['type'], $a['m2']]);

        return $out;
    }

    /**
     * Qué ambientes comunica cada puerta: ambiente => [vecino => true], con 0 para el exterior (o un espacio abierto).
     *
     * @return array<int, array<int, true>>
     */
    private function doors(LevelAnalysis $l): array
    {
        $links = [];
        foreach ($l->level->openings as $o) {
            $wall = OpeningKind::Door === $o->kind ? $l->level->wall($o->wallId) : null;
            if (null === $wall) {
                continue;
            }
            $horizontal = $wall->y1 === $wall->y2;
            $mid = ($horizontal ? min($wall->x1, $wall->x2) : min($wall->y1, $wall->y2)) + $o->pos + intdiv($o->w, 2);
            $a = $horizontal ? $l->regions->roomAtCell($mid, $wall->y1 - 1) : $l->regions->roomAtCell($wall->x1 - 1, $mid);
            $b = $horizontal ? $l->regions->roomAtCell($mid, $wall->y1) : $l->regions->roomAtCell($wall->x1, $mid);
            if ($a !== $b) {
                $links[$a][$b] = true;
                $links[$b][$a] = true;
            }
        }

        return $links;
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
