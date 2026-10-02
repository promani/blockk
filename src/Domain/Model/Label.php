<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Nombre de un ambiente: un punto (x, y, en unidades de 12,5 cm) dentro de él y el texto que se dibuja en la planta. */
final readonly class Label
{
    public function __construct(
        public string $id,
        public int $x,
        public int $y,
        public string $name,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['id' => $this->id, 'x' => $this->x, 'y' => $this->y, 'name' => $this->name];
    }
}
