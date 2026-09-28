<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Geometry\WallNormalizer;
use App\Domain\Model\Level;
use App\Domain\Model\Opening;
use App\Domain\Model\OpeningKind;
use App\Domain\Model\Wall;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class WallNormalizerTest extends TestCase
{
    private const T = 400;

    /** @return list<string> */
    private function segments(Level $level): array
    {
        $out = array_map(static fn (Wall $w): string => "{$w->x1},{$w->y1}-{$w->x2},{$w->y2}", $level->walls);
        sort($out);

        return $out;
    }

    #[Test]
    public function splitsAWallWhereATeeArrives(): void
    {
        $level = new Level([Wall::between('a', 0, 0, 40, 0, self::T), Wall::between('b', 20, 0, 20, 30, 200)]);

        $result = (new WallNormalizer())->normalize($level);

        self::assertSame(['0,0-20,0', '20,0-20,30', '20,0-40,0'], $this->segments($result->level));
    }

    #[Test]
    public function splitsBothWallsOfACross(): void
    {
        $level = new Level([Wall::between('h', 0, 10, 40, 10, self::T), Wall::between('v', 20, 0, 20, 20, self::T)]);

        $result = (new WallNormalizer())->normalize($level);

        self::assertCount(4, $result->level->walls);
        self::assertSame(['0,10-20,10', '20,0-20,10', '20,10-20,20', '20,10-40,10'], $this->segments($result->level));
    }

    #[Test]
    public function keepsExistingWallsWhenANewOneOverlapsThem(): void
    {
        $existing = Wall::between('old', 0, 0, 20, 0, 200);
        $overlapping = Wall::between('new', 0, 0, 40, 0, self::T);

        $result = (new WallNormalizer())->normalize(new Level([$existing, $overlapping]));

        // El tramo ya ocupado conserva su espesor (10 cm); el nuevo sólo completa el resto.
        $byStart = [];
        foreach ($result->level->walls as $w) {
            $byStart[$w->x1] = $w->t;
        }
        self::assertSame(200, $byStart[0]);
        self::assertSame(self::T, $byStart[20]);
        self::assertCount(2, $result->level->walls);
    }

    #[Test]
    public function mergesCollinearSegmentsOfTheSameThickness(): void
    {
        $level = new Level([Wall::between('a', 0, 0, 10, 0, self::T), Wall::between('b', 10, 0, 25, 0, self::T)]);

        $result = (new WallNormalizer())->normalize($level);

        self::assertSame(['0,0-25,0'], $this->segments($result->level));
    }

    #[Test]
    public function doesNotMergeWhenThicknessDiffersOrABranchArrives(): void
    {
        $differentT = (new WallNormalizer())->normalize(new Level([Wall::between('a', 0, 0, 10, 0, self::T), Wall::between('b', 10, 0, 25, 0, 300)]));
        self::assertCount(2, $differentT->level->walls);

        $withBranch = (new WallNormalizer())->normalize(new Level([
            Wall::between('a', 0, 0, 10, 0, self::T),
            Wall::between('b', 10, 0, 25, 0, self::T),
            Wall::between('c', 10, 0, 10, 20, self::T),
        ]));
        self::assertCount(3, $withBranch->level->walls);
    }

    #[Test]
    public function remapsOpeningsToTheSegmentThatContainsThem(): void
    {
        $level = new Level(
            [Wall::between('a', 0, 0, 40, 0, self::T), Wall::between('b', 20, 0, 20, 30, 200)],
            [new Opening('o1', 'a', 25, 8, 0, 8, OpeningKind::Door, 'P100')],
        );

        $result = (new WallNormalizer())->normalize($level);

        $opening = $result->level->openings[0];
        $wall = $result->level->wall($opening->wallId);
        self::assertNotNull($wall);
        self::assertSame(20, $wall->x1);
        self::assertSame(5, $opening->pos, 'La posición pasa a ser relativa al nuevo tramo');
    }

    #[Test]
    public function dropsOpeningsSplitByAnIntersectionAndReportsIt(): void
    {
        $level = new Level(
            [Wall::between('a', 0, 0, 40, 0, self::T), Wall::between('b', 20, 0, 20, 30, 200)],
            [new Opening('o1', 'a', 16, 8, 0, 8, OpeningKind::Door, 'P100')],
        );

        $result = (new WallNormalizer())->normalize($level);

        self::assertSame([], $result->level->openings);
        self::assertNotSame([], $result->notices);
    }

    #[Test]
    public function isIdempotent(): void
    {
        $normalizer = new WallNormalizer();
        $level = new Level([Wall::between('a', 0, 0, 40, 0, self::T), Wall::between('b', 20, 0, 20, 30, 200), Wall::between('c', 0, 15, 40, 15, 300)]);

        $once = $normalizer->normalize($level)->level;
        $twice = $normalizer->normalize($once)->level;

        self::assertEquals($once, $twice);
    }

    #[Test]
    public function mergingKeepsOpeningsAndUBeamsThatLiveOnTheSecondWall(): void
    {
        // B (5→25) ya tenía una puerta; se dibuja A (0→5) pegada a su inicio y ambas se fusionan en 0→25.
        $level = new Level(
            [Wall::between('B', 5, 0, 25, 0, self::T), Wall::between('A', 0, 0, 5, 0, self::T)],
            [new Opening('o1', 'B', 2, 8, 0, 8, OpeningKind::Door, 'P100'), new Opening('o2', 'B', 6, 8, 0, 8, OpeningKind::Door, 'P100')],
            [new \App\Domain\Model\UBeam('u1', 'B', 3, 2, 5)],
        );

        $result = (new WallNormalizer())->normalize($level);

        self::assertCount(1, $result->level->walls);
        self::assertSame([], $result->notices, 'Nada se descarta: los vanos caben en el muro fusionado');
        $positions = array_map(static fn (Opening $o): int => $o->pos, $result->level->openings);
        sort($positions);
        self::assertSame([7, 11], $positions, 'Posición absoluta = 5 (largo de A) + posición sobre B');
        self::assertSame(8, $result->level->ubeams[0]->pos);
    }

    #[Test]
    public function rejectsIntersectionsThatWouldExplodeIntoTooManySegments(): void
    {
        $walls = [];
        for ($i = 0; $i < 400; ++$i) {
            $walls[] = Wall::between("h$i", 0, $i, 399, $i, self::T);
            $walls[] = Wall::between("v$i", $i, 0, $i, 399, self::T);
        }

        $this->expectException(\App\Domain\Model\InvalidProjectException::class);
        (new WallNormalizer())->normalize(new Level($walls));
    }
}
