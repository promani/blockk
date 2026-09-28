<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

/** Ambiente cerrado detectado por relleno de celdas de la retícula (12,5 cm). */
final readonly class Room
{
    public function __construct(
        public int $id,
        public int $cells,
        public float $grossM2,
        public float $netM2,
        public float $perimeterM,
        public int $x,
        public int $y,
        public int $w,
        public int $h,
    ) {
    }

    public function isRectangular(): bool
    {
        return $this->cells === $this->w * $this->h;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => 'Ambiente '.$this->id,
            'grossM2' => round($this->grossM2, 2),
            'netM2' => round($this->netM2, 2),
            'perimeterM' => round($this->perimeterM, 2),
            'bbox' => ['x' => $this->x, 'y' => $this->y, 'w' => $this->w, 'h' => $this->h],
            'rect' => $this->isRectangular(),
        ];
    }
}
