<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateBuilder;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class RoofFloorTest extends TestCase
{
    /** @return array<string, mixed> */
    private function analyze(TemplateBuilder $b): array
    {
        return (new ProjectAnalyzer())->analyze(Fixtures::build($b))['analysis'];
    }

    /** @param array<string, mixed> $a @return list<string> */
    private function codes(array $a): array
    {
        return array_column($a['issues'], 'code');
    }

    #[Test]
    public function aNewProjectHasNoUpperLevelUntilItIsAdded(): void
    {
        $data = Fixtures::room()->build();
        self::assertFalse(Fixtures::project($data)->upperEnabled());
        $data['upper'] = true;
        self::assertTrue(Fixtures::project($data)->upperEnabled());
        $walls = Fixtures::room(40, 30)->room(1, 0, 0, 40, 30)->build();
        self::assertTrue(Fixtures::project($walls)->upperEnabled(), 'Con muros en el Nivel 2 el nivel existe aunque no venga la marca');
        self::assertSame(1, Fixtures::project($walls)->topLevelIndex());
    }

    #[Test]
    public function gableRoofHasTwoPlanesRidgeRaftersAndGables(): void
    {
        $a = $this->analyze(Fixtures::room(40, 30)->roof('gable', 'x'));
        $roof = $a['roof'];

        self::assertSame('gable', $roof['parts'][0]['type']);
        self::assertCount(2, $roof['parts'][0]['geometry']['planes']);
        self::assertCount(2, $roof['parts'][0]['geometry']['gables']);
        // Luz 3,75 m, pendiente 30 %: cumbrera 3,00 + 0,5625 m sobre el coronamiento.
        self::assertEqualsWithDelta(56.25, $roof['parts'][0]['geometry']['riseCm'], 0.1);
        self::assertEqualsWithDelta(300.0, $roof['parts'][0]['geometry']['zTop'], 0.01);
        self::assertEqualsWithDelta(hypot(187.5 + 40, 56.25 + 12), $roof['parts'][0]['geometry']['rafterLenCm'], 0.2);
        // Largo de faldón 5,00 + 2 × 0,40 = 5,80 m → 13 cabios por faldón a 50 cm.
        self::assertSame(26, $roof['bom']['raftersCount']);
        self::assertEqualsWithDelta(2 * hypot(227.5, 68.25) * 580 / 10000, $roof['bom']['coverM2'], 0.05);
        self::assertEqualsWithDelta(3.75 * 0.5625, $roof['bom']['gableMasonryM2'], 0.01);
        self::assertNotContains('roof.rafter-span', $this->codes($a));
    }

    #[Test]
    public function shedRoofFallsTowardsTheChosenSideAndChecksTheRafterSpan(): void
    {
        $a = $this->analyze(Fixtures::room(40, 30)->roof('shed', 'S'));
        $planes = $a['roof']['parts'][0]['geometry']['planes'];

        self::assertCount(1, $planes);
        $ys = array_map(static fn (array $p): float => $p[1], $planes[0]['pts']);
        $zs = array_map(static fn (array $p): float => $p[2], $planes[0]['pts']);
        // Cae hacia el sur (y grande): el borde bajo está en y máx.
        $lowY = $ys[array_search(min($zs), $zs, true)];
        self::assertGreaterThan(min($ys), $lowY);
        self::assertContains('roof.rafter-span', $this->codes($a), 'Un cabio de 3,75 m con 3″×8″ a 50 cm excede la luz de referencia');

        $ok = $this->analyze(Fixtures::room(40, 30)->roof('shed', 'S', 30, '3x10'));
        self::assertNotContains('roof.rafter-span', $this->codes($ok));
    }

    #[Test]
    public function roofSitsOnTheHighestLevelAndItsBomIsPriced(): void
    {
        $b = Fixtures::room(30, 30)->joists(0, 0, 30, 30, 'x')->room(1, 0, 0, 30, 30)->roof('gable', 'x');
        $result = (new ProjectAnalyzer())->analyze(Fixtures::build($b));
        $a = $result['analysis'];

        self::assertEqualsWithDelta(600.0, $a['roof']['parts'][0]['geometry']['zTop'], 0.01);
        $codes = array_column($a['bom']['lines'], 'code');
        foreach (['CAB', 'CUM', 'CLA', 'CUB', 'HAS'] as $c) {
            self::assertNotEmpty(array_filter($codes, static fn (string $code): bool => str_starts_with($code, $c)), $c);
        }
        self::assertSame('gable', $a['telemetry']['roof']['count'] > 0 ? 'gable' : 'none');
    }

    #[Test]
    public function noRoofMeansNoGeometryOrLines(): void
    {
        $a = $this->analyze(Fixtures::room());

        self::assertSame([], $a['roof']['parts']);
        self::assertEmpty(array_filter(array_column($a['bom']['lines'], 'code'), static fn (string $c): bool => str_starts_with($c, 'CAB')));
    }

    #[Test]
    public function roofWarnsWhenTheEavesHaveNoBearingWall(): void
    {
        $b = (new TemplateBuilder('t'))->wall(0, 0, 0, 40, 0, 20.0)->wall(0, 0, 0, 0, 30, 20.0)->wall(0, 40, 0, 40, 30, 20.0)->roof('gable', 'x');

        self::assertContains('roof.support', $this->codes($this->analyze($b)));
    }

    #[Test]
    public function straightStairHasSixteenTreadsAndCutsAHoleInTheTimberFloor(): void
    {
        $b = Fixtures::room(60, 50)->upper()->stair(0, 2, 2, 'N', 'straight', 8)->joists(0, 0, 60, 50, 'x', '3x12')->room(1, 0, 0, 60, 50);
        $a = $this->analyze($b);
        $stair = $a['floors']['stairs'][0];

        self::assertCount(16, $stair['steps']);
        self::assertEqualsWithDelta(300 / 17, $stair['riseCm'], 0.01);
        self::assertEqualsWithDelta(300 - 300 / 17, max(array_column($stair['steps'], 'z')), 0.05, 'El último peldaño queda a una contrahuella del piso');
        self::assertEqualsWithDelta(100.0, $stair['bbox']['w'], 0.01);
        self::assertEqualsWithDelta(448.0, $stair['bbox']['h'], 0.01);
        self::assertNotContains('stair.outside', $this->codes($a));
        // La placa de entrepiso descuenta el hueco: 7,5 × 6,25 m − 1,00 × 4,48 m
        self::assertEqualsWithDelta(7.5 * 6.25 - 1.0 * 4.48, $a['timber']['fields'][0]['deckAreaM2'], 0.01);
    }

    #[Test]
    public function lAndUStairsHaveALandingAtHalfHeight(): void
    {
        foreach (['L' => 15, 'U' => 15] as $shape => $treads) {
            $a = $this->analyze(Fixtures::room(60, 50)->upper()->stair(0, 2, 2, 'N', $shape, 8));
            $stair = $a['floors']['stairs'][0];

            self::assertCount($treads, $stair['steps'], "Escalera en $shape: 8 + 7 peldaños");
            self::assertCount(1, $stair['landings']);
            self::assertEqualsWithDelta(9 * 300 / 17, $stair['landings'][0]['z'], 0.05);
            $l = $stair['landings'][0];
            self::assertEqualsWithDelta('L' === $shape ? 1.0 : 2.0, ($l['x1'] - $l['x0']) * ($l['y1'] - $l['y0']) / 10000, 0.001, 'Descanso: 1,00 × 1,00 m (L) o 1,00 × 2,00 m (U)');
        }
    }

    #[Test]
    public function stairsMustStayInsideAClosedRoomAndInformIfThereIsNoUpperLevel(): void
    {
        $outside = $this->analyze(Fixtures::room(20, 20)->upper()->stair(0, 2, 2, 'N', 'straight', 8));
        self::assertContains('stair.outside', $this->codes($outside), 'Una escalera de 4,5 m no entra en un cuarto de 2,5 m');

        $noUpper = $this->analyze(Fixtures::room(60, 50)->stair(0, 2, 2));
        self::assertContains('stair.noupper', $this->codes($noUpper));
    }

    #[Test]
    public function slabMustSitInsideTheRoomsBelowAndSubtractsTheStairHole(): void
    {
        $inside = $this->analyze(Fixtures::room(40, 30)->upper()->slab(1, 0, 0, 40, 30));
        self::assertNotContains('slab.outside', $this->codes($inside));
        self::assertEqualsWithDelta(18.75, $inside['floors']['slabs'][0]['areaM2'], 0.01);

        $smaller = $this->analyze(Fixtures::room(40, 30)->upper()->slab(1, 5, 5, 20, 20));
        self::assertNotContains('slab.outside', $this->codes($smaller));

        $bigger = $this->analyze(Fixtures::room(40, 30)->upper()->slab(1, 0, 0, 50, 30));
        self::assertContains('slab.outside', $this->codes($bigger));

        $withStair = $this->analyze(Fixtures::room(60, 50)->upper()->stair(0, 2, 2, 'N', 'straight', 8)->slab(1, 0, 0, 60, 50));
        self::assertEqualsWithDelta(60 * 12.5 / 100 * 50 * 12.5 / 100 - 1.0 * 4.48, $withStair['floors']['slabs'][0]['areaM2'], 0.01);
    }

    #[Test]
    public function slabBomHasConcreteMeshAndFormworkAndCountsAsUpperFloor(): void
    {
        $b = Fixtures::room(30, 30)->upper()->slab(1, 0, 0, 30, 30)->room(1, 0, 0, 30, 30);
        $a = $this->analyze($b);
        $codes = array_column($a['bom']['lines'], 'code');

        foreach (['LHO', 'LML', 'LEN'] as $c) {
            self::assertContains($c, $codes);
        }
        self::assertNotContains('timber.missing', $this->codes($a), 'La losa es el piso del Nivel 2');
        $lho = array_values(array_filter($a['bom']['lines'], static fn (array $l): bool => 'LHO' === $l['code']))[0];
        self::assertEqualsWithDelta(3.75 * 3.75 * 0.12, $lho['qty'], 0.01);
    }

    #[Test]
    public function slabAndTimberFloorCannotOverlap(): void
    {
        $b = Fixtures::room(30, 30)->upper()->joists(0, 0, 30, 30, 'x')->slab(1, 0, 0, 30, 30);

        self::assertContains('floor.overlap', $this->codes($this->analyze($b)));
    }

    #[Test]
    public function rejectsInvalidRoofAndStairParameters(): void
    {
        $data = Fixtures::room()->build();
        $data['roof'] = ['type' => 'gable', 'section' => '9x9'];
        try {
            ProjectFactory::fromArray($data);
            self::fail('sección inválida');
        } catch (InvalidProjectException $e) {
            self::assertStringContainsString('roof.section', implode(' ', $e->errors));
        }

        $data = Fixtures::room()->stair(0, 1, 1, 'N', 'straight', 4)->build(); // 50 cm de ancho: demasiado angosta
        $this->expectException(InvalidProjectException::class);
        ProjectFactory::fromArray($data);
    }

    #[Test]
    public function roofsAreIndependentRectanglesOnDifferentLevels(): void
    {
        // Planta baja 40×30 y planta alta sólo sobre la mitad izquierda: un techo sobre la parte baja y otro sobre la alta.
        $b = Fixtures::room(40, 30)->room(1, 0, 0, 20, 30)
            ->roofPart(1, 0, 0, 20, 30, 'gable', 'y')
            ->roofPart(0, 20, 0, 20, 30, 'shed', 'E');
        $a = $this->analyze($b);
        $parts = $a['roof']['parts'];

        self::assertCount(2, $parts);
        self::assertEqualsWithDelta(600.0, $parts[0]['geometry']['zTop'], 0.01);
        self::assertEqualsWithDelta(300.0, $parts[1]['geometry']['zTop'], 0.01);
        self::assertSame(2, $a['telemetry']['roof']['count']);
        self::assertEqualsWithDelta($parts[0]['bom']['coverM2'] + $parts[1]['bom']['coverM2'], $a['roof']['bom']['coverM2'], 0.02);
    }

    #[Test]
    public function gablesCanBeRemovedAndTheirBlocksFollowTheThickness(): void
    {
        $full = $this->analyze(Fixtures::room(40, 30)->roofPart(0, 0, 0, 40, 30));
        $noA = $this->analyze(Fixtures::room(40, 30)->roofPart(0, 0, 0, 40, 30, more: ['gableA' => false, 'gableT' => 15]));

        $g = $noA['roof']['parts'][0]['geometry']['gables'];
        self::assertFalse($g[0]['enabled']);
        self::assertSame(0, $g[0]['blocks']);
        self::assertTrue($g[1]['enabled']);
        self::assertEqualsWithDelta($full['roof']['bom']['gableMasonryM2'] / 2, $noA['roof']['bom']['gableMasonryM2'], 0.01);
        self::assertContains('HAS-15', array_column($noA['bom']['lines'], 'code'));
        self::assertContains('HAS-20', array_column($full['bom']['lines'], 'code'));
    }

    #[Test]
    public function legacySingleRoofIsConvertedToARectangleOverTheTopLevel(): void
    {
        $p = Fixtures::project(Fixtures::room(40, 30)->roof('gable', 'x')->build());

        self::assertCount(1, $p->roofs);
        self::assertSame([0, 0, 40, 30, 0], [$p->roofs[0]->x, $p->roofs[0]->y, $p->roofs[0]->w, $p->roofs[0]->h, $p->roofs[0]->level]);
    }

    #[Test]
    public function roomsExposeTheirFillAndCornersForEditing(): void
    {
        $a = $this->analyze(Fixtures::room(40, 30));
        $room = $a['levels'][0]['rooms'][0];

        self::assertSame([[0, 0, 40, 30]], $room['fill']);
        self::assertEqualsCanonicalizing([[0, 0], [40, 0], [40, 30], [0, 30]], $room['corners']);

        // Habitación en L: 6 esquinas y el relleno cubre exactamente las celdas.
        $l = (new TemplateBuilder('l'))->wall(0, 0, 0, 40, 0, 20.0)->wall(0, 40, 0, 40, 15, 20.0)->wall(0, 40, 15, 20, 15, 20.0)->wall(0, 20, 15, 20, 30, 20.0)->wall(0, 20, 30, 0, 30, 20.0)->wall(0, 0, 30, 0, 0, 20.0);
        $r = $this->analyze($l)['levels'][0]['rooms'][0];
        self::assertCount(6, $r['corners']);
        self::assertSame(40 * 15 + 20 * 15, array_sum(array_map(static fn (array $f): int => $f[2] * $f[3], $r['fill'])));
    }

    #[Test]
    public function aRoofUnderUpperWallsIsFlagged(): void
    {
        $b = Fixtures::room(40, 30)->room(1, 0, 0, 40, 30)->roofPart(0, 0, 0, 40, 30);
        self::assertContains('roof.covered', $this->codes($this->analyze($b)));
        $ok = Fixtures::room(40, 30)->room(1, 0, 0, 40, 30)->roofPart(1, 0, 0, 40, 30);
        self::assertNotContains('roof.covered', $this->codes($this->analyze($ok)));
    }
}
