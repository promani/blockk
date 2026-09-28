<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Geometry\Topology;
use App\Domain\Hcca;
use App\Domain\Masonry\CourseBuilder;
use App\Domain\Masonry\CourseModel;
use App\Domain\Masonry\PieceKind;
use App\Domain\Masonry\Run;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateCatalog;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class CourseBuilderTest extends TestCase
{
    private function model(\App\Domain\Templates\TemplateBuilder $b, int $level = 0): CourseModel
    {
        $analyzer = new ProjectAnalyzer();
        [$normalized] = $analyzer->normalize(Fixtures::build($b));

        return $analyzer->analyzeLevels($normalized)[$level]->courses;
    }

    /** @return iterable<string, array{string}> */
    public static function templates(): iterable
    {
        foreach (array_keys((new TemplateCatalog())->all() ? array_column((new TemplateCatalog())->all(), 'slug', 'slug') : []) as $slug) {
            yield $slug => [$slug];
        }
    }

    #[Test]
    public function producesTwelveCoursesWithTheCrownInUBlocks(): void
    {
        $model = $this->model(Fixtures::room());

        self::assertCount(12, $model->courses);
        foreach ($model->courses[11] as $run) {
            foreach ($run->pieces as $piece) {
                self::assertSame(PieceKind::U, $piece->kind, 'La hilada 12 es el encadenado superior de bloque U');
                self::assertSame('crown', $piece->role);
            }
        }
        foreach (range(0, 10) as $c) {
            foreach ($model->courses[$c] as $run) {
                foreach ($run->pieces as $piece) {
                    self::assertSame(PieceKind::Block, $piece->kind);
                }
            }
        }
    }

    #[Test]
    public function partitionsDoNotGetACrownBeam(): void
    {
        $model = $this->model(Fixtures::room(40, 30, 10.0));

        foreach ($model->courses[11] as $run) {
            foreach ($run->pieces as $piece) {
                self::assertSame(PieceKind::Block, $piece->kind, 'Un tabique de 10 cm termina en bloque macizo');
            }
        }
    }

    #[Test]
    public function alternatingCornersMakeEachCourseCoverTheSamePerimeter(): void
    {
        // Por cada hilada: 2(W+t) + 2(H−t) = 2(W+H) a ejes, sea cual sea el muro que pasa.
        $model = $this->model(Fixtures::room(40, 30, 20.0));
        $expected = 2 * (40 + 30) * Hcca::GRID;

        foreach ($model->courses as $c => $runs) {
            $length = 0;
            foreach ($runs as $run) {
                foreach ($run->pieces as $p) {
                    $length += $p->length();
                }
            }
            self::assertSame($expected, $length, 'Longitud colocada en la hilada '.($c + 1));
        }
    }

    #[Test]
    public function puttingADoorCreatesAVoidBelowAndALintelAboveIt(): void
    {
        $model = $this->model(Fixtures::room()->opening(0, 'P100', 'x', 30, 14));

        $door = $this->runWithVoid($model, 0);
        self::assertCount(1, $door->voids);
        [$from, $to] = $door->voids[0];
        self::assertSame(8 * Hcca::GRID, $to - $from);

        foreach (range(0, 7) as $c) {
            self::assertNotSame([], $this->runWithVoid($model, $c)->voids, "Vano libre en la hilada ".($c + 1));
        }
        // Hilada 9 (índice 8): sin vano; dintel de bloque U que apoya 25 cm a cada lado.
        $lintelRun = $this->runOn($model, 8, $door->line);
        self::assertSame([], $lintelRun->voids);
        $uPieces = array_values(array_filter($lintelRun->pieces, static fn ($p): bool => PieceKind::U === $p->kind));
        self::assertNotSame([], $uPieces);
        self::assertLessThanOrEqual($from - Hcca::LINTEL_BEARING, min(array_map(static fn ($p): int => $p->a, $uPieces)), 'Apoyo del dintel >= 25 cm a la izquierda');
        self::assertGreaterThanOrEqual($to + Hcca::LINTEL_BEARING, max(array_map(static fn ($p): int => $p->b, $uPieces)), 'Apoyo del dintel >= 25 cm a la derecha');
        foreach ($uPieces as $p) {
            self::assertSame('lintel', $p->role);
        }
    }

    #[Test]
    public function windowsLeaveASillBelowAndAVoidOnlyWhereTheyAre(): void
    {
        $model = $this->model(Fixtures::room()->opening(0, 'V125', 'x', 0, 15)); // antepecho 4 hiladas, alto 4

        foreach ([0, 1, 2, 3] as $c) {
            self::assertSame([], $this->runOn($model, $c, 0)->voids, 'Antepecho macizo');
        }
        foreach ([4, 5, 6, 7] as $c) {
            self::assertCount(1, $this->runOn($model, $c, 0)->voids, 'Vano de la ventana');
        }
        self::assertSame([], $this->runOn($model, 8, 0)->voids);
    }

    #[Test]
    public function verticalJointsOfConsecutiveCoursesKeepTheMinimumBond(): void
    {
        $model = $this->model(Fixtures::room(60, 40)->opening(0, 'P100', 'x', 40, 20)->opening(0, 'V150', 'x', 0, 24));

        self::assertSame([], $model->warnings);
        $this->assertBondBetweenCourses($model);
    }

    #[Test]
    #[DataProvider('templates')]
    public function everyTemplateIsPlacedWithoutBondWarningsAndWithConsistentGeometry(string $slug): void
    {
        $analyzer = new ProjectAnalyzer();
        [$normalized] = $analyzer->normalize(Fixtures::project((new TemplateCatalog())->project($slug)));

        foreach ($analyzer->analyzeLevels($normalized) as $analysis) {
            self::assertSame([], $analysis->courses->warnings, "$slug: traba insuficiente");
            $this->assertBondBetweenCourses($analysis->courses);
            $this->assertRunsAreFullyCovered($analysis->courses);
        }
    }

    #[Test]
    public function coursesAreIdenticalForTheSameInputAndNeverProduceTinyPieces(): void
    {
        $b = Fixtures::room(45, 35)->opening(0, 'V125', 'x', 0, 12);
        $first = $this->model($b);
        $second = $this->model($b);

        self::assertEquals($first->toArray(), $second->toArray(), 'El despiece es determinista');
        foreach ($first->pieces() as [, , $piece]) {
            self::assertGreaterThanOrEqual(Hcca::MIN_PIECE, $piece->length());
            self::assertLessThanOrEqual(Hcca::BLOCK_L, $piece->length());
        }
    }

    private function runWithVoid(CourseModel $model, int $course): Run
    {
        foreach ($model->courses[$course] as $run) {
            if ([] !== $run->voids) {
                return $run;
            }
        }
        self::fail("No hay vano en la hilada $course");
    }

    private function runOn(CourseModel $model, int $course, int $line): Run
    {
        foreach ($model->courses[$course] as $run) {
            if ('x' === $run->axis->value && $run->line === $line) {
                return $run;
            }
        }
        self::fail("No hay corrida horizontal en la línea $line, hilada $course");
    }

    private function assertBondBetweenCourses(CourseModel $model): void
    {
        $joints = [];
        foreach ($model->courses as $c => $runs) {
            foreach ($runs as $run) {
                foreach ($run->pieces as $i => $piece) {
                    if (isset($run->pieces[$i + 1]) && $run->pieces[$i + 1]->a === $piece->b) {
                        $joints[$c][$run->key()][] = $piece->b;
                    }
                }
            }
        }
        foreach ($joints as $c => $byLine) {
            if (0 === $c) {
                continue;
            }
            foreach ($byLine as $key => $positions) {
                foreach ($positions as $p) {
                    foreach ($joints[$c - 1][$key] ?? [] as $q) {
                        self::assertGreaterThanOrEqual(Hcca::MIN_BOND, abs($p - $q), sprintf('Traba < 12,5 cm en hilada %d, línea %s', $c + 1, $key));
                    }
                }
            }
        }
    }

    private function assertRunsAreFullyCovered(CourseModel $model): void
    {
        foreach ($model->courses as $c => $runs) {
            foreach ($runs as $run) {
                $placed = array_sum(array_map(static fn ($p): int => $p->length(), $run->pieces));
                $voids = 0;
                foreach ($run->voids as [$a, $b]) {
                    $voids += $b - $a;
                }
                self::assertSame($run->b - $run->a, $placed + $voids, sprintf('La hilada %d no cubre la corrida %s [%d, %d]', $c + 1, $run->key(), $run->a, $run->b));
                $cursor = $run->a;
                foreach ($run->pieces as $piece) {
                    foreach ($run->voids as [$va, $vb]) {
                        self::assertTrue($piece->b <= $va || $piece->a >= $vb, 'Una pieza invade un vano');
                    }
                    self::assertGreaterThanOrEqual($cursor, $piece->a, 'Piezas superpuestas');
                    $cursor = $piece->b;
                }
            }
        }
    }
}
