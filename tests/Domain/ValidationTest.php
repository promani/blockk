<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateBuilder;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\DataProvider;
use App\Domain\Hcca;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class ValidationTest extends TestCase
{
    protected function tearDown(): void
    {
        Hcca::useSystem('lika');
    }

    /** @return list<string> */
    private function codes(TemplateBuilder|array $source): array
    {
        $data = $source instanceof TemplateBuilder ? $source->build() : $source;
        $issues = (new ProjectAnalyzer())->analyze(Fixtures::project($data))['analysis']['issues'];

        return array_column($issues, 'code');
    }

    #[Test]
    public function aCleanModularRoomHasNoErrorsOrWarnings(): void
    {
        $codes = $this->codes(Fixtures::room()->opening(0, 'P100', 'x', 30, 14)->opening(0, 'V125', 'x', 0, 15));

        self::assertSame([], $codes);
    }

    #[Test]
    public function flagsOpeningsTooCloseToACorner(): void
    {
        // Ventana que arranca a 12,5 cm de la esquina: jamba < 25 cm.
        $data = Fixtures::room()->build();
        $data['levels'][0]['openings'][] = ['id' => 'o9', 'wall' => 'w1', 'pos' => 1, 'preset' => 'V125'];

        self::assertContains('opening.pier', $this->codes($data));
    }

    #[Test]
    public function flagsOpeningsSeparatedByLessThanAPier(): void
    {
        $data = Fixtures::room(60, 30)->build();
        $data['levels'][0]['openings'][] = ['id' => 'o8', 'wall' => 'w1', 'pos' => 10, 'preset' => 'V100'];
        $data['levels'][0]['openings'][] = ['id' => 'o9', 'wall' => 'w1', 'pos' => 19, 'preset' => 'V100']; // 1 unidad de jamba

        self::assertContains('opening.gap', $this->codes($data));
    }

    #[Test]
    public function warnsWhenOpeningsTakeTooMuchOfABearingWall(): void
    {
        $codes = $this->codes(Fixtures::room(40, 30)->opening(0, 'V187', 'x', 0, 4)->opening(0, 'V187', 'x', 0, 21));

        self::assertContains('opening.ratio', $codes);
    }

    #[Test]
    public function upperBearingWallsMustSitOnBearingWallsBelow(): void
    {
        $errors = $this->codes(Fixtures::room(40, 30)->room(1, 5, 0, 40, 30)); // PA desplazada 5 unidades

        self::assertContains('support.upper', $errors);
        self::assertContains('timber.missing', $errors, 'PA sin entrepiso definido');
    }

    #[Test]
    public function alignedUpperLevelPassesTheSupportCheck(): void
    {
        $codes = $this->codes(Fixtures::room(30, 30)->joists(0, 0, 30, 30, 'x')->room(1, 0, 0, 30, 30));

        self::assertNotContains('support.upper', $codes);
        self::assertNotContains('timber.missing', $codes);
        self::assertContains('height.total', $codes);
    }

    #[Test]
    public function upperPartitionsOverTheTimberFloorGetAnAdvisoryAndOrphansAnError(): void
    {
        $base = Fixtures::room(30, 30)->joists(0, 0, 30, 30, 'x')->room(1, 0, 0, 30, 30);
        $onFloor = $this->codes((clone $base)->wall(1, 15, 0, 15, 30, 10.0));
        self::assertContains('support.partition', $onFloor);

        $issues = (new ProjectAnalyzer())->analyze(Fixtures::build((clone $base)->wall(1, 15, 0, 15, 30, 10.0)))['analysis']['issues'];
        $partition = array_values(array_filter($issues, static fn (array $i): bool => 'support.partition' === $i['code']))[0];
        self::assertSame('info', $partition['severity']);

        $orphan = (new ProjectAnalyzer())->analyze(Fixtures::build(Fixtures::room(30, 30)->room(1, 0, 0, 30, 30)->wall(1, 50, 0, 50, 20, 10.0)))['analysis']['issues'];
        $codes = array_column(array_filter($orphan, static fn (array $i): bool => 'error' === $i['severity']), 'code');
        self::assertContains('support.partition', $codes);
    }

    #[Test]
    public function flagsThinExteriorWallsAndSlenderPartitions(): void
    {
        Hcca::useSystem('generico'); // números del módulo de 62,5 cm (y espesor de 7,5)
        $thin = $this->codes(Fixtures::room(40, 30, 10.0));
        self::assertContains('wall.exterior-thin', $thin);

        $slender = $this->codes(Fixtures::room(40, 30, 20.0)->wall(0, 20, 0, 20, 30, 7.5));
        self::assertContains('wall.slender', $slender);
    }

    #[Test]
    public function aThirdLevelIsRejectedAsAStructuralLimit(): void
    {
        $data = Fixtures::room()->build();
        $data['levels'][] = ['walls' => [], 'openings' => [], 'ubeams' => [], 'timber' => []];

        try {
            ProjectFactory::fromArray($data);
            self::fail('Debería rechazar un tercer nivel');
        } catch (InvalidProjectException $e) {
            self::assertStringContainsString('2 niveles', $e->getMessage());
        }
    }

    /** @return iterable<string, array{array<string, mixed>, string}> */
    public static function invalidPayloads(): iterable
    {
        $wall = ['id' => 'w1', 'x1' => 0, 'y1' => 0, 'x2' => 10, 'y2' => 0, 't' => 20];
        yield 'espesor no permitido' => [['levels' => [['walls' => [[...$wall, 't' => 12]]]]], 'espesor'];
        yield 'muro diagonal' => [['levels' => [['walls' => [[...$wall, 'y2' => 5]]]]], 'ortogonal'];
        yield 'muro de longitud cero' => [['levels' => [['walls' => [[...$wall, 'x2' => 0]]]]], 'longitud'];
        yield 'coordenada fuera de rango' => [['levels' => [['walls' => [[...$wall, 'x2' => 99999]]]]], 'rango'];
        yield 'ids duplicados' => [['levels' => [['walls' => [$wall, [...$wall, 'x1' => 20, 'x2' => 30]]]]], 'duplicado'];
        yield 'id con caracteres inválidos' => [['levels' => [['walls' => [[...$wall, 'id' => '<script>']]]]], 'inválido'];
        yield 'id numérico' => [['levels' => [['walls' => [[...$wall, 'id' => '1']]]]], 'inválido'];
        yield 'entrepiso gigante' => [['levels' => [['timber' => [['id' => 't1', 'kind' => 'joists', 'x' => 0, 'y' => 0, 'w' => 4000, 'h' => 4000]]]]], 'rango'];
        yield 'latitud inválida' => [['lat' => 120, 'levels' => []], 'lat'];
        yield 'niveles no es lista' => [['levels' => ['a' => []]], 'lista'];
    }

    /** @param array<string, mixed> $payload */
    #[Test]
    #[DataProvider('invalidPayloads')]
    public function rejectsMalformedProjects(array $payload, string $expectedFragment): void
    {
        try {
            ProjectFactory::fromArray($payload);
            self::fail('Debería rechazar el proyecto');
        } catch (InvalidProjectException $e) {
            self::assertStringContainsStringIgnoringCase($expectedFragment, implode(' | ', $e->errors));
        }
    }

    #[Test]
    public function limitsTheNumberOfWallsPerLevel(): void
    {
        $walls = [];
        for ($i = 0; $i < 1501; ++$i) {
            $walls[] = ['id' => "w$i", 'x1' => 0, 'y1' => 0, 'x2' => 10, 'y2' => 0, 't' => 20];
        }
        $this->expectException(InvalidProjectException::class);
        ProjectFactory::fromArray(['levels' => [['walls' => $walls]]]);
    }

    #[Test]
    public function openingHeightIsDerivedFromTheSillSoLintelsAlwaysSitAtCourseNine(): void
    {
        $data = Fixtures::room()->build();
        $data['levels'][0]['openings'][] = ['id' => 'oz', 'wall' => 'w1', 'pos' => 14, 'w' => 8, 'sill' => 3, 'h' => 99, 'kind' => 'window'];
        $project = Fixtures::project($data);

        self::assertSame(5, $project->level(0)->openings[0]->h);
        self::assertSame(8, $project->level(0)->openings[0]->lintelCourse());
    }

    #[Test]
    public function flagsWallsTooShortToBeLaidBetweenThickWalls(): void
    {
        // 25 cm entre dos muros de 20 cm: en las hiladas recortadas queda una pieza de 5 cm.
        $data = ['levels' => [['walls' => [
            ['id' => 'm', 'x1' => 0, 'y1' => 0, 'x2' => 0, 'y2' => 2, 't' => 20],
            ['id' => 'a', 'x1' => 0, 'y1' => 0, 'x2' => 10, 'y2' => 0, 't' => 20],
            ['id' => 'b', 'x1' => 0, 'y1' => 2, 'x2' => 10, 'y2' => 2, 't' => 20],
        ]]]];

        self::assertContains('wall.short', $this->codes($data));
    }

    #[Test]
    public function warnsAboutTeesWhoseThroughWallsHaveDifferentThickness(): void
    {
        $data = ['levels' => [['walls' => [
            ['id' => 'w', 'x1' => 0, 'y1' => 0, 'x2' => 10, 'y2' => 0, 't' => 20],
            ['id' => 'e', 'x1' => 10, 'y1' => 0, 'x2' => 20, 'y2' => 0, 't' => 10],
            ['id' => 's', 'x1' => 10, 'y1' => 0, 'x2' => 10, 'y2' => 10, 't' => 15],
        ]]]];

        self::assertContains('junction.thickness', $this->codes($data));
    }
}
