<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

use App\Domain\Hcca;
use App\Domain\Model\Level;
use App\Domain\Model\Opening;
use App\Domain\Model\Wall;

/**
 * Dónde se puede abrir un vano en un muro: jamba >= 25 cm respecto de esquinas, muros transversales
 * y otros vanos. Es la única fuente de la regla; el editor usa estos intervalos para validar en vivo.
 */
final class OpeningPlacement
{
    private const int PIER_UNITS = 2; // 25 cm

    /**
     * @return list<array{int, int}> intervalos [desde, hasta] en unidades: un vano [pos, pos + w] cabe si desde <= pos y pos + w <= hasta
     */
    public function freeIntervals(Level $level, Topology $topology, Wall $wall, ?string $ignoreOpening = null): array
    {
        $startPier = intdiv($topology->perpendicularThickness($wall, true), 2) + Hcca::MIN_PIER;
        $endPier = intdiv($topology->perpendicularThickness($wall, false), 2) + Hcca::MIN_PIER;
        $lo = (int) ceil($startPier / Hcca::GRID);
        $hi = (int) floor(($wall->lengthTicks() - $endPier) / Hcca::GRID);
        if ($hi <= $lo) {
            return [];
        }

        $free = [[$lo, $hi]];
        $others = array_filter($level->openingsOn($wall->id), static fn (Opening $o): bool => $o->id !== $ignoreOpening);
        foreach ($others as $o) {
            $blockFrom = $o->pos - self::PIER_UNITS;
            $blockTo = $o->endU() + self::PIER_UNITS;
            $next = [];
            foreach ($free as [$f, $t]) {
                if ($blockTo <= $f || $blockFrom >= $t) {
                    $next[] = [$f, $t];
                    continue;
                }
                if ($f < $blockFrom) {
                    $next[] = [$f, $blockFrom];
                }
                if ($blockTo < $t) {
                    $next[] = [$blockTo, $t];
                }
            }
            $free = $next;
        }

        return array_values(array_filter($free, static fn (array $i): bool => $i[1] - $i[0] >= 2));
    }
}
