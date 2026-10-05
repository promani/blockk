<?php

declare(strict_types=1);

namespace App\Domain\Floor;

use App\Domain\Geometry\RegionMap;
use App\Domain\Hcca;
use App\Domain\Model\Project;
use App\Domain\Model\Slab;

/**
 * Pisos del Nivel 2. Cada habitación de arriba lleva su losa sola (la que se ve como piso del ambiente); las losas
 * dibujadas son pisos extra fuera de las habitaciones, como un balcón. Todo se computa como losa de hormigón, sin el
 * hueco de las escaleras.
 */
final class SlabPlanner
{
    /** Luz de referencia de una losa maciza sin vigas intermedias. */
    private const int MAX_SPAN_CM = 400;

    /** Voladizo de referencia sin pilares debajo. */
    private const int MAX_CANTILEVER_CM = 120;

    /** @param list<array{float, float, float, float}> $holes huecos de escalera (cm) */
    public function plan(Project $project, RegionMap $ground, ?RegionMap $upper, array $holes): SlabPlan
    {
        $G = Hcca::GRID_CM;
        $auto = $this->autoParts($upper, $holes);
        $autoM2 = RectMath::area($auto) / 10000;
        $areaM2 = $autoM2;
        $concreteM3 = $autoM2 * Hcca::SLAB_THICKNESS_CM / 100;
        $slabs = [];
        $issues = [];
        $redundant = [];
        $extras = $project->level(1)->slabs;

        foreach ($extras as $i => $s) {
            [$inRooms, $cells] = $this->countCells($s, static fn (int $x, int $y): bool => null !== $upper && 0 !== $upper->roomAtCell($x, $y));
            if ($inRooms === $cells) {
                // de un proyecto anterior: la habitación ya tiene su piso
                $redundant[] = $s->id;
                continue;
            }
            $rect = [$s->x * $G, $s->y * $G, ($s->x + $s->w) * $G, ($s->y + $s->h) * $G];
            $parts = RectMath::subtract($rect, $holes);
            $area = RectMath::area($parts) / 10000;
            $areaM2 += $area;
            $concreteM3 += $area * $s->thickness / 100;
            $slabs[] = [
                'id' => $s->id,
                'rect' => ['x' => $rect[0], 'y' => $rect[1], 'w' => $rect[2] - $rect[0], 'h' => $rect[3] - $rect[1]],
                'thickness' => $s->thickness,
                'areaM2' => round($area, 2),
                'parts' => array_map(static fn (array $p): array => ['x0' => $p[0], 'y0' => $p[1], 'x1' => $p[2], 'y1' => $p[3]], $parts),
                // Huecos (escaleras) recortados a la losa: el navegador dibuja una sola placa con estos agujeros.
                'holes' => RectMath::clipTo($rect, $holes),
            ];
            if ($inRooms > 0) {
                $issues[] = $this->issue('error', 'floor.overlap', 'El piso se superpone con una habitación del Nivel 2, que ya tiene su piso: dibujalo sólo afuera (balcón, terraza).', $s->id, $s->x, $s->y);
            }
            $cantilever = $this->cantileverCm($s, $ground);
            if ($cantilever > self::MAX_CANTILEVER_CM && !$this->hasColumnsUnder($project, $s)) {
                $issues[] = $this->issue('warn', 'slab.cantilever', sprintf('Voladizo de %s m sin apoyo: más de 1,20 m se verifica con cálculo o lleva pilares debajo.', number_format($cantilever / 100, 2, ',', '')), $s->id, $s->x, $s->y);
            }
            if (min($s->w, $s->h) * $G > self::MAX_SPAN_CM) {
                $issues[] = $this->issue('warn', 'slab.span', sprintf('Luz de %s m: una losa maciza sin vigas intermedias se verifica con cálculo (referencia hasta 4,00 m).', number_format(min($s->w, $s->h) * $G / 100, 2, ',', '')), $s->id, $s->x, $s->y);
            }
            foreach (array_slice($extras, $i + 1) as $o) {
                if (RectMath::intersects($rect, [$o->x * $G, $o->y * $G, ($o->x + $o->w) * $G, ($o->y + $o->h) * $G])) {
                    $issues[] = $this->issue('error', 'floor.overlap', 'Dos pisos se superponen.', $s->id, $s->x, $s->y);
                }
            }
        }

        return new SlabPlan($slabs, $issues, [
            'areaM2' => round($areaM2, 2),
            'autoM2' => round($autoM2, 2),
            'concreteM3' => round($concreteM3, 2),
            'meshM2' => round($areaM2 * 1.10, 1),
            'formworkM2' => round($areaM2, 2),
        ], $redundant);
    }

