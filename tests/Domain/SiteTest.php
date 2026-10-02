<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Zonas del terreno (pileta, patio…) y árboles: se guardan y se dibujan, pero no entran al cómputo ni a la Revisión. */
final class SiteTest extends TestCase
{
    #[Test]
    public function zonesAndTreesSurviveTheRoundTrip(): void
    {
        $b = Fixtures::room()->zone(60, 4, 20, 30, 'pool', 'Pileta')->zone(50, 0, 40, 40, 'patio')->tree(100, 20, 'L')->tree(110, 60);
        $p = (new ProjectAnalyzer())->analyze(Fixtures::build($b))['project'];

        self::assertSame(['pool', 'Pileta', 20, 30], [$p['zones'][0]['kind'], $p['zones'][0]['name'], $p['zones'][0]['w'], $p['zones'][0]['h']]);
        self::assertSame('patio', $p['zones'][1]['kind']);
        self::assertSame(['L', 'M'], array_column($p['trees'], 'size'));
    }

    #[Test]
    public function unknownKindsAndSizesFallBackToTheUsualOne(): void
    {
        $data = Fixtures::room()->zone(60, 4, 20, 30)->tree(100, 20)->build();
        $data['zones'][0]['kind'] = 'helipuerto';
        $data['trees'][0]['size'] = 'XXL';
        $p = ProjectFactory::fromArray($data)->toArray();

        self::assertSame('patio', $p['zones'][0]['kind']);
        self::assertSame('M', $p['trees'][0]['size']);
    }

    #[Test]
    public function aZoneNeedsAUsableSize(): void
    {
        $data = Fixtures::room()->zone(60, 4, 20, 30)->build();
        $data['zones'][0]['w'] = 0;
        $this->expectException(InvalidProjectException::class);
        ProjectFactory::fromArray($data);
    }

    #[Test]
    public function theSiteDoesNotChangeTheBillOrTheReview(): void
    {
        $analyzer = new ProjectAnalyzer();
        $plain = $analyzer->analyze(Fixtures::build(Fixtures::room()))['analysis'];
        $withSite = $analyzer->analyze(Fixtures::build(Fixtures::room()->zone(60, 4, 20, 30, 'pool')->tree(100, 20, 'L')))['analysis'];

        self::assertSame($plain['bom']['total'], $withSite['bom']['total']);
        self::assertSame($plain['issues'], $withSite['issues']);
    }

    #[Test]
    public function theStreetSideIsKeptAndDefaultsToTheBottomOfThePlan(): void
    {
        $data = Fixtures::room()->build();
        unset($data['lot']['front']);
        self::assertSame('S', ProjectFactory::fromArray($data)->toArray()['lot']['front']);

        $data['lot'] = ['w' => 24, 'd' => 20, 'front' => 'E'];
        self::assertSame('E', ProjectFactory::fromArray($data)->toArray()['lot']['front']);

        $data['lot']['front'] = 'arriba';
        self::assertSame('S', ProjectFactory::fromArray($data)->toArray()['lot']['front']);
    }
}
