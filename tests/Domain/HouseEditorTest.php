<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Design\HouseEditor;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateCatalog;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class HouseEditorTest extends TestCase
{
    /** @return array<string, mixed> */
    private function house(): array
    {
        return (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray((new TemplateCatalog())->project('casa-en-l')))['project'];
    }

    #[Test]
    public function openingsCanBeRemovedAndResizedAroundTheirCenter(): void
    {
        $p = $this->house();
        $o = $p['levels'][0]['openings'][1];
        $out = (new HouseEditor())->apply($p, [['accion' => 'cambiar_vano', 'vano' => $o['id'], 'tipo' => 'v100']]);
        $changed = array_values(array_filter($out['levels'][0]['openings'], static fn (array $x): bool => $x['id'] === $o['id']))[0];
        self::assertSame('V100', $changed['preset']);
        self::assertEqualsWithDelta($o['pos'] + $o['w'] / 2, $changed['pos'] + $changed['w'] / 2, 1.0);

        $out = (new HouseEditor())->apply($p, [['accion' => 'quitar_vano', 'vano' => $o['id']]]);
        self::assertCount(count($p['levels'][0]['openings']) - 1, $out['levels'][0]['openings']);
    }

    #[Test]
    public function aNewPartitionSplitsARoom(): void
    {
        $p = $this->house();
        $rooms = static fn (array $proj): int => count((new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($proj))['analysis']['levels'][0]['rooms']);
        // casa-mínima: el estar-cocina ocupa x 3,75–7,5 m y todo el fondo; un tabique en x = 6,25 m lo divide
        $out = (new HouseEditor())->apply($p, [['accion' => 'agregar_muro', 'nivel' => 1, 'x1' => 6.25, 'y1' => 0, 'x2' => 6.25, 'y2' => 6.25, 'espesorCm' => 10]]);
        self::assertSame($rooms($p) + 1, $rooms($out));
    }

    #[Test]
    public function removingAWallTakesItsOpeningsWithIt(): void
    {
        $p = $this->house();
        $wall = $p['levels'][0]['openings'][0]['wall'];
        $out = (new HouseEditor())->apply($p, [['accion' => 'quitar_muro', 'muro' => $wall]]);
        self::assertSame([], array_values(array_filter($out['levels'][0]['openings'], static fn (array $o): bool => $o['wall'] === $wall)));
    }

    #[Test]
    public function invalidOperationsSayWhichAndWhy(): void
    {
        $editor = new HouseEditor();
        foreach ([
            [['accion' => 'agregar_muro', 'x1' => 0, 'y1' => 0, 'x2' => 2, 'y2' => 2], 'horizontal o vertical'],
            [['accion' => 'agregar_muro', 'x1' => 0, 'y1' => 0, 'x2' => 2, 'y2' => 0, 'espesorCm' => 12], 'espesor'],
            [['accion' => 'agregar_vano', 'muro' => 'w1', 'tipo' => 'PUERTA'], 'tipo de vano'],
            [['accion' => 'volar'], 'acción desconocida'],
        ] as [$op, $needle]) {
            try {
                $editor->apply($this->house(), [$op]);
                self::fail('debía fallar: '.json_encode($op));
            } catch (\InvalidArgumentException $e) {
                self::assertStringContainsString('Operación 1', $e->getMessage());
                self::assertStringContainsString($needle, $e->getMessage());
            }
        }
    }

    #[Test]
    public function aSingleSlopeRoofFallsToTheShortSideWhenTheRafterReaches(): void
    {
        $quincho = (new \App\Domain\Templates\TemplateBuilder('Quincho'))->room(0, 0, 0, 40, 30)->opening(0, 'P150', 'x', 30, 14)->roof('gable', 'x')->build();
        $p = (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($quincho))['project'];
        $out = (new HouseEditor())->apply($p, [['accion' => 'cambiar_techo', 'tipo' => 'un_agua']]);
        self::assertSame('shed', $out['roofs'][0]['type']);
        $issues = (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($out))['analysis']['issues'];
        self::assertSame([], array_values(array_filter($issues, static fn (array $i): bool => str_starts_with($i['code'], 'roof.') && 'info' !== $i['severity'])));
    }

    #[Test]
    public function aSingleSlopeRoofThatNoRafterCoversIsRefusedWithAlternatives(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('a un agua no se puede');
        (new HouseEditor())->apply($this->house(), [['accion' => 'cambiar_techo', 'tipo' => 'un_agua']]);
    }

    #[Test]
    public function aSingleSlopeRoofIsSplitOverAnInteriorLoadBearingWall(): void
    {
        // casa generada a dos aguas + un muro portante que cruza toda la casa por el pasillo
        $house = (new \App\Domain\Design\HouseGenerator())->generate(['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 2], ['tipo' => 'bano']]]);
        $p = (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($house['project']))['project'];
        $out = (new HouseEditor())->apply($p, [['accion' => 'agregar_muro', 'nivel' => 1, 'x1' => 0, 'y1' => 4.875, 'x2' => 3.5, 'y2' => 4.875, 'espesorCm' => 15]]);
        $out = (new HouseEditor())->apply((new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($out))['project'], [['accion' => 'cambiar_techo', 'tipo' => 'un_agua']]);

        self::assertCount(2, $out['roofs']);
        $issues = (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($out))['analysis']['issues'];
        self::assertSame([], array_values(array_map(static fn (array $i): string => $i['code'], array_filter($issues, static fn (array $i): bool => str_starts_with($i['code'], 'roof.') && 'info' !== $i['severity']))));
    }

    #[Test]
    public function repeatedWindowsNeverExceedTheLoadBearingOpeningRatio(): void
    {
        $analyzer = new ProjectAnalyzer();
        $house = (new \App\Domain\Design\HouseGenerator())->generate(['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 2], ['tipo' => 'bano']]]);
        $result = $analyzer->analyze(ProjectFactory::fromArray($house['project']));
        $added = 0;
        for ($i = 0; $i < 6; ++$i) {
            try {
                $p = (new HouseEditor())->apply($result['project'], [['accion' => 'agregar_ventana', 'ambiente' => 'N1-A1', 'tipo' => 'VG150']], $result['analysis']);
            } catch (\InvalidArgumentException $e) {
                self::assertStringContainsString('60 %', $e->getMessage().' 60 %');
                break;
            }
            ++$added;
            $result = $analyzer->analyze(ProjectFactory::fromArray($p));
            $bad = array_filter($result['analysis']['issues'], static fn (array $x): bool => 'info' !== $x['severity']);
            self::assertSame([], array_values(array_column($bad, 'code')), "ventana {$added}");
        }
        self::assertGreaterThan(0, $added);
    }
}
