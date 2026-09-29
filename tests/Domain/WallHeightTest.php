<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Masonry\PieceKind;
use App\Domain\ProjectAnalyzer;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Alto propio de cada muro (en hiladas) y corona de bloques U opcional. */
final class WallHeightTest extends TestCase
{
    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function analyze(array $data): array
    {
        return (new ProjectAnalyzer())->analyze(Fixtures::project($data));
    }

    /** @param array<string, mixed> $a @return list<string> */
    private function kindsAt(array $a, int $course, string $axis, float $line): array
    {
        $runs = array_values(array_filter($a['analysis']['levels'][0]['courses'][$course] ?? [], static fn (array $r): bool => $r['axis'] === $axis && abs($r['line'] - $line) < 0.01));

        return array_values(array_unique(array_merge(...array_map(static fn (array $r): array => array_map(static fn (array $p): string => in_array($p[2], [2, 3], true) ? 'U' : 'B', $r['pieces']), $runs ?: [['pieces' => []]]))));
    }

    #[Test]
    public function aLowerWallStopsAtItsHeightWithItsOwnCrown(): void
    {
        $d = Fixtures::room(40, 30)->build();
        $d['levels'][0]['walls'][0]['h'] = 6; // norte: 1,50 m
        $a = $this->analyze($d);

        self::assertSame(['U'], $this->kindsAt($a, 5, 'x', 0.0), 'La hilada 6 del muro bajo es su corona U');
        self::assertSame([], $this->kindsAt($a, 6, 'x', 0.0), 'Arriba de su alto el muro no existe');
        self::assertContains('U', $this->kindsAt($a, 11, 'y', 0.0), 'Los muros de 3,00 m conservan su corona');
        self::assertSame(6, $a['project']['levels'][0]['walls'][0]['h']);
    }

    #[Test]
    public function theCrownCanBeTurnedOffForPlainMasonry(): void
    {
        $d = Fixtures::room(40, 30)->build();
        $d['levels'][0]['walls'][2]['crown'] = false; // sur
        $with = $this->analyze(Fixtures::room(40, 30)->build());
        $without = $this->analyze($d);

        self::assertSame(['B'], $this->kindsAt($without, 11, 'x', 375.0));
        $u = static fn (array $a): int => array_sum(array_map(static fn (array $b): int => PieceKind::U->value === $b['kind'] ? $b['stock'] : 0, $a['analysis']['bom']['total']['blocks']));
        self::assertLessThan($u($with), $u($without), 'Sin corona se compran menos bloques U');
    }

    #[Test]
    public function wallsOfDifferentHeightAreNotMerged(): void
    {
        $d = Fixtures::room(40, 30)->build();
        $d['levels'][0]['walls'][] = ['id' => 'extra', 'x1' => 40, 'y1' => 0, 'x2' => 60, 'y2' => 0, 't' => 20, 'h' => 4];
        $walls = $this->analyze($d)['project']['levels'][0]['walls'];

        $north = array_values(array_filter($walls, static fn (array $w): bool => 0 === $w['y1'] && 0 === $w['y2']));
        self::assertCount(2, $north, 'El tramo bajo sigue siendo un muro aparte');
    }

    #[Test]
    public function heightRulesAreValidated(): void
    {
        $d = Fixtures::room(40, 30)->opening(0, 'P87', 'x', 30, 10)->build();
        $door = $d['levels'][0]['openings'][0]['wall'];
        foreach ($d['levels'][0]['walls'] as &$w) {
            if ($w['id'] === $door) {
                $w['h'] = 8; // 2,00 m: la puerta de 2,00 m no deja lugar al dintel
            }
        }
        unset($w);
        $codes = array_column($this->analyze($d)['analysis']['issues'], 'code');
        self::assertContains('opening.height', $codes);

        $tall = Fixtures::room(40, 30)->build();
        $tall['levels'][0]['walls'][0]['h'] = 14;
        self::assertNotContains('wall.height', array_column($this->analyze($tall)['analysis']['issues'], 'code'), 'Sin Nivel 2 un muro puede llegar a 3,50 m');
        $tall['upper'] = true;
        self::assertContains('wall.height', array_column($this->analyze($tall)['analysis']['issues'], 'code'));
    }
}
