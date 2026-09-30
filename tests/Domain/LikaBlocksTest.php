<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Hcca;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Http\ClientConfig;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Sistema por defecto: bloques Lika de 50 × 25 cm (manual técnico en docs/). */
final class LikaBlocksTest extends TestCase
{
    /** @return array<string, mixed> */
    private function analyze(\App\Domain\Templates\TemplateBuilder $b): array
    {
        return (new ProjectAnalyzer())->analyze(Fixtures::build($b))['analysis'];
    }

    #[Test]
    public function theDefaultSystemIsLikaWithFiftyCentimetreBlocks(): void
    {
        self::assertSame('lika', Hcca::system()['id']);
        self::assertSame(1000, Hcca::blockL());
        self::assertSame(4, Hcca::blockUnits());
        self::assertSame([10.0, 15.0, 20.0], Hcca::thicknesses());
        self::assertSame(4, ClientConfig::toArray()['blockUnits']);
        self::assertSame(50.0, ClientConfig::toArray()['blockL']);
    }

    #[Test]
    public function everyPieceFitsInALikaBlockAndAPlainWallUsesAboutEightBlocksPerSquareMetre(): void
    {
        $a = $this->analyze(Fixtures::room(40, 32, 20.0));
        foreach ($a['levels'][0]['courses'] as $runs) {
            foreach ($runs as $run) {
                foreach ($run['pieces'] as [$p0, $p1]) {
                    // el análisis sale en cm
                    self::assertLessThanOrEqual(50, $p1 - $p0);
                    self::assertGreaterThanOrEqual(Hcca::MIN_PIECE / Hcca::TICKS_PER_CM, $p1 - $p0);
                }
            }
        }
        $b20 = array_values(array_filter($a['bom']['total']['blocks'], static fn (array $b): bool => 'B20' === $b['code']))[0];
        // 5,00 × 4,00 m a ejes: 18 m × 2,75 m de bloque macizo (11 hiladas) = 49,5 m² → ~8 bloques por m²
        self::assertEqualsWithDelta(8.0, $b20['pieces'] / 49.5, 0.6);
        self::assertStringContainsString('Lika 50 × 25 × 20 cm', $b20['label']);
        self::assertSame([], array_values(array_filter($a['issues'], static fn (array $i): bool => 'bond' === $i['code'])));
    }

    #[Test]
    public function palletsAndAdhesiveFollowTheManual(): void
    {
        self::assertSame(120, Hcca::palletCapacity('B', 200));
        self::assertSame(72, Hcca::palletCapacity('B', 300));
        self::assertSame(60, Hcca::palletCapacity('B', 400));
        self::assertSame(42, Hcca::palletCapacity('U', 300));
        self::assertSame(40, Hcca::palletCapacity('U', 400));
        self::assertSame(3.25, Hcca::adhesiveRate(200));
        self::assertSame(4.70, Hcca::adhesiveRate(300));
        self::assertSame(6.25, Hcca::adhesiveRate(400));

        $bom = $this->analyze(Fixtures::room(40, 32, 20.0))['bom'];
        foreach ($bom['total']['blocks'] as $b) {
            self::assertSame('U' === $b['kind'] ? 40 : 60, $b['pallets']['capacity']);
        }
    }

    #[Test]
    public function partitionsWithoutAUBlockGetAnInSituConcreteLintel(): void
    {
        $bom = $this->analyze(Fixtures::room(40, 32, 20.0)->wall(0, 20, 0, 20, 32, 10)->opening(0, 'P75', 'y', 20, 8))['bom'];
        $u10 = array_values(array_filter($bom['total']['blocks'], static fn (array $b): bool => 'U10' === $b['code']));
        self::assertCount(1, $u10);
        self::assertStringContainsString('hormigón armado in situ', $u10[0]['label']);
        self::assertFalse(Hcca::hasUBlock(200));
        self::assertTrue(Hcca::hasUBlock(300));
    }

    #[Test]
    public function thicknessesLikaDoesNotMakeAreRejected(): void
    {
        $this->expectException(InvalidProjectException::class);
        ProjectFactory::fromArray(Fixtures::room(40, 32, 7.5)->build());
    }

    #[Test]
    public function theGenericSystemIsStillAvailable(): void
    {
        Hcca::useSystem('generico');
        try {
            self::assertSame(1250, Hcca::blockL());
            self::assertSame(5, Hcca::blockUnits());
            $a = $this->analyze(Fixtures::room(40, 30, 20.0));
            self::assertStringContainsString('62,5 × 25 × 20', $a['bom']['total']['blocks'][0]['label']);
        } finally {
            Hcca::useSystem('lika');
        }
    }
}
