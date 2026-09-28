<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

use App\Domain\Model\Axis;
use App\Domain\Model\Wall;

/** Nodo de la retícula donde termina al menos un muro. Los brazos se indexan por dirección: E, W, N, S. */
final readonly class Node
{
    private const array OPPOSITE = ['E' => 'W', 'W' => 'E', 'N' => 'S', 'S' => 'N'];

    /** @param array<string, Wall> $arms */
    public function __construct(public int $x, public int $y, public array $arms)
    {
    }

    public function type(): NodeType
    {
        return match (count($this->arms)) {
            1 => NodeType::Free,
            2 => $this->hasCollinearPair() ? NodeType::Straight : NodeType::Corner,
            3 => NodeType::Tee,
            default => NodeType::Cross,
        };
    }

    private function hasCollinearPair(): bool
    {
        return (isset($this->arms['E']) && isset($this->arms['W'])) || (isset($this->arms['N']) && isset($this->arms['S']));
    }

    /** Dirección del brazo con la que $wall entra a este nodo. */
    public static function armDirection(Wall $wall, bool $atStart): string
    {
        return Axis::X === $wall->axis() ? ($atStart ? 'E' : 'W') : ($atStart ? 'S' : 'N');
    }

    public function opposite(string $dir): ?Wall
    {
        return $this->arms[self::OPPOSITE[$dir]] ?? null;
    }

    /** Brazos de un eje: [Wall, Wall] si ambos existen. @return list<Wall> */
    public function armsOn(Axis $axis): array
    {
        $dirs = Axis::X === $axis ? ['E', 'W'] : ['N', 'S'];

        return array_values(array_filter(array_map(fn (string $d): ?Wall => $this->arms[$d] ?? null, $dirs)));
    }
}
