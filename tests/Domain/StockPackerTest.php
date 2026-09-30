<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Cutting\StockPacker;
use App\Domain\Hcca;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class StockPackerTest extends TestCase
{
    /** Estos casos fijan números del módulo genérico de 62,5 cm; Lika tiene los suyos en LikaBlocksTest. */
    protected function setUp(): void
    {
        Hcca::useSystem('generico');
    }

    protected function tearDown(): void
    {
        Hcca::useSystem('lika');
    }

    #[Test]
    public function complementaryCutsShareOneBlockWithoutWaste(): void
    {
        // 42,5 cm + 20 cm = 62,5 cm: el sobrante de un corte es la jamba del otro.
        $plan = StockPacker::plan([850, 400]);

        self::assertSame(1, $plan->blocks());
        self::assertSame(0, $plan->scrapTicks());
    }

    #[Test]
    public function reusesLeftoversAcrossManyCuts(): void
    {
        $plan = StockPacker::plan([500, 500, 500, 500, 750, 750]); // 25×4 + 37,5×2

        self::assertSame(3, $plan->blocks()); // (37,5+25) ×2 + (25+25)
        self::assertSame(250 * 1, $plan->scrapTicks());
    }

    #[Test]
    public function neverExceedsTheBlockLengthPerBin(): void
    {
        $pieces = [1000, 875, 625, 500, 400, 375, 250, 250, 1100, 300, 300];
        $plan = StockPacker::plan($pieces);

        $total = 0;
        foreach ($plan->bins as $bin) {
            self::assertLessThanOrEqual(1250, array_sum($bin['cuts']));
            self::assertSame(1250, array_sum($bin['cuts']) + $bin['rest']);
            $total += array_sum($bin['cuts']);
        }
        self::assertSame(array_sum($pieces), $total, 'Ninguna pieza se pierde ni se duplica');
    }

    #[Test]
    public function onlinePackerCountsNewBinsWithoutMutatingState(): void
    {
        $packer = new StockPacker();
        $packer->commit('B:400', [850]); // deja 400 libres
        self::assertSame(0, $packer->newBinsFor('B:400', [400]));
        self::assertSame(1, $packer->newBinsFor('B:400', [500]));
        self::assertSame(1, $packer->newBinsFor('U:400', [100]), 'Otro tipo de bloque no comparte remanentes');
        self::assertSame(0, $packer->newBinsFor('B:400', [400]), 'newBinsFor no modifica el estado');
    }

    #[Test]
    public function patternsAreGroupedAndSortedByFrequency(): void
    {
        $plan = StockPacker::plan([850, 400, 850, 400, 1000, 250]);

        $patterns = $plan->patterns();
        self::assertSame([42.5, 20.0], $patterns[0]['pattern']);
        self::assertSame(2, $patterns[0]['blocks']);
    }

    #[Test]
    public function planBestNeverNeedsMoreBlocksThanPackingEachGroupSeparately(): void
    {
        // Cada grupo entra en un solo bloque; best-fit sobre la unión abriría 3 (heurística no monótona).
        $groups = [[375, 250, 625], [500, 500, 250]];

        self::assertSame(3, StockPacker::plan([...$groups[0], ...$groups[1]])->blocks(), 'La heurística sola no es monótona');
        $best = \App\Domain\Cutting\CutPlanner::planBest($groups);
        self::assertLessThanOrEqual(2, $best->blocks());
        self::assertSame(array_sum(array_map('array_sum', $groups)), array_sum(array_map(static fn (array $b): int => array_sum($b['cuts']), $best->bins)));
    }
}
