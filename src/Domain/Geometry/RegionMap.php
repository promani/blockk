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
    ) {
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
