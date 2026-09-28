<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Geometry\WallNormalizer;
use App\Domain\Model\Level;
use App\Domain\Timber\TimberPlanner;
use App\Domain\ProjectAnalyzer;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class TimberPlannerTest extends TestCase
{
    /** @return array<string, mixed> */
    private function plan(\App\Domain\Templates\TemplateBuilder $b): array
    {
        $project = Fixtures::build($b);
        [$normalized] = (new ProjectAnalyzer())->normalize($project);

        return (new TimberPlanner())->plan($normalized->level(0))->toArray();
    }

    /** @param array<string, mixed> $plan @return list<string> */
    private function codes(array $plan): array
    {
        return array_column($plan['issues'], 'code');
    }

    #[Test]
    public function laysOutJoistsWithTenCentimetreBearingAndAtMostTheRequestedSpacing(): void
    {
        $plan = $this->plan(Fixtures::room(30, 30, 20.0)->joists(0, 0, 30, 30, 'x'));

        $field = $plan['fields'][0];
        self::assertSame([], $this->codes($plan));
        // Luz libre: 375 − 20 = 355 cm; largo del tirante = 355 + 2 × 10 cm de apoyo.
        self::assertEqualsWithDelta(355.0, $field['clearSpanCm'], 0.01);
        self::assertEqualsWithDelta(375.0, $field['lengthCm'], 0.01);
        self::assertLessThanOrEqual(40.0, $field['spacingCm']);
        self::assertGreaterThanOrEqual(9, $field['count']);
        foreach ($field['joists'] as $j) {
            self::assertEqualsWithDelta(375.0, $j['lengthCm'], 0.01);
        }
    }

    #[Test]
    public function reportsSpansBeyondTheSectionLimit(): void
    {
        $plan = $this->plan(Fixtures::room(40, 30, 20.0)->joists(0, 0, 40, 30, 'x')); // 4,80 m libres con 3"×8"

        self::assertContains('timber.span', $this->codes($plan));

        $ok = $this->plan(Fixtures::room(40, 30, 20.0)->joists(0, 0, 40, 30, 'x', '3x10')); // hasta 4,75 m: aún excede 4,80
        self::assertContains('timber.span', $this->codes($ok));

        $fits = $this->plan(Fixtures::room(38, 30, 20.0)->joists(0, 0, 38, 30, 'x', '3x10'));
        self::assertNotContains('timber.span', $this->codes($fits));
    }

    #[Test]
    public function reportsJoistsWithoutABearingWall(): void
    {
        // Falta el muro este: los tirantes de un extremo quedan en el aire.
        $b = (new \App\Domain\Templates\TemplateBuilder('t'))
            ->wall(0, 0, 0, 30, 0, 20.0)->wall(0, 0, 30, 30, 30, 20.0)->wall(0, 0, 0, 0, 30, 20.0)
            ->joists(0, 0, 30, 30, 'x');
        $plan = $this->plan($b);

        self::assertContains('timber.support', $this->codes($plan));
    }

    #[Test]
    public function partitionsCannotBearTimber(): void
    {
        $plan = $this->plan(Fixtures::room(30, 30, 10.0)->joists(0, 0, 30, 30, 'x'));

        self::assertContains('timber.support', $this->codes($plan));
    }

    #[Test]
    public function aBearingWallSplitByATeeStillSupportsAllTheJoists(): void
    {
        $plan = $this->plan(Fixtures::room(30, 30, 20.0)->wall(0, 15, 0, 15, 30, 10.0)->joists(0, 0, 30, 30, 'x'));

        self::assertNotContains('timber.support', $this->codes($plan));
    }

    #[Test]
    public function quantitiesUseCommercialLengthsAndDeckSheets(): void
    {
        $plan = $this->plan(Fixtures::room(30, 30, 20.0)->joists(0, 0, 30, 30, 'x'));
        $bom = $plan['bom'];

        self::assertArrayHasKey('3x8', $bom['pieces']);
        self::assertSame([420], array_keys($bom['pieces']['3x8']), 'Tirante de 3,75 m → largo comercial de 4,20 m');
        // 3,75 × 3,75 m = 14,06 m² × 1,10 / 2,9768 = 5,2 → 6 placas OSB
        self::assertSame(6, $bom['osbSheets']);
        self::assertSame((int) ceil(2 * 3.75), $bom['elasticBandMl']);
    }

    #[Test]
    public function individualBeamsNeedPlatesAndBearingWalls(): void
    {
        $b = Fixtures::room(30, 30, 20.0);
        $data = $b->build();
        $data['levels'][0]['timber'][] = ['id' => 'tb', 'kind' => 'beam', 'x1' => 0, 'y1' => 15, 'x2' => 30, 'y2' => 15, 'section' => '3x10'];
        [$normalized] = (new ProjectAnalyzer())->normalize(Fixtures::project($data));
        $plan = (new TimberPlanner())->plan($normalized->level(0))->toArray();

        self::assertSame(2, $plan['bom']['plates']);
        self::assertCount(1, $plan['beams']);
        self::assertNotContains('timber.beam-support', array_column($plan['issues'], 'code'));
    }

    #[Test]
    public function overlappingFieldsAreReportedInsteadOfDoubleCounted(): void
    {
        $plan = $this->plan(Fixtures::room(30, 24, 20.0)->joists(0, 0, 30, 24, 'x')->joists(0, 0, 30, 24, 'x'));

        self::assertContains('timber.overlap', $this->codes($plan));
    }

    #[Test]
    public function allowedSpanShrinksWithWiderSpacing(): void
    {
        // Luz libre de 3,55 m: pasa a 30 y 40 cm entre ejes, no a 60 cm.
        $close = $this->plan(Fixtures::room(30, 30, 20.0)->joists(0, 0, 30, 30, 'x'));
        self::assertNotContains('timber.span', $this->codes($close));

        $data = Fixtures::room(30, 30, 20.0)->joists(0, 0, 30, 30, 'x')->build();
        $data['levels'][0]['timber'][0]['spacing'] = 60;
        [$normalized] = (new ProjectAnalyzer())->normalize(Fixtures::project($data));
        $wide = (new TimberPlanner())->plan($normalized->level(0))->toArray();
        self::assertContains('timber.span', $this->codes($wide));
    }
}
