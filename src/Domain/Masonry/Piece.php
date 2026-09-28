<?php

declare(strict_types=1);

namespace App\Domain\Masonry;

use App\Domain\Hcca;

/** Pieza colocada en una hilada: intervalo [a, b] (ticks) sobre el eje de la corrida. */
final readonly class Piece
{
    public function __construct(
        public int $a,
        public int $b,
        public PieceKind $kind,
        /** 'lintel' | 'crown' | 'beam' para bloques U; null para bloques macizos. */
        public ?string $role = null,
    ) {
    }

    public function length(): int
    {
        return $this->b - $this->a;
    }

    public function isFull(): bool
    {
        return Hcca::BLOCK_L === $this->length();
    }
}
