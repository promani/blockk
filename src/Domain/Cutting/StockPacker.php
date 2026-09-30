<?php

declare(strict_types=1);

namespace App\Domain\Cutting;

use App\Domain\Hcca;

/**
 * Empaquetado EN LÍNEA de piezas cortadas sobre bloques enteros de 62,5 cm (cutting stock 1D).
 *
 * Durante el armado de hiladas sirve para elegir el patrón de piezas que menos bloques nuevos abre,
 * reaprovechando remanentes ("sobrante de 25 cm al cortar 37,5" → jamba u hilada siguiente).
 *
 * Los remanentes se guardan como histograma (largo libre → cantidad de bloques) con la lista ordenada de
 * largos distintos, de modo que "el remanente más justo que alcance" es una búsqueda binaria y simular un
 * patrón no copia ni recorre el stock. Los bloques de distinto tipo/espesor no se mezclan: cada $key
 * ("B:400", "U:300") tiene su propio stock.
 */
final class StockPacker
{
    /** @var array<string, array<int, int>> key => largo libre (ticks) => cantidad de bloques */
    private array $count = [];
    /** @var array<string, list<int>> key => largos libres distintos con al menos un bloque, ascendente */
    private array $sorted = [];

    /**
     * Cantidad de bloques nuevos que habría que abrir para colocar $pieces (no modifica el estado).
     *
     * @param list<int> $pieces
     */
    public function newBinsFor(string $key, array $pieces): int
    {
        rsort($pieces);
        $count = $this->count[$key] ?? [];
        $sorted = $this->sorted[$key] ?? [];
        $used = []; // remanentes globales ya consumidos en esta simulación
        $temp = []; // remanentes creados en esta simulación
        $opened = 0;

        foreach ($pieces as $len) {
            $best = null;
            $fromTemp = null;
            $n = count($sorted);
            for ($i = self::lowerBound($sorted, $len); $i < $n; ++$i) {
                $r = $sorted[$i];
                if ($count[$r] - ($used[$r] ?? 0) > 0) {
                    $best = $r;
                    break;
                }
            }
            foreach ($temp as $ti => $rest) {
                if ($rest >= $len && (null === $best || $rest < $best)) {
                    $best = $rest;
                    $fromTemp = $ti;
                }
            }
            if (null === $best) {
                $temp[] = Hcca::blockL() - $len;
                ++$opened;
            } elseif (null === $fromTemp) {
                $used[$best] = ($used[$best] ?? 0) + 1;
                $temp[] = $best - $len;
            } else {
                $temp[$fromTemp] = $best - $len;
            }
        }

        return $opened;
    }

    /** @param list<int> $pieces */
    public function commit(string $key, array $pieces): void
    {
        rsort($pieces);
        foreach ($pieces as $len) {
            $sorted = &$this->sorted[$key];
            $sorted ??= [];
            $i = self::lowerBound($sorted, $len);
            if ($i < count($sorted)) {
                $rest = $sorted[$i];
                $this->take($key, $rest, $i);
                $this->give($key, $rest - $len);
            } else {
                $this->give($key, Hcca::blockL() - $len);
            }
            unset($sorted);
        }
    }

    /** Empaquetado final (best-fit decreasing) de un conjunto de piezas. @param list<int> $pieces */
    public static function plan(array $pieces): CutPlan
    {
        return CutPlanner::plan($pieces);
    }

    private function take(string $key, int $rest, int $index): void
    {
        if (0 === --$this->count[$key][$rest]) {
            unset($this->count[$key][$rest]);
            array_splice($this->sorted[$key], $index, 1);
        }
    }

    private function give(string $key, int $rest): void
    {
        if ($rest <= 0) {
            return;
        }
        if (isset($this->count[$key][$rest])) {
            ++$this->count[$key][$rest];

            return;
        }
        $this->count[$key][$rest] = 1;
        $sorted = &$this->sorted[$key];
        array_splice($sorted, self::lowerBound($sorted, $rest), 0, [$rest]);
    }

    /** @param list<int> $sorted Primer índice con valor >= $v. */
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
