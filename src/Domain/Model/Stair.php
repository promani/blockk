<?php

declare(strict_types=1);

namespace App\Domain\Model;

/**
 * Escalera que une el nivel donde se dibuja con el superior. (x, y) es la esquina mínima de su huella (unidades).
 * shape: 'straight' | 'L' | 'U' (con descanso). dir: sentido de subida del primer tramo ('N','E','S','W'). turn: 'left' | 'right'.
 */
final readonly class Stair
{
    public function __construct(
        public string $id,
        public int $x,
        public int $y,
        public string $dir = 'N',
        public string $shape = 'straight',
        public int $w = 8,
        public int $tread = 28,
        public string $turn = 'right',
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['id' => $this->id, 'x' => $this->x, 'y' => $this->y, 'dir' => $this->dir, 'shape' => $this->shape, 'w' => $this->w, 'tread' => $this->tread, 'turn' => $this->turn];
    }
}
