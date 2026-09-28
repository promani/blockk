<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Bom\QuickCalculator;
use App\Domain\Hcca;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateBuilder;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class BomCalculatorTest extends TestCase
{
    /** @return array<string, mixed> */
    private function bom(TemplateBuilder $b): array
    {
        return (new ProjectAnalyzer())->analyze(Fixtures::build($b))['analysis']['bom'];
    }

    #[Test]
    public function wallAreaMatchesTheManualComputationExactly(): void
    {
        // Sala 5,00 × 3,75 m a ejes, muros de 20 cm, 12 hiladas de 25 cm, sin vanos:
        // perímetro a ejes 17,5 m × 3,00 m = 52,5 m². (Exactitud del cómputo ≥ 98 % del manual.)
        $bom = $this->bom(Fixtures::room(40, 30, 20.0));

        self::assertEqualsWithDelta(52.5, $bom['total']['wallAreaM2'], 0.01);
        self::assertEqualsWithDelta(17.5, $bom['total']['wallLengthM'], 0.001);
    }

    #[Test]
    public function blockCountsAreConsistentBetweenPiecesAndStock(): void
    {
        $bom = $this->bom(Fixtures::room(40, 30, 20.0)->opening(0, 'P100', 'x', 30, 14));

        foreach ($bom['total']['blocks'] as $b) {
            self::assertSame($b['pieces'], $b['full'] + $b['cutPieces']);
            self::assertSame($b['stock'], $b['full'] + $b['cutBlocks']);
            self::assertSame($b['order'], $b['stock'] + $b['reserve']);
            self::assertLessThanOrEqual($b['cutPieces'], $b['cutBlocks'], 'Nunca se corta más de un bloque por pieza cortada');
        }
        // Un corte nunca necesita más bloques que piezas cortadas: el reaprovechamiento sólo puede mejorar.
        self::assertLessThanOrEqual($bom['total']['noReuseStock'], $bom['total']['stock']);
    }

    #[Test]
    public function reserveIsAppliedOnTopOfTheTheoreticalStock(): void
    {
        $data = Fixtures::room(40, 30, 20.0)->build();
        $data['settings']['reservePct'] = 10;
        $bom = (new ProjectAnalyzer())->analyze(Fixtures::project($data))['analysis']['bom'];

        foreach ($bom['total']['blocks'] as $b) {
            self::assertSame((int) ceil($b['stock'] * 0.10), $b['reserve']);
        }
    }

    #[Test]
    public function palletsAreCompletePlusLooseAndRoundUp(): void
    {
        $bom = $this->bom(Fixtures::room(60, 40, 20.0));

        foreach ($bom['total']['blocks'] as $b) {
            $p = $b['pallets'];
            self::assertSame($b['order'], $p['full'] * $p['capacity'] + $p['loose']);
            self::assertSame((int) ceil($b['order'] / $p['capacity']), $p['total']);
            $palletM3 = $p['capacity'] * $b['unitM3'];
            self::assertGreaterThanOrEqual(1.40, $palletM3, 'Pallet dentro del rango 1,44–1,80 m³');
            self::assertLessThanOrEqual(1.80, $palletM3);
        }
    }

    #[Test]
    public function adhesiveFollowsTheThicknessRateAndCementLevelsTheFirstCourse(): void
    {
        $bom = $this->bom(Fixtures::room(40, 30, 20.0));
        $m = $bom['total']['mortar'];

        // 52,5 m² × 2,5 kg/m² (espesor 20 cm)
        self::assertEqualsWithDelta(52.5 * 2.5, $m['adhesiveKg'], 0.5);
        self::assertSame((int) ceil($m['adhesiveKg'] / 25), $m['adhesiveBags']);
        // Nivelación: 17,5 m de muro × 0,20 m × 0,02 m × 1900 kg/m³
        self::assertEqualsWithDelta(17.5 * 0.20 * 0.02 * 1900, $m['levelingKg'], 1.0);
    }

    #[Test]
    public function lintelsAndCrownGenerateUBlocksConcreteAndRebar(): void
    {
        $bom = $this->bom(Fixtures::room(40, 30, 20.0)->opening(0, 'P100', 'x', 30, 14));
        $total = $bom['total'];

        $u = array_values(array_filter($total['blocks'], static fn (array $b): bool => 'U' === $b['kind']));
        self::assertNotSame([], $u);
        self::assertGreaterThan(0, $total['concreteM3']);
        self::assertGreaterThan(0, $total['rebar']['d10Kg'], 'Encadenado superior 2 Ø10');
        self::assertGreaterThan(0, $total['rebar']['d8Kg'], 'Dintel 2 Ø8');
        // Corona: 17,5 m × 2 barras = 35 m de Ø10
        self::assertEqualsWithDelta(35.0, $total['rebar']['d10M'], 0.1);
    }

    #[Test]
    public function teesAndCrossesAddMetalAnchors(): void
    {
        $bom = $this->bom(Fixtures::room(40, 30, 20.0)->wall(0, 20, 0, 20, 30, 10.0));

        self::assertSame(2 * Hcca::ANCHORS_PER_TEE, $bom['total']['anchors'], 'Un tabique en T con cada muro exterior → 2 encuentros');
    }

    #[Test]
    public function totalOptimizesCutsAcrossLevelsSoItNeverExceedsTheSumOfLevels(): void
    {
        $b = Fixtures::room(40, 30, 20.0)->room(1, 0, 0, 40, 30, 20.0);
        $bom = $this->bom($b);

        $sumOfLevels = array_sum(array_map(static fn (array $l): int => $l['stock'], $bom['levels']));
        self::assertLessThanOrEqual($sumOfLevels, $bom['total']['stock']);
    }

    #[Test]
    public function scrapStaysUnderTheProductTargetOnModularRooms(): void
    {
        foreach ([[40, 30], [60, 40], [50, 35], [75, 55]] as [$w, $h]) {
            $bom = $this->bom(Fixtures::room($w, $h, 20.0));
            self::assertLessThan(4.0, $bom['total']['scrapPct'], "Descarte de la sala {$w}×{$h} debe ser < 4 %");
        }
    }

    #[Test]
    public function pricedLinesAddUpToTheTotalCost(): void
    {
        $bom = $this->bom(Fixtures::room(40, 30, 20.0)->opening(0, 'P100', 'x', 30, 14)->joists(0, 0, 30, 30, 'x'));

        $sum = array_sum(array_column($bom['lines'], 'subtotal'));
        self::assertEqualsWithDelta($bom['totalCost'], $sum, 0.05);
        self::assertGreaterThan(0, $bom['totalCost']);
        foreach ($bom['lines'] as $l) {
            self::assertEqualsWithDelta($l['subtotal'], $l['qty'] * $l['unitPrice'], 0.006, 'La planilla cierra: cantidad × precio unitario = subtotal');
        }
    }

    #[Test]
    public function customPricesOverrideTheDefaults(): void
    {
        $data = Fixtures::room(40, 30, 20.0)->build();
        $data['settings']['prices'] = ['block_m3' => 200.0, 'unknown_key' => 1.0];
        $bom = (new ProjectAnalyzer())->analyze(Fixtures::project($data))['analysis']['bom'];

        $b20 = array_values(array_filter($bom['lines'], static fn (array $l): bool => 'B20' === $l['code']))[0];
        self::assertEqualsWithDelta(200.0 * 0.625 * 0.25 * 0.20, $b20['unitPrice'], 0.006);
    }

    #[Test]
    public function quickCalculatorMatchesTheManualPanelComputation(): void
    {
        $r = (new QuickCalculator())->panel(5.0, 2.75, 20.0, 0.0, 5);

        self::assertEqualsWithDelta(13.75, $r['areaM2'], 0.001);
        self::assertSame(93, $r['blocks']);      // 13,75 / 0,15625 × 1,05 = 92,4 → 93
        self::assertSame(11, $r['courses']);
        self::assertSame(2, $r['adhesiveBags']); // 34,4 kg / 25
    }

    #[Test]
    public function quickCalculatorRejectsInvalidInput(): void
    {
        $calc = new QuickCalculator();
        $this->expectException(\InvalidArgumentException::class);
        $calc->panel(5.0, 2.75, 12.0);
    }
}
