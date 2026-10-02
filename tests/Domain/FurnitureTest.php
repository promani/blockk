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

/** Muebles simples: gabaritos que se guardan y se dibujan, pero no entran al cómputo ni a la Revisión. */
final class FurnitureTest extends TestCase
{
    /** @return array<string, mixed> */
    private static function furnished(): array
    {
        $data = Fixtures::room()->build();
        $data['levels'][0]['furniture'] = [
            ['id' => 'm1', 'kind' => 'cama2', 'x' => 4, 'y' => 4, 'rot' => 0],
            ['id' => 'm2', 'kind' => 'placard180', 'x' => 20, 'y' => 4, 'rot' => 1],
        ];

        return $data;
    }

    #[Test]
    public function furnitureSurvivesTheRoundTrip(): void
    {
        $p = (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray(self::furnished()))['project'];

        self::assertSame([['id' => 'm1', 'kind' => 'cama2', 'x' => 4, 'y' => 4, 'rot' => 0], ['id' => 'm2', 'kind' => 'placard180', 'x' => 20, 'y' => 4, 'rot' => 1]], $p['levels'][0]['furniture']);
        self::assertArrayNotHasKey('furniture', $p['levels'][1], 'sin muebles no se agrega la clave');
    }

    #[Test]
    public function unknownKindsAndBadTurnsAreRejected(): void
    {
        foreach ([['kind', 'trono'], ['rot', 7]] as [$key, $value]) {
            $data = self::furnished();
            $data['levels'][0]['furniture'][0][$key] = $value;
            try {
                ProjectFactory::fromArray($data);
                self::fail("se esperaba un rechazo por {$key}");
            } catch (InvalidProjectException $e) {
                self::assertStringContainsString("furniture[0].{$key}", implode(' ', $e->errors));
            }
        }
    }

    #[Test]
    public function furnitureDoesNotChangeTheBillOrTheReview(): void
    {
        $analyzer = new ProjectAnalyzer();
        $plain = $analyzer->analyze(Fixtures::build(Fixtures::room()))['analysis'];
        $with = $analyzer->analyze(ProjectFactory::fromArray(self::furnished()))['analysis'];

        self::assertSame($plain['bom']['total'], $with['bom']['total']);
        self::assertSame($plain['issues'], $with['issues']);
    }

    #[Test]
    public function theCatalogueIsShortSimpleAndReachesTheEditor(): void
    {
        $catalogue = Hcca::furniture();
        self::assertLessThanOrEqual(30, count($catalogue));
        foreach ($catalogue as $id => $f) {
            self::assertMatchesRegularExpression('/^[a-z][a-z0-9]{2,15}$/', $id);
            self::assertGreaterThanOrEqual(40, min($f['w'], $f['d']), $id);
            self::assertLessThanOrEqual(240, max($f['w'], $f['d']), $id);
            self::assertLessThanOrEqual(12, mb_strlen($f['short']), $id);
        }
        self::assertSame($catalogue, ClientConfig::toArray()['furniture']);
    }
}
