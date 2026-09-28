<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

use App\Domain\Hcca;
use App\Domain\Model\Axis;
use App\Domain\Model\Level;

/**
 * Detecta ambientes cerrados rellenando las celdas de la retícula (12,5 cm) sin cruzar muros.
 * Las celdas alcanzables desde afuera son el exterior; el resto se agrupa en ambientes.
 *
 * Superficie útil: se parte del área a ejes y se descuenta medio espesor a lo largo de cada
 * arista de muro, corrigiendo la doble resta en esquinas convexas y la resta faltante en las
 * cóncavas (fórmula exacta para polígonos ortogonales con espesor por arista).
 */
final class RegionAnalyzer
{
    private int $i0;
    private int $j0;
    private int $cols;
    private int $rows;
    /** @var list<int> espesor (ticks) de la arista vertical x=i entre las celdas (i-1,j) y (i,j) */
    private array $vt = [];
    /** @var list<int> espesor (ticks) de la arista horizontal y=j entre las celdas (i,j-1) y (i,j) */
    private array $ht = [];
    /** @var list<int> */
    private array $roomOf = [];

    public function analyze(Level $level): RegionMap
    {
        if ($level->isEmpty()) {
            return new RegionMap();
        }
        $minX = min(array_map(static fn ($w): int => $w->x1, $level->walls));
        $maxX = max(array_map(static fn ($w): int => $w->x2, $level->walls));
        $minY = min(array_map(static fn ($w): int => $w->y1, $level->walls));
        $maxY = max(array_map(static fn ($w): int => $w->y2, $level->walls));
        $this->i0 = $minX - 1;
        $this->j0 = $minY - 1;
        $this->cols = $maxX - $minX + 2;
        $this->rows = $maxY - $minY + 2;
        $this->vt = array_fill(0, ($this->cols + 1) * $this->rows, 0);
        $this->ht = array_fill(0, $this->cols * ($this->rows + 1), 0);

        foreach ($level->walls as $w) {
            if (Axis::Y === $w->axis()) {
                for ($j = $w->y1; $j < $w->y2; ++$j) {
                    $this->vt[$this->vIdx($w->x1, $j)] = $w->t;
                }
            } else {
                for ($i = $w->x1; $i < $w->x2; ++$i) {
                    $this->ht[$this->hIdx($i, $w->y1)] = $w->t;
                }
            }
        }

        $roomCount = $this->label();
        $rooms = $this->buildRooms($roomCount);

        [$faces, $exterior, $free] = $this->wallFaces($level);

        return new RegionMap($rooms, $faces, $exterior, $free);
    }

    private function vIdx(int $i, int $j): int
    {
        return ($j - $this->j0) * ($this->cols + 1) + ($i - $this->i0);
    }

    private function hIdx(int $i, int $j): int
    {
        return ($j - $this->j0) * $this->cols + ($i - $this->i0);
    }

    private function cIdx(int $i, int $j): int
    {
        return ($j - $this->j0) * $this->cols + ($i - $this->i0);
    }

    private function vAt(int $i, int $j): int
    {
        if ($i < $this->i0 || $i > $this->i0 + $this->cols || $j < $this->j0 || $j >= $this->j0 + $this->rows) {
            return 0;
        }

        return $this->vt[$this->vIdx($i, $j)];
    }

    private function hAt(int $i, int $j): int
    {
        if ($i < $this->i0 || $i >= $this->i0 + $this->cols || $j < $this->j0 || $j > $this->j0 + $this->rows) {
            return 0;
        }

        return $this->ht[$this->hIdx($i, $j)];
    }

    /** Ambiente de una celda; 0 (exterior) fuera de la grilla. */
    private function roomAt(int $i, int $j): int
    {
        if ($i < $this->i0 || $i >= $this->i0 + $this->cols || $j < $this->j0 || $j >= $this->j0 + $this->rows) {
            return 0;
        }

        return $this->roomOf[$this->cIdx($i, $j)];
    }

    /** Etiqueta componentes conexas por relleno; la que contiene la celda de la esquina es el exterior (0). */
    private function label(): int
    {
        $total = $this->cols * $this->rows;
        $this->roomOf = array_fill(0, $total, -1);
        $next = 0;
        for ($start = 0; $start < $total; ++$start) {
            if ($this->roomOf[$start] >= 0) {
                continue;
            }
            $id = $next++;
            $this->roomOf[$start] = $id;
            $queue = [$start];
            for ($q = 0; $q < count($queue); ++$q) {
                $c = $queue[$q];
                $i = $this->i0 + $c % $this->cols;
                $j = $this->j0 + intdiv($c, $this->cols);
                foreach ([[1, 0, $this->vAt($i + 1, $j)], [-1, 0, $this->vAt($i, $j)], [0, 1, $this->hAt($i, $j + 1)], [0, -1, $this->hAt($i, $j)]] as [$di, $dj, $blocked]) {
                    $ni = $i + $di;
                    $nj = $j + $dj;
                    if (0 !== $blocked || $ni < $this->i0 || $ni >= $this->i0 + $this->cols || $nj < $this->j0 || $nj >= $this->j0 + $this->rows) {
                        continue;
                    }
                    $n = $this->cIdx($ni, $nj);
                    if ($this->roomOf[$n] < 0) {
                        $this->roomOf[$n] = $id;
                        $queue[] = $n;
                    }
                }
            }
        }

        return $next - 1;
    }

