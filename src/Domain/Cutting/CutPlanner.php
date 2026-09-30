<?php

declare(strict_types=1);

namespace App\Domain\Cutting;

use App\Domain\Hcca;

/**
 * Empaquetado final de cortes (best-fit decreasing): asigna cada pieza cortada al bloque entero cuyo remanente
 * es el más justo, y devuelve el plan (patrones de corte y sobrantes) para el cómputo.
 */
final class CutPlanner
{
    /**
     * Mejor plan para varios grupos de piezas (p. ej. una lista por nivel): la unión optimizada o la simple suma de los
     * planes por grupo, lo que use menos bloques (best-fit decreasing no es monótono: la unión puede salir peor).
     *
     * @param list<list<int>> $groups
     */
    public static function planBest(array $groups): CutPlan
    {
        $groups = array_values(array_filter($groups, static fn (array $g): bool => [] !== $g));
        if (count($groups) <= 1) {
            return self::plan($groups[0] ?? []);
        }
        $union = self::plan(array_merge(...$groups));
        $sum = CutPlan::merge(array_map(self::plan(...), $groups));

        return [$sum->blocks(), $sum->scrapTicks()] < [$union->blocks(), $union->scrapTicks()] ? $sum : $union;
    }

    /** @param list<int> $pieces largos en ticks (cada uno < BLOCK_L) */
    public static function plan(array $pieces): CutPlan
    {
        rsort($pieces);
        /** @var list<list<int>> $cuts */
        $cuts = [];
        /** @var list<int> $rests */
        $rests = [];
        /** @var array<int, list<int>> $buckets largo libre => ids de bloques con ese remanente */
        $buckets = [];
        /** @var list<int> $sorted largos libres distintos, ascendente */
        $sorted = [];

        foreach ($pieces as $len) {
            $i = self::lowerBound($sorted, $len);
            if ($i < count($sorted)) {
                $rest = $sorted[$i];
                $id = array_pop($buckets[$rest]);
                if ([] === $buckets[$rest]) {
                    unset($buckets[$rest]);
                    array_splice($sorted, $i, 1);
                }
            } else {
                $id = count($cuts);
                $cuts[$id] = [];
                $rest = Hcca::blockL();
            }
            $cuts[$id][] = $len;
            $rests[$id] = $rest - $len;
            if ($rests[$id] > 0) {
                if (!isset($buckets[$rests[$id]])) {
                    array_splice($sorted, self::lowerBound($sorted, $rests[$id]), 0, [$rests[$id]]);
                }
                $buckets[$rests[$id]][] = $id;
            }
        }

        $bins = [];
        foreach ($cuts as $id => $c) {
            $bins[] = ['cuts' => $c, 'rest' => $rests[$id]];
        }

        return new CutPlan($bins);
    }

    /** @param list<int> $sorted */
    private static function lowerBound(array $sorted, int $v): int
    {
        $lo = 0;
        $hi = count($sorted);
        while ($lo < $hi) {
            $mid = ($lo + $hi) >> 1;
            if ($sorted[$mid] < $v) {
                $lo = $mid + 1;
            } else {
                $hi = $mid;
            }
        }

        return $lo;
    }
}
