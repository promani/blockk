<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Hcca;
use App\Http\ClientConfig;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Catálogo de carpinterías en medidas comerciales y el vano modular de cada una. */
final class CommercialOpeningsTest extends TestCase
{
    #[Test]
    public function everyCommercialOpeningFitsInItsModularGapAndRespectsTheProjectLimits(): void
    {
        $list = Hcca::commercialOpenings();
        self::assertNotEmpty($list);
        self::assertSame(count($list), count(array_unique(array_column($list, 'id'))), 'ids únicos');
        foreach ($list as $c) {
            self::assertGreaterThanOrEqual(2, $c['w'], $c['id']);
            self::assertLessThanOrEqual(40, $c['w'], $c['id']);
            self::assertGreaterThanOrEqual(0, $c['sill'], $c['id']);
            self::assertLessThanOrEqual(7, $c['sill'], $c['id']);
            self::assertContains($c['mode'], $c['kind']->modes(), $c['id']);
            // el vano contiene la carpintería y no sobra más de un módulo
            $gapW = $c['w'] * Hcca::GRID_CM;
            $gapH = (Hcca::OPENING_TOP_COURSE - $c['sill']) * 25;
            self::assertGreaterThanOrEqual($c['cw'], $gapW, $c['id']);
            self::assertLessThan($c['cw'] + Hcca::GRID_CM, $gapW, $c['id']);
            self::assertGreaterThanOrEqual($c['ch'], $gapH, $c['id']);
            self::assertLessThan($c['ch'] + 25, $gapH, $c['id']);
        }
    }

    #[Test]
    public function theLabelShowsTheCommercialSizeAndTheGapAndTheClientGetsTheKindAsText(): void
    {
        $byId = array_column(Hcca::commercialOpenings(), null, 'id');
        self::assertSame('Ventana 120 × 110 (vano 125 × 125)', $byId['V120x110']['label']);
        self::assertSame('Puerta 80 × 200 (vano 87,5 × 200)', $byId['P80']['label']);
        self::assertSame(3, $byId['V120x110']['sill']);
        $client = array_column(ClientConfig::toArray()['commercial'], null, 'id');
        self::assertSame('window', $client['V120x110']['kind']);
        self::assertSame('gate', $client['PG240']['kind']);
    }
}
