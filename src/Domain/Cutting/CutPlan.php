<?php

declare(strict_types=1);

namespace App\Domain\Cutting;

use App\Domain\Hcca;

/** Resultado del empaquetado: cada "bin" es un bloque de 62,5 cm cortado en varias piezas. */
final readonly class CutPlan
{
    /** @param list<array{cuts: list<int>, rest: int}> $bins */
    public function __construct(public array $bins)
    {
    }

    /** Bloques enteros que hay que cortar. */
    public function blocks(): int
    {
        return count($this->bins);
    }

    /** Material que no se puede reaprovechar (ticks lineales). */
    public function scrapTicks(): int
    {
        return array_sum(array_map(static fn (array $b): int => $b['rest'], $this->bins));
    }

    public function stockTicks(): int
    {
        return $this->blocks() * Hcca::BLOCK_L;
    }

    /**
     * Patrones de corte agrupados: "37,5 + 25" × N bloques.
     *
     * @return list<array{pattern: list<float>, blocks: int, restCm: float}>
     */
    public function patterns(): array
    {
        $groups = [];
        foreach ($this->bins as $bin) {
            $cuts = $bin['cuts'];
            rsort($cuts);
            $key = implode('+', $cuts);
            $groups[$key] ??= ['pattern' => array_map(Hcca::ticksToCm(...), $cuts), 'blocks' => 0, 'restCm' => Hcca::ticksToCm($bin['rest'])];
            ++$groups[$key]['blocks'];
        }
        usort($groups, static fn (array $a, array $b): int => $b['blocks'] <=> $a['blocks']);

        return array_values($groups);
    }
}
