<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Árbol simple (tronco, copa y sombra): su posición en el terreno (unidades de 12,5 cm) y un tamaño S / M / L. No entra al cómputo. */
final readonly class Tree
{
    public function __construct(
        public string $id,
        public int $x,
        public int $y,
        public string $size = 'M',
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['id' => $this->id, 'x' => $this->x, 'y' => $this->y, 'size' => $this->size];
    }
}
