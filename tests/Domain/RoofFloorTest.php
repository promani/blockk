<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateBuilder;
use App\Tests\Support\Fixtures;
use App\Domain\Hcca;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class RoofFloorTest extends TestCase
{
    protected function tearDown(): void
    {
        Hcca::useSystem('lika');
    }

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
        // El alero va sólo en la caída; en los hastiales la cubierta llega a la cara del muro (5,00 + 2 × 0,10 m) → 12 cabios por faldón.
        self::assertSame(24, $roof['bom']['raftersCount']);
        self::assertEqualsWithDelta(2 * hypot(227.5, 68.25) * 520 / 10000, $roof['bom']['coverM2'], 0.05);
        // Dos hastiales de 3,75 m: triángulo de 56,25 cm más la faja de 4 cm hasta el apoyo de los cabios.
        self::assertEqualsWithDelta(2 * 3.75 * (0.5625 / 2 + 0.04), $roof['bom']['gableMasonryM2'], 0.01);
        self::assertNotContains('roof.rafter-span', $this->codes($a));
    }

    #[Test]
    public function shedRoofFallsTowardsTheChosenSideAndPicksTheRafterSection(): void
    {
        $a = $this->analyze(Fixtures::room(40, 30)->roof('shed', 'S'));
        $planes = $a['roof']['parts'][0]['geometry']['planes'];

        self::assertCount(1, $planes);
        $ys = array_map(static fn (array $p): float => $p[1], $planes[0]['pts']);
        $zs = array_map(static fn (array $p): float => $p[2], $planes[0]['pts']);
        // Cae hacia el sur (y grande): el borde bajo está en y máx.
        $lowY = $ys[array_search(min($zs), $zs, true)];
        self::assertGreaterThan(min($ys), $lowY);
        // Un cabio de 3,75 m no lo cubre el 3″×8″ a 50 cm: se usa solo el 3″×10″, sin observaciones.
        self::assertSame('3x10', $a['roof']['parts'][0]['bom']['section']);
        self::assertSame([], array_values(array_filter($this->codes($a), static fn (string $c): bool => str_starts_with($c, 'roof.'))));
    }

    #[Test]
    public function roofSitsOnTheHighestLevelAndItsBomIsPriced(): void
    {
        $b = Fixtures::room(30, 30)->joists(0, 0, 30, 30, 'x')->room(1, 0, 0, 30, 30)->roof('gable', 'x');
        $result = (new ProjectAnalyzer())->analyze(Fixtures::build($b));
        $a = $result['analysis'];

        self::assertEqualsWithDelta(600.0, $a['roof']['parts'][0]['geometry']['zTop'], 0.01);
        $codes = array_column($a['bom']['lines'], 'code');
        foreach (['CAB', 'CUM', 'CLA', 'CUB'] as $c) {
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
    public function roofsHaveNoReviewNotes(): void
    {
        // Los techos son para ver la casa completa y computar la madera: no generan observaciones.
        $b = (new TemplateBuilder('t'))->wall(0, 0, 0, 40, 0, 20.0)->wall(0, 0, 0, 0, 30, 20.0)->wall(0, 40, 0, 40, 30, 20.0)->roof('gable', 'x');

        self::assertSame([], array_values(array_filter($this->codes($this->analyze($b)), static fn (string $c): bool => str_starts_with($c, 'roof.'))));
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
        // Los bloques del hastial de 15 cm aparecen como una línea de mampostería propia (los muros son de 20 cm).
        self::assertContains('B15', array_column($noA['bom']['lines'], 'code'));
        self::assertNotContains('B15', array_column($full['bom']['lines'], 'code'));
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
    public function aRoofSitsOnTheWallsAroundItWhateverLevelWasSaved(): void
    {
        // Guardado sobre el Nivel 1 pero rodeado por muros del Nivel 2: apoya arriba.
        $b = Fixtures::room(40, 30)->joists(0, 0, 40, 30, 'x')->room(1, 0, 0, 40, 30)->roofPart(0, 0, 0, 40, 30);
        $part = $this->analyze($b)['roof']['parts'][0];
        self::assertSame(1, $part['level']);
        self::assertEqualsWithDelta(600.0, $part['geometry']['zTop'], 0.01);

        // Guardado sobre el Nivel 2 sobre la parte baja (el caso de un techo dibujado con el Nivel 2 activo): apoya abajo.
        $low = Fixtures::room(64, 40)->wall(0, 32, 0, 32, 40, 20)->joists(0, 0, 32, 40, 'x')->room(1, 0, 0, 32, 40)->roofPart(1, 32, 0, 32, 40, 'shed', 'E');
        $part = $this->analyze($low)['roof']['parts'][0];
        self::assertSame(0, $part['level']);
        self::assertEqualsWithDelta(300.0, $part['geometry']['zTop'], 0.01);
    }

    #[Test]
    public function gableBlocksAreLaidCourseByCourseAndAddedToTheTotals(): void
    {
        Hcca::useSystem('generico'); // números del módulo de 62,5 cm (y espesor de 7,5)
        // Luz 3,75 m, pendiente 30 %: altura 56,25 cm + 4 cm de apoyo de los cabios sobre el borde exterior del muro →
        // 3 hiladas de ancho 375 / 235 / 68,3 cm, con traba de medio bloque sobre una misma grilla desde el arranque (como un
        // muro): la 2.ª empieza cortada para caer medio bloque corrida y la 3.ª se parte en la junta de la grilla.
        $with = $this->analyze(Fixtures::room(40, 30)->roofPart(0, 0, 0, 40, 30, 'gable', 'x'));
        $without = $this->analyze(Fixtures::room(40, 30)->roofPart(0, 0, 0, 40, 30, 'gable', 'x', more: ['gableA' => false, 'gableB' => false]));
        $g = $with['roof']['parts'][0]['geometry']['gables'][0];

        self::assertCount(3, $g['courses']);
        self::assertSame([1250, 1250, 1250, 1250, 1250, 1250], $g['courses'] === [] ? [] : array_slice($g['pieces'], 0, 6));
        self::assertSame([475, 1250, 1250, 1250, 475, 683, 684], array_slice($g['pieces'], 6));
        self::assertSame([93.75, 156.25, 218.75, 281.25], $g['courses'][1]['joints'], 'juntas de la 2.ª hilada: medio bloque corridas de las de la 1.ª (62,5 · n)');
        self::assertSame(9, $g['fullBlocks']);
        self::assertSame(4, $g['cutPieces']);

        $stock = static fn (array $a): int => $a['bom']['total']['stock'];
        self::assertGreaterThanOrEqual(20, $stock($with) - $stock($without), 'Dos hastiales: al menos sus 20 bloques enteros (los cortes pueden salir de sobrantes de los muros)');
        self::assertLessThanOrEqual(20 + 6, $stock($with) - $stock($without));
        self::assertSame($with['bom']['levels'][0]['stock'], $with['telemetry']['levels'][0]['blocks']);
        self::assertGreaterThan($without['telemetry']['total']['blocks'], $with['telemetry']['total']['blocks']);
        self::assertGreaterThan($without['bom']['totalCost'], $with['bom']['totalCost']);
    }

    #[Test]
    public function shedRoofRaisesAHighWallWithBlocks(): void
    {
        Hcca::useSystem('generico'); // números del módulo de 62,5 cm (y espesor de 7,5)
        $a = $this->analyze(Fixtures::room(40, 30)->roofPart(0, 0, 0, 40, 30, 'shed', 'S', 30, '3x10'));
        $h = array_values(array_filter($a['roof']['parts'][0]['geometry']['gables'], static fn (array $g): bool => 'H' === $g['side']))[0];

        // Muro alto de 5,00 m sobre el lado norte, 1,125 m de alto: 5 hiladas; la primera con 8 bloques enteros.
        self::assertTrue($h['fixed']);
        self::assertCount(5, $h['courses']);
        self::assertSame(8, count(array_filter(array_slice($h['pieces'], 0, 8), static fn (int $l): bool => 1250 === $l)));
        self::assertGreaterThan(30, $h['blocks']);
    }

    #[Test]
    public function crossingRoofsKeepOnlyTheHigherSurface(): void
    {
        // Dos techos a dos aguas cruzados sobre la misma planta: forman una cruz; no se cuenta cubierta dos veces.
        $one = $this->analyze(Fixtures::room(40, 40)->roofPart(0, 0, 0, 40, 40, 'gable', 'x'));
        $cross = $this->analyze(Fixtures::room(40, 40)->roofPart(0, 0, 0, 40, 40, 'gable', 'x')->roofPart(0, 0, 0, 40, 40, 'gable', 'y'));

        foreach ($cross['roof']['parts'] as $p) {
            // cada uno queda mitad debajo del otro, salvo los aleros (que asoman por los extremos del otro)
            self::assertEqualsWithDelta(55.0, $p['bom']['visiblePct'], 6.0);
        }
        // No se cuenta dos veces: la cruz suma sólo los aleros que asoman (mucho menos que dos techos enteros).
        self::assertGreaterThan($one['roof']['bom']['coverM2'], $cross['roof']['bom']['coverM2']);
        self::assertLessThan(1.2 * $one['roof']['bom']['coverM2'], $cross['roof']['bom']['coverM2']);
    }

    #[Test]
    public function aLowerRoofInsideAHigherOneDisappears(): void
    {
        $a = $this->analyze(Fixtures::room(40, 30)->roofPart(0, 0, 0, 40, 30, 'gable', 'x')->roofPart(0, 10, 10, 10, 10, 'shed', 'S', 10));
        [$big, $small] = $a['roof']['parts'];

        self::assertSame(100.0, (float) $big['bom']['visiblePct']);
        self::assertSame(0.0, (float) $small['bom']['coverM2']);
        self::assertSame(0, $small['bom']['raftersCount']);
        self::assertSame(0, array_sum(array_map(static fn (array $g): int => $g['blocks'], $small['geometry']['gables'])), 'Sus hastiales quedan debajo del techo alto: no se construyen');
    }

    #[Test]
    public function aLowerRoofAgainstAnUpperWallHasNoOverhangNorGableThere(): void
    {
        $p = (new TemplateBuilder('Evolutiva'))
            ->room(0, 0, 0, 64, 40)->wall(0, 32, 0, 32, 40, 20)
            ->room(1, 0, 0, 32, 40)->joists(0, 0, 32, 40, 'x')->upper()
            ->roofPart(1, 0, 0, 32, 40, 'gable', 'y')
            ->roofPart(0, 32, 0, 32, 40, 'shed', 'E', 30, '3x10')
            ->build();
        $parts = (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($p))['analysis']['roof']['parts'];
        $low = array_values(array_filter($parts, static fn (array $r): bool => 0 === $r['level']))[0]['geometry'];

        self::assertSame(410.0, (float) $low['outer']['x0'], 'contra la pared de la PA: termina en su cara (eje + 10 cm), sin alero');
        self::assertSame(840.0, (float) $low['outer']['x1'], 'del lado libre: alero de 40 cm');
        self::assertSame(-10.0, (float) $low['outer']['y0'], 'en los extremos la cubierta llega a la cara del muro, sin alero');
        self::assertNotContains('H', array_column($low['gables'], 'side'), 'sin muro alto: lo cierra la pared de la PA');
        // El alero de la planta alta vuela sobre el techo bajo sin recortarlo: el techo bajo llega entero a la pared.
        $lowPart = array_values(array_filter($parts, static fn (array $r): bool => 0 === $r['level']))[0];
        self::assertSame(100.0, (float) $lowPart['bom']['visiblePct']);
    }

    #[Test]
    public function aWindowInAGableLeavesItsOpeningAndAULintelAbove(): void
    {
        // Casa de 5 × 6 m, dos aguas con la cumbrera a lo largo de x (hastiales en los extremos x): 60 % de pendiente,
        // 1,80 m de altura. Ventana de 1 m centrada (y de 2,50 a 3,50 m), una hilada sobre el arranque y tres de alto.
        $window = ['id' => 'v1', 'side' => 'A', 'pos' => 20, 'w' => 8, 'sill' => 1, 'h' => 3];
        $with = $this->analyze(Fixtures::room(40, 48)->roofPart(0, 0, 0, 40, 48, 'gable', 'x', 60, more: ['windows' => [$window]]));
        $without = $this->analyze(Fixtures::room(40, 48)->roofPart(0, 0, 0, 40, 48, 'gable', 'x', 60));
        $g = $with['roof']['parts'][0]['geometry']['gables'][0];

        self::assertSame('A', $g['side']);
        self::assertTrue($g['windows'][0]['ok']);
        foreach ($g['courses'] as $k => $c) {
            foreach ($c['spans'] as [$a, $b, $kind]) {
                if ($k >= 1 && $k <= 3) {
                    self::assertTrue($b <= 250.1 || $a >= 349.9, "hilada $k: ninguna pieza dentro del vano ($a–$b)");
                }
            }
        }
        $lintel = array_filter($g['courses'][4]['spans'], static fn (array $s): bool => 2 === $s[2]);
        self::assertNotEmpty($lintel, 'la hilada de arriba de la ventana lleva bloques U');
        self::assertLessThanOrEqual(230.0, min(array_column($lintel, 0)), 'el dintel apoya al menos 20 cm a cada lado');
        self::assertGreaterThanOrEqual(370.0, max(array_column($lintel, 1)));
        self::assertNotEmpty($g['uPieces']);
        self::assertLessThan(array_sum($this->analyze(Fixtures::room(40, 48)->roofPart(0, 0, 0, 40, 48, 'gable', 'x', 60))['roof']['parts'][0]['geometry']['gables'][0]['pieces']), array_sum($g['pieces']), 'menos bloques comunes: el vano y el dintel');

        $u = static fn (array $a): int => array_sum(array_map(static fn (array $b): int => 'U' === ($b['kind'] ?? '') ? $b['order'] : 0, $a['bom']['total']['blocks']));
        self::assertGreaterThan($u($without), $u($with), 'el dintel suma bloques U al cómputo');
        self::assertNotContains('gable.window', $this->codes($with));

        // Una ventana que no entra debajo de la pendiente no se cala y se avisa.
        $tooHigh = ['id' => 'v2', 'side' => 'B', 'pos' => 20, 'w' => 8, 'sill' => 5, 'h' => 3];
        $bad = $this->analyze(Fixtures::room(40, 48)->roofPart(0, 0, 0, 40, 48, 'gable', 'x', 60, more: ['windows' => [$tooHigh]]));
        self::assertContains('gable.window', $this->codes($bad));
        self::assertFalse($bad['roof']['parts'][0]['geometry']['gables'][1]['windows'][0]['ok']);
    }
}
