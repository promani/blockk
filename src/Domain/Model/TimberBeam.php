<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Viga de madera individual entre dos nodos ortogonales (apoya sobre muros portantes en ambos extremos). */
final readonly class TimberBeam implements TimberElement
{
    public function __construct(
        public string $id,
        public int $x1,
        public int $y1,
        public int $x2,
        public int $y2,
        public string $section = '3x10',
    ) {
    }

    public function id(): string
    {
        return $this->id;
    }

    public function axis(): Axis
    {
        return $this->y1 === $this->y2 ? Axis::X : Axis::Y;
    }

    public function lengthU(): int
    {
        return abs($this->x2 - $this->x1) + abs($this->y2 - $this->y1);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'kind' => 'beam',
            'x1' => $this->x1,
            'y1' => $this->y1,
            'x2' => $this->x2,
            'y2' => $this->y2,
            'section' => $this->section,
        ];
    }
}
