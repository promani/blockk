<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

/**
 * Resultado del análisis de regiones de un nivel.
 *
 * $faces[wallId] = ['neg' => list<int>, 'pos' => list<int>]: id de ambiente que toca cada tramo
 * de 12,5 cm de cada cara del muro (0 = exterior). La cara "neg" es la norte/oeste y "pos" la sur/este.
 * $exterior[wallId] = normal saliente [nx, ny] si el muro es de fachada; 'free' si está exento.
 */
final readonly class RegionMap
{
    /**
     * @param list<Room>                                             $rooms
     * @param array<string, array{neg: list<int>, pos: list<int>}>   $faces
     * @param array<string, array{int, int}>                         $exterior
     * @param list<string>                                           $freeStanding
     */
    public function __construct(
        public array $rooms = [],
        public array $faces = [],
        public array $exterior = [],
        public array $freeStanding = [],
        /** @var list<int> ambiente de cada celda de la grilla (0 = exterior), fila por fila */
        public array $cells = [],
        public int $i0 = 0,
        public int $j0 = 0,
        public int $cols = 0,
        public int $rows = 0,
    ) {
    }

    /** Ambiente (0 = exterior) de la celda (i, j) de la retícula de 12,5 cm. */
    public function roomAtCell(int $i, int $j): int
    {
        if ($i < $this->i0 || $j < $this->j0 || $i >= $this->i0 + $this->cols || $j >= $this->j0 + $this->rows) {
            return 0;
        }

        return $this->cells[($j - $this->j0) * $this->cols + ($i - $this->i0)];
    }

    /** ¿Todas las celdas del rectángulo (unidades) pertenecen a algún ambiente cerrado? */
    public function isInsideRooms(int $x, int $y, int $w, int $h): bool
    {
        for ($j = $y; $j < $y + $h; ++$j) {
            for ($i = $x; $i < $x + $w; ++$i) {
                if (0 === $this->roomAtCell($i, $j)) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Forma de cada ambiente para dibujarlo y editarlo: rectángulos que lo rellenan (x, y, w, h en unidades) y sus esquinas
     * (vértices del contorno, en unidades). Se omite en planos enormes para no encarecer el análisis.
     *
     * @return array<int, array{fill: list<array{int, int, int, int}>, corners: list<array{int, int}>}>
     */
    public function shapes(): array
    {
        if ([] === $this->cells || $this->cols * $this->rows > 250_000) {
            return [];
        }
        $shapes = [];
        // Rellenos: tramos horizontales por fila, fusionados con la fila de arriba si tienen la misma extensión.
        $open = []; // room => list of [i0, i1, j0, rowsCount]
        for ($j = $this->j0; $j <= $this->j0 + $this->rows; ++$j) {
            $runs = [];
            if ($j < $this->j0 + $this->rows) {
                $i = $this->i0;
                $end = $this->i0 + $this->cols;
                while ($i < $end) {
                    $r = $this->cells[($j - $this->j0) * $this->cols + ($i - $this->i0)];
                    $k = $i + 1;
                    while ($k < $end && $this->cells[($j - $this->j0) * $this->cols + ($k - $this->i0)] === $r) {
                        ++$k;
                    }
                    if ($r > 0) {
                        $runs[] = [$r, $i, $k];
                    }
                    $i = $k;
                }
            }
            $next = [];
            foreach ($runs as [$r, $a, $b]) {
                $k = "$r:$a:$b";
                if (isset($open[$k])) {
                    $next[$k] = $open[$k];
                    ++$next[$k][4];
                    unset($open[$k]);
                } else {
                    $next[$k] = [$r, $a, $b, $j, 1];
                }
            }
            foreach ($open as [$r, $a, $b, $j0, $n]) {
                $shapes[$r]['fill'][] = [$a, $j0, $b - $a, $n];
            }
            $open = $next;
        }
        // Esquinas: vértice de la retícula rodeado por 1 o 3 celdas del ambiente (o 2 en diagonal).
        for ($j = $this->j0; $j <= $this->j0 + $this->rows; ++$j) {
            for ($i = $this->i0; $i <= $this->i0 + $this->cols; ++$i) {
                $c = [$this->roomAtCell($i - 1, $j - 1), $this->roomAtCell($i, $j - 1), $this->roomAtCell($i - 1, $j), $this->roomAtCell($i, $j)];
                foreach (array_unique(array_filter($c)) as $r) {
                    $n = 0;
                    foreach ($c as $v) {
                        $n += $v === $r ? 1 : 0;
                    }
                    $diagonal = 2 === $n && (($c[0] === $r && $c[3] === $r) || ($c[1] === $r && $c[2] === $r));
                    if (1 === $n || 3 === $n || $diagonal) {
                        $shapes[$r]['corners'][] = [$i, $j];
                    }
                }
            }
        }

        return $shapes;
    }

    public function room(int $id): ?Room
    {
        return array_find($this->rooms, static fn (Room $r): bool => $r->id === $id);
    }

    public function totalNetM2(): float
    {
        return array_sum(array_map(static fn (Room $r): float => $r->netM2, $this->rooms));
    }

    public function totalGrossM2(): float
    {
        return array_sum(array_map(static fn (Room $r): float => $r->grossM2, $this->rooms));
    }
}
