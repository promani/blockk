<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\ProjectAnalyzer;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Alto de cada nivel (2,50 a 3,00 m): el Nivel 2, la escalera y el techo arrancan donde termina el de abajo. */
final class LevelHeightTest extends TestCase
{
    /**
     * Habitación de dos plantas con escalera y techo; la Planta Baja con muros de $walls hiladas y el nivel de $courses.
     *
     * @return array<string, mixed>
     */
    private function house(int $walls, ?int $courses): array
    {
        $d = Fixtures::room(60, 50)->upper()->stair(0, 2, 2, 'N', 'straight', 8)->room(1, 0, 0, 60, 50)->roofPart(1, 0, 0, 60, 50)->build();
        foreach ($d['levels'][0]['walls'] as &$w) {
            $w['h'] = $walls;
        }
        unset($w);
        if (null !== $courses) {
            $d['levels'][0]['courses'] = $courses;
        }

        return (new ProjectAnalyzer())->analyze(Fixtures::project($d));
    }

    /** @param array<string, mixed> $a @return list<string> */
    private function codes(array $a): array
    {
        return array_column($a['analysis']['issues'], 'code');
    }

    #[Test]
    public function lowerGroundWallsWithoutLoweringTheLevelLeaveTheUpperFloorFloating(): void
    {
        $codes = $this->codes($this->house(11, null));

        self::assertContains('support.short', $codes, 'Avisa que el Nivel 2 queda en el aire y cómo arreglarlo');
        self::assertNotContains('support.upper', $codes);
    }

    #[Test]
    public function aLowerLevelCarriesTheUpperFloorStairAndRoofDown(): void
    {
        $a = $this->house(11, 11);
        $codes = $this->codes($a);

        self::assertNotContains('support.short', $codes);
        self::assertNotContains('support.upper', $codes);
        self::assertSame(11, $a['project']['levels'][0]['courses'], 'El alto del nivel se guarda');
        self::assertArrayNotHasKey('courses', $a['project']['levels'][1], 'El alto estándar no se escribe');

        $stair = $a['analysis']['floors']['stairs'][0];
        self::assertEqualsWithDelta(275 / 16, $stair['riseCm'], 0.01, 'La escalera sube 2,75 m');
        self::assertEqualsWithDelta(275.0 + 300.0, $a['analysis']['roof']['parts'][0]['geometry']['zTop'], 0.01, 'El techo apoya a 5,75 m');
        self::assertEqualsWithDelta(5.75, $a['analysis']['telemetry']['total']['heightM'], 0.001);
        self::assertSame(2.75, $a['analysis']['telemetry']['levels'][0]['heightM']);
    }

    #[Test]
    public function wallsTallerThanTheLevelBelowTheUpperFloorAreAnError(): void
    {
        self::assertContains('wall.height', $this->codes($this->house(12, 11)));
    }

    #[Test]
    public function theLevelHeightIsBetweenTwoFiftyAndThreeMeters(): void
    {
        $d = Fixtures::room(40, 30)->build();
        $d['levels'][0]['courses'] = 9;

        $this->expectException(\App\Domain\Model\InvalidProjectException::class);
        Fixtures::project($d);
    }
}
