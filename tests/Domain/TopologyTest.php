<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Geometry\NodeType;
use App\Domain\Geometry\Topology;
use App\Domain\Geometry\WallNormalizer;
use App\Domain\Model\Level;
use App\Domain\Model\Wall;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class TopologyTest extends TestCase
{
    private function topo(array $walls): Topology
    {
        return new Topology((new WallNormalizer())->normalize(new Level($walls))->level);
    }

    #[Test]
    public function cornersAlternateWhichWallRunsThroughEachCourse(): void
    {
        $h = Wall::between('h', 0, 0, 20, 0, 400);
        $v = Wall::between('v', 0, 0, 0, 20, 300);
        $topo = $this->topo([$h, $v]);

        self::assertSame(NodeType::Corner, $topo->nodeAt(0, 0)->type());
        // Hilada par: el horizontal "pasa" y se prolonga medio espesor del vertical (15 cm → 7,5 cm = 150 ticks).
        self::assertSame(150, $topo->endCondition($h, true, 0)['ext']);
        self::assertSame(-200, $topo->endCondition($v, true, 0)['ext'], 'El vertical se recorta medio espesor del horizontal (10 cm)');
        // Hilada impar: se invierte.
        self::assertSame(-150, $topo->endCondition($h, true, 1)['ext']);
        self::assertSame(200, $topo->endCondition($v, true, 1)['ext']);
    }

    #[Test]
    public function aTeeKeepsTheThroughWallContinuousAndButtsTheBranch(): void
    {
        $topo = $this->topo([Wall::between('a', 0, 0, 40, 0, 400), Wall::between('b', 20, 0, 20, 30, 200)]);
        $node = $topo->nodeAt(20, 0);

        self::assertSame(NodeType::Tee, $node->type());
        $through = $node->arms['E'];
        $branch = $node->arms['S'];
        foreach ([0, 1, 2, 3] as $course) {
            self::assertSame(['ext' => 0, 'merge' => true], $topo->endCondition($through, true, $course));
            self::assertSame(-200, $topo->endCondition($branch, true, $course)['ext']);
        }
        self::assertSame(1, $topo->count(NodeType::Tee));
    }

    #[Test]
    public function aCrossAlternatesTheThroughPairPerCourse(): void
    {
        $topo = $this->topo([Wall::between('h', 0, 10, 40, 10, 400), Wall::between('v', 20, 0, 20, 20, 400)]);
        $node = $topo->nodeAt(20, 10);

        self::assertSame(NodeType::Cross, $node->type());
        $east = $node->arms['E'];
        $south = $node->arms['S'];
        self::assertTrue($topo->endCondition($east, true, 0)['merge']);
        self::assertFalse($topo->endCondition($south, true, 0)['merge']);
        self::assertFalse($topo->endCondition($east, true, 1)['merge']);
        self::assertTrue($topo->endCondition($south, true, 1)['merge']);
        self::assertCount(1, $topo->mergePairs(0), 'Un cruce aporta un único par pasante por hilada');
        self::assertCount(1, $topo->mergePairs(1));
    }

    #[Test]
    public function freeEndsDoNotExtendOrTrim(): void
    {
        $w = Wall::between('a', 0, 0, 10, 0, 400);
        $topo = $this->topo([$w]);

        self::assertSame(['ext' => 0, 'merge' => false], $topo->endCondition($w, true, 0));
        self::assertSame(0, $topo->perpendicularThickness($w, true));
    }
}
