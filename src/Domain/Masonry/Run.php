<?php

declare(strict_types=1);

namespace App\Domain\Masonry;

use App\Domain\Hcca;
use App\Domain\Model\Axis;

/**
 * Corrida de una hilada: tramo continuo de mampostería sobre una recta (uno o varios muros
 * colineales fusionados), con sus vanos y las piezas que la componen.
 */
final class Run
{
    /**
     * @param list<string>                  $wallIds
     * @param list<Piece>                   $pieces
     * @param list<array{int, int, string}> $voids   [desde, hasta, id de vano] en ticks
     */
    public function __construct(
        public readonly Axis $axis,
        public readonly int $line,
        public readonly int $a,
        public readonly int $b,
        public readonly int $t,
        public readonly array $wallIds,
        public array $pieces = [],
        public array $voids = [],
    ) {
    }

    public function key(): string
    {
        return $this->axis->value.':'.$this->line;
    }

    /** @return array<string, mixed> valores en cm; cada pieza es [desde, hasta, código] con código 0=bloque, 1=bloque cortado, 2=U, 3=U cortado */
    public function toArray(): array
    {
        return [
            'axis' => $this->axis->value,
            'line' => Hcca::ticksToCm($this->line),
            'a' => Hcca::ticksToCm($this->a),
            'b' => Hcca::ticksToCm($this->b),
            't' => Hcca::ticksToCm($this->t),
            'pieces' => array_map(
                static fn (Piece $p): array => [Hcca::ticksToCm($p->a), Hcca::ticksToCm($p->b), ($p->kind === PieceKind::U ? 2 : 0) + ($p->isFull() ? 0 : 1)],
                $this->pieces,
            ),
            'voids' => array_map(static fn (array $v): array => [Hcca::ticksToCm($v[0]), Hcca::ticksToCm($v[1])], $this->voids),
        ];
    }
}
