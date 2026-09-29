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