    /**
     * Losa automática: las celdas de las habitaciones del Nivel 2, menos los huecos de escalera (cm).
     *
     * @param list<array{float, float, float, float}> $holes
     *
     * @return list<array{float, float, float, float}>
     */
    private function autoParts(?RegionMap $upper, array $holes): array
    {
        if (null === $upper || [] === $upper->rooms) {
            return [];
        }
        $G = Hcca::GRID_CM;
        $parts = [];
        foreach ($this->roomRects($upper) as [$x, $y, $w, $h]) {
            array_push($parts, ...RectMath::subtract([$x * $G, $y * $G, ($x + $w) * $G, ($y + $h) * $G], $holes));
        }

        return $parts;
    }

    /**
     * Rectángulos (unidades) que cubren las habitaciones: los rellenos de cada ambiente o, en planos enormes (sin formas),
     * los tramos de cada fila.
     *
     * @return list<array{int, int, int, int}>
     */
    private function roomRects(RegionMap $map): array
    {
        $shapes = $map->shapes();
        if ([] !== $shapes) {
            return array_merge(...array_values(array_map(static fn (array $s): array => $s['fill'], $shapes)));
        }
        $rects = [];
        for ($j = $map->j0; $j < $map->j0 + $map->rows; ++$j) {
            for ($i = $map->i0; $i < $map->i0 + $map->cols; ++$i) {
                if (0 === $map->roomAtCell($i, $j)) {
                    continue;
                }
                $a = $i;
                while ($i + 1 < $map->i0 + $map->cols && 0 !== $map->roomAtCell($i + 1, $j)) {
                    ++$i;
                }
                $rects[] = [$a, $j, $i + 1 - $a, 1];
            }
        }

        return $rects;
    }

    /**
     * @param callable(int, int): bool $inside
     *
     * @return array{int, int} celdas del piso que cumplen $inside y celdas en total
     */
    private function countCells(Slab $s, callable $inside): array
    {
        $n = 0;
        for ($j = $s->y; $j < $s->y + $s->h; ++$j) {
            for ($i = $s->x; $i < $s->x + $s->w; ++$i) {
                $n += $inside($i, $j) ? 1 : 0;
            }
        }

        return [$n, $s->w * $s->h];
    }

    /** Cuánto sale el piso de las habitaciones de abajo (cm): la celda más alejada, buscando apoyo en las cuatro direcciones. */
    private function cantileverCm(Slab $s, RegionMap $ground): float
    {
        $limit = (int) ceil(self::MAX_CANTILEVER_CM / Hcca::GRID_CM) + 1;
        $worst = 0;
        for ($j = $s->y; $j < $s->y + $s->h; ++$j) {
            for ($i = $s->x; $i < $s->x + $s->w; ++$i) {
                if (0 !== $ground->roomAtCell($i, $j)) {
                    continue;
                }
                $near = $limit;
                foreach ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [$di, $dj]) {
                    for ($k = 1; $k < $near; ++$k) {
                        if (0 !== $ground->roomAtCell($i + $di * $k, $j + $dj * $k)) {
                            $near = $k;
                            break;
                        }
                    }
                }
                $worst = max($worst, $near);
            }
        }

        // la celda del borde cuenta entera: a 1 celda del apoyo hay 12,5 cm de voladizo
        return $worst * Hcca::GRID_CM;
    }

    private function hasColumnsUnder(Project $project, Slab $s): bool
    {
        return array_any($project->level(0)->columns, static fn ($c): bool => $c->x >= $s->x && $c->x <= $s->x + $s->w && $c->y >= $s->y && $c->y <= $s->y + $s->h);
    }

    /** @return array<string, mixed> */
    private function issue(string $severity, string $code, string $message, string $ref, int $x, int $y): array
    {
        return ['severity' => $severity, 'code' => $code, 'message' => $message, 'level' => 1, 'ref' => $ref, 'x' => $x, 'y' => $y];
    }
}
