<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Losa de hormigón que hace de piso de un nivel: rectángulo (x, y, w, h en unidades de 12,5 cm) y espesor en cm. */
final readonly class Slab
{
    public function __construct(
        public string $id,
        public int $x,
        public int $y,
        public int $w,
        public int $h,
        public int $thickness = 12,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['id' => $this->id, 'x' => $this->x, 'y' => $this->y, 'w' => $this->w, 'h' => $this->h, 'thickness' => $this->thickness];
    }
}