    /** @return list<Room> */
    private function buildRooms(int $roomCount): array
    {
        if ($roomCount < 1) {
            return [];
        }
        $cells = array_fill(1, $roomCount, 0);
        $bbox = array_fill(1, $roomCount, [PHP_INT_MAX, PHP_INT_MAX, PHP_INT_MIN, PHP_INT_MIN]);
        $strip = array_fill(1, $roomCount, 0); // ticks² restados por aristas
        $corner = array_fill(1, $roomCount, 0); // ticks² de corrección en esquinas
        $perimeter = array_fill(1, $roomCount, 0); // ticks

        for ($j = $this->j0; $j < $this->j0 + $this->rows; ++$j) {
            for ($i = $this->i0; $i < $this->i0 + $this->cols; ++$i) {
                $r = $this->roomAt($i, $j);
                if (0 === $r) {
                    continue;
                }
                ++$cells[$r];
                $bbox[$r] = [min($bbox[$r][0], $i), min($bbox[$r][1], $j), max($bbox[$r][2], $i + 1), max($bbox[$r][3], $j + 1)];
                foreach ([$this->hAt($i, $j), $this->hAt($i, $j + 1), $this->vAt($i, $j), $this->vAt($i + 1, $j)] as $t) {
                    if ($t > 0) {
                        $strip[$r] += Hcca::GRID * intdiv($t, 2);
                        $perimeter[$r] += Hcca::GRID;
                    }
                }
            }
        }

        for ($j = $this->j0; $j <= $this->j0 + $this->rows; ++$j) {
            for ($i = $this->i0; $i <= $this->i0 + $this->cols; ++$i) {
                $quad = ['NW' => $this->roomAt($i - 1, $j - 1), 'NE' => $this->roomAt($i, $j - 1), 'SW' => $this->roomAt($i - 1, $j), 'SE' => $this->roomAt($i, $j)];
                $edges = [
                    'SE' => [$this->hAt($i, $j), $this->vAt($i, $j)],
                    'NE' => [$this->hAt($i, $j), $this->vAt($i, $j - 1)],
                    'SW' => [$this->hAt($i - 1, $j), $this->vAt($i, $j)],
                    'NW' => [$this->hAt($i - 1, $j), $this->vAt($i, $j - 1)],
                ];
                foreach (array_unique(array_filter($quad)) as $r) {
                    $inside = array_keys(array_filter($quad, static fn (int $q): bool => $q === $r));
                    $count = count($inside);
                    if (1 === $count || (2 === $count && $this->isDiagonal($inside))) {
                        foreach ($inside as $pos) {
                            $corner[$r] += intdiv($edges[$pos][0], 2) * intdiv($edges[$pos][1], 2);
                        }
                    } elseif (3 === $count) {
                        $missing = array_values(array_diff(array_keys($quad), $inside))[0];
                        $corner[$r] -= intdiv($edges[$missing][0], 2) * intdiv($edges[$missing][1], 2);
                    }
                }
            }
        }

        $rooms = [];
        $ticksSqPerM2 = (Hcca::TICKS_PER_CM * 100) ** 2;
        for ($r = 1; $r <= $roomCount; ++$r) {
            $gross = $cells[$r] * Hcca::GRID * Hcca::GRID;
            $net = $gross - $strip[$r] + $corner[$r];
            $rooms[] = new Room(
                id: $r,
                cells: $cells[$r],
                grossM2: $gross / $ticksSqPerM2,
                netM2: max(0.0, $net / $ticksSqPerM2),
                perimeterM: $perimeter[$r] / (Hcca::TICKS_PER_CM * 100),
                x: $bbox[$r][0],
                y: $bbox[$r][1],
                w: $bbox[$r][2] - $bbox[$r][0],
                h: $bbox[$r][3] - $bbox[$r][1],
            );
        }

        return $rooms;
    }

    /** @param list<string> $positions */
    private function isDiagonal(array $positions): bool
    {
        sort($positions);

        return $positions === ['NE', 'SW'] || $positions === ['NW', 'SE'];
    }

    /** @return array{array<string, array{neg: list<int>, pos: list<int>}>, array<string, array{int, int}>, list<string>} */
    private function wallFaces(Level $level): array
    {
        $faces = [];
        $exterior = [];
        $free = [];
        foreach ($level->walls as $w) {
            $neg = [];
            $pos = [];
            if (Axis::X === $w->axis()) {
                for ($i = $w->x1; $i < $w->x2; ++$i) {
                    $neg[] = $this->roomAt($i, $w->y1 - 1);
                    $pos[] = $this->roomAt($i, $w->y1);
                }
                $normals = [[0, -1], [0, 1]];
            } else {
                for ($j = $w->y1; $j < $w->y2; ++$j) {
                    $neg[] = $this->roomAt($w->x1 - 1, $j);
                    $pos[] = $this->roomAt($w->x1, $j);
                }
                $normals = [[-1, 0], [1, 0]];
            }
            $faces[$w->id] = ['neg' => $neg, 'pos' => $pos];
            $len = max(1, count($neg));
            $extNeg = count(array_filter($neg, static fn (int $r): bool => 0 === $r)) * 2 >= $len;
            $extPos = count(array_filter($pos, static fn (int $r): bool => 0 === $r)) * 2 >= $len;
            if ($extNeg && $extPos) {
                $free[] = $w->id;
            } elseif ($extNeg) {
                $exterior[$w->id] = $normals[0];
            } elseif ($extPos) {
                $exterior[$w->id] = $normals[1];
            }
        }

        return [$faces, $exterior, $free];
    }
}
