<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Pilar de hormigón armado: centro (x, y) en unidades de 12,5 cm y lado `size` en cm. Va de piso a techo del nivel. */
final readonly class Column
{
    public function __construct(
        public string $id,
        public int $x,
        public int $y,
        public int $size = 20,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['id' => $this->id, 'x' => $this->x, 'y' => $this->y, 'size' => $this->size];
    }
}
