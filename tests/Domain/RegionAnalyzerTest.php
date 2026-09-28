<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Geometry\RegionAnalyzer;
use App\Domain\Geometry\WallNormalizer;
use App\Domain\Model\Level;
use App\Domain\Model\Wall;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class RegionAnalyzerTest extends TestCase
{
    private function analyze(Level $level): \App\Domain\Geometry\RegionMap
    {
        return (new RegionAnalyzer())->analyze((new WallNormalizer())->normalize($level)->level);
    }

    /** @return list<Wall> */
    private function rect(int $w, int $h, int $t): array
    {
        return [
            Wall::between('n', 0, 0, $w, 0, $t), Wall::between('e', $w, 0, $w, $h, $t),
            Wall::between('s', 0, $h, $w, $h, $t), Wall::between('w', 0, 0, 0, $h, $t),
        ];
    }

    #[Test]
    public function computesExactNetAreaOfARectangularRoom(): void
    {
        // 40 × 30 unidades = 5,00 × 3,75 m a ejes; muros de 20 cm → interior 4,80 × 3,55 m.
        $map = $this->analyze(new Level($this->rect(40, 30, 400)));

        self::assertCount(1, $map->rooms);
        self::assertEqualsWithDelta(18.75, $map->rooms[0]->grossM2, 0.001);
        self::assertEqualsWithDelta(4.80 * 3.55, $map->rooms[0]->netM2, 0.001);
        self::assertTrue($map->rooms[0]->isRectangular());
    }

    #[Test]
    public function computesNetAreaWithDifferentThicknessPerWall(): void
    {
        $walls = [
            Wall::between('n', 0, 0, 40, 0, 400), Wall::between('e', 40, 0, 40, 30, 300),
            Wall::between('s', 0, 30, 40, 30, 200), Wall::between('w', 0, 0, 0, 30, 150),
        ];
        $map = $this->analyze(new Level($walls));

        // Ancho a ejes 500 cm: se resta medio muro oeste (7,5 cm → 3,75) y medio muro este (15 cm → 7,5).
        // Alto a ejes 375 cm: medio muro norte (20 cm → 10) y medio muro sur (10 cm → 5).
        $expected = ((500 - 3.75 - 7.5) / 100) * ((375 - 10 - 5) / 100);
        self::assertEqualsWithDelta($expected, $map->rooms[0]->netM2, 0.001);
    }

    #[Test]
    public function splitsRoomsWithAPartitionAndFindsExteriorFaces(): void
    {
        $level = new Level([...$this->rect(40, 30, 400), Wall::between('p', 20, 0, 20, 30, 200)]);
        $map = $this->analyze($level);

        self::assertCount(2, $map->rooms);
        self::assertNotEmpty($map->exterior);
        // Los muros perimetrales miran hacia afuera; el tabique no es de fachada.
        foreach ($map->exterior as $wallId => $normal) {
            self::assertNotSame('p', $wallId);
            self::assertCount(2, $normal);
        }
        self::assertArrayNotHasKey('p', $map->exterior);
    }

    #[Test]
    public function anOpenWallLayoutHasNoRooms(): void
    {
        $map = $this->analyze(new Level([Wall::between('a', 0, 0, 20, 0, 400), Wall::between('b', 20, 0, 20, 20, 400)]));

        self::assertSame([], $map->rooms);
    }

    #[Test]
    public function handlesAnLShapedRoom(): void
    {
        // L: 2×2 módulos con una esquina de 1×1 recortada; el área neta debe respetar la esquina cóncava.
        $t = 200;
        $walls = [
            Wall::between('a', 0, 0, 20, 0, $t), Wall::between('b', 20, 0, 20, 10, $t), Wall::between('c', 10, 10, 20, 10, $t),
            Wall::between('d', 10, 10, 10, 20, $t), Wall::between('e', 0, 20, 10, 20, $t), Wall::between('f', 0, 0, 0, 20, $t),
        ];
        $map = $this->analyze(new Level($walls));

        self::assertCount(1, $map->rooms);
        // Área bruta: 20×20 − 10×10 = 300 celdas·(0,125 m)² ; interior menor que la bruta y positivo.
        self::assertEqualsWithDelta(300 * 0.015625, $map->rooms[0]->grossM2, 0.001);
        self::assertLessThan($map->rooms[0]->grossM2, $map->rooms[0]->netM2);
        self::assertGreaterThan(0.0, $map->rooms[0]->netM2);
        self::assertFalse($map->rooms[0]->isRectangular());
    }

    #[Test]
    public function aDeadEndStubDoesNotUnderReportTheNetArea(): void
    {
        // Tabique de 10 cm que baja 12 módulos desde el muro norte: ocupa 0,10 m × (1,50 − 0,10) m dentro del ambiente.
        $level = new Level([...$this->rect(40, 30, 400), Wall::between('stub', 20, 0, 20, 12, 200)]);
        $map = $this->analyze($level);

        self::assertCount(1, $map->rooms);
        self::assertEqualsWithDelta(4.80 * 3.55 - 0.10 * 1.40, $map->rooms[0]->netM2, 0.0005);
    }
}
