<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Design\PlanTracer;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class PlanTracerTest extends TestCase
{
    /** Planta de 8 × 7 m: estar y cocina integrados, dos dormitorios, baño y paso. Algunas medidas no cierran exactas. */
    private const array PLAN = [
        'nombre' => 'Casa del plano',
        'ambientes' => [
            ['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 4.5, 'fondo' => 4, 'abierto' => ['abajo']],
            ['nombre' => 'Cocina', 'x' => 0, 'y' => 4, 'ancho' => 4.5, 'fondo' => 3, 'abierto' => ['arriba']],
            ['nombre' => 'Dormitorio', 'x' => 4.6, 'y' => 0, 'ancho' => 3.5, 'fondo' => 3.5],
            ['nombre' => 'Baño', 'x' => 4.5, 'y' => 3.5, 'ancho' => 2, 'fondo' => 1.6],
            ['nombre' => 'Paso', 'x' => 6.5, 'y' => 3.5, 'ancho' => 1.6, 'fondo' => 1.6],
            ['nombre' => 'Dormitorio 2', 'x' => 4.5, 'y' => 5.1, 'ancho' => 3.6, 'fondo' => 1.9],
        ],
        'aberturas' => [
            ['tipo' => 'puerta', 'x' => 0, 'y' => 6, 'ancho' => 0.9],
            ['tipo' => 'ventana', 'x' => 2.2, 'y' => 0, 'ancho' => 1.5],
            ['tipo' => 'puerta', 'x' => 4.5, 'y' => 1.5],
            ['tipo' => 'ventana', 'x' => 8.1, 'y' => 1.5],
        ],
    ];

    /**
     * @param array<string, mixed> $plan
     *
     * @return array{project: array<string, mixed>, analysis: array<string, mixed>, notes: list<string>}
     */
    private function trace(array $plan): array
    {
        $traced = (new PlanTracer())->trace($plan);

        return (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($traced['project'])) + ['notes' => $traced['notes']];
    }

    #[Test]
    public function aTracedPlanIsAValidHouseWithItsRoomsNamed(): void
    {
        $r = $this->trace(self::PLAN);

        $rooms = array_column($r['analysis']['levels'][0]['rooms'], 'netM2', 'name');
        self::assertSame(['Estar / Cocina', 'Dormitorio', 'Baño', 'Paso', 'Dormitorio 2'], array_keys($rooms), 'el lado abierto une estar y cocina; el resto queda cerrado');
        self::assertEqualsWithDelta(4.5 * 7, $rooms['Estar / Cocina'], 3.0);
        self::assertSame('Casa del plano', $r['project']['name']);
        self::assertSame([], array_values(array_filter($r['analysis']['issues'], static fn (array $i): bool => 'error' === $i['severity'])));
        self::assertSame([], $r['notes']);
    }

    #[Test]
    public function nearbyLinesAreMergedSoNeighboursShareTheWall(): void
    {
        $r = $this->trace(self::PLAN);

        // El dormitorio empieza en 4,60 y el estar termina en 4,50: es el mismo muro (a 3 m del borde del terreno).
        $vertical = array_unique(array_map(static fn (array $w): int => $w['x1'], array_filter($r['project']['levels'][0]['walls'], static fn (array $w): bool => $w['x1'] === $w['x2'])));
        sort($vertical);
        self::assertSame([24, 60, 76, 89], $vertical);
    }

    #[Test]
    public function outerWallsAreThickAndSharedOnesArePartitions(): void
    {
        $r = $this->trace(self::PLAN);
        $walls = $r['project']['levels'][0]['walls'];
        $info = $r['analysis']['levels'][0]['walls'];

        foreach ($walls as $w) {
            self::assertSame(null !== $info[$w['id']]['ext'] ? 20 : 10, (int) $w['t'], "muro {$w['id']}");
        }
    }

    #[Test]
    public function openingsLandOnTheNearestWallInAValidPlace(): void
    {
        $r = $this->trace(self::PLAN);
        $openings = $r['project']['levels'][0]['openings'];

        self::assertSame(['door', 'window', 'door', 'window'], array_column($openings, 'kind'));
        self::assertSame([7, 12, 7, 10], array_column($openings, 'w'), 'el ancho pedido (0,90 → 87,5 cm; 1,50 m) o el habitual del tipo');
        self::assertSame([], array_values(array_filter($r['analysis']['issues'], static fn (array $i): bool => str_starts_with($i['code'], 'opening.pier'))));
    }

    #[Test]
    public function anOpeningWithNoWallNearbyIsReportedNotInvented(): void
    {
        $plan = self::PLAN;
        $plan['aberturas'][] = ['tipo' => 'ventana', 'x' => 30, 'y' => 30];
        $r = $this->trace($plan);

        self::assertCount(4, $r['project']['levels'][0]['openings']);
        self::assertStringContainsString('No pude ubicar 1 abertura', $r['notes'][0]);
    }

    #[Test]
    public function aRectangularPlanGetsOneRoofAndAnLShapedOneGetsTwoThatCross(): void
    {
        $r = $this->trace(self::PLAN);
        self::assertSame(['gable'], array_column($r['project']['roofs'], 'type'));

        $l = $this->trace(['ambientes' => [
            ['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 8, 'fondo' => 4],
            ['nombre' => 'Dormitorio', 'x' => 0, 'y' => 4, 'ancho' => 3, 'fondo' => 4],
        ]]);
        // el cuerpo de 8 × 4 m y el ala de 3 × 8 m: se cruzan en la esquina, como en la casa en L de la Galería
        self::assertSame([[64, 32], [24, 64]], array_map(static fn (array $r): array => [$r['w'], $r['h']], $l['project']['roofs']));
        self::assertSame([], $l['notes']);

        self::assertSame([], $this->trace(self::PLAN + ['techo' => 'ninguno'])['project']['roofs']);
    }

    #[Test]
    public function twoFloorsShareTheOriginAndGetSlabs(): void
    {
        $r = $this->trace(['ambientes' => [
            ['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 6, 'fondo' => 4],
            ['nombre' => 'Cocina', 'x' => 0, 'y' => 4, 'ancho' => 6, 'fondo' => 3],
            ['nombre' => 'Garaje', 'x' => 6, 'y' => 0, 'ancho' => 3, 'fondo' => 6],
            ['nombre' => 'Dormitorio', 'nivel' => 2, 'x' => 0, 'y' => 0, 'ancho' => 3, 'fondo' => 4],
            ['nombre' => 'Dormitorio 2', 'nivel' => 2, 'x' => 3, 'y' => 0, 'ancho' => 3, 'fondo' => 4],
            ['nombre' => 'Hall', 'nivel' => 2, 'x' => 0, 'y' => 4, 'ancho' => 6, 'fondo' => 3],
        ]]);

        self::assertTrue($r['project']['upper']);
        self::assertSame(2, $r['analysis']['telemetry']['total']['levelsUsed']);
        self::assertCount(2, $r['project']['levels'][1]['slabs'], 'losa sobre estar y cocina; el garaje no tiene nada arriba');
        self::assertSame([[1, 'gable'], [0, 'shed']], array_map(static fn (array $x): array => [$x['level'], $x['type']], $r['project']['roofs']), 'el garaje, sin nada encima, lleva su techo bajo a un agua');
        self::assertSame('E', $r['project']['roofs'][1]['dir'], 'cae hacia afuera de la planta alta');
        self::assertStringContainsString('no trae la escalera', implode(' ', $r['notes']));
        // el muro entre el estar y el garaje sostiene el muro exterior del Nivel 2: mismo espesor
        self::assertSame([], array_values(array_filter($r['analysis']['issues'], static fn (array $i): bool => 'support.thickness' === $i['code'])));
    }

    #[Test]
    public function theStairIsFittedInItsRectangle(): void
    {
        $plan = ['ambientes' => [
            ['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 6, 'fondo' => 5],
            ['nombre' => 'Dormitorio', 'nivel' => 2, 'x' => 0, 'y' => 0, 'ancho' => 6, 'fondo' => 5],
        ]];
        $r = $this->trace($plan + ['escaleras' => [['x' => 0.5, 'y' => 0.5, 'ancho' => 3.2, 'fondo' => 2.0]]]);

        $stair = $r['project']['levels'][0]['stairs'][0];
        self::assertSame(['U', 'E'], [$stair['shape'], $stair['dir']], 'en 3,20 × 2,00 m entra una escalera en U a lo largo');
        self::assertSame([28, 28], [$stair['x'], $stair['y']]);
        self::assertSame([], array_values(array_filter($r['analysis']['issues'], static fn (array $i): bool => str_starts_with($i['code'], 'stair.o'))));
        self::assertSame([], $r['notes']);

        // una escalera que no entra en ningún ambiente se avisa, no se inventa
        $bad = $this->trace($plan + ['escaleras' => [['x' => 20, 'y' => 20, 'ancho' => 3.2, 'fondo' => 2.0]]]);
        self::assertSame([], $bad['project']['levels'][0]['stairs']);
        self::assertStringContainsString('escalera del plano no entra', implode(' ', $bad['notes']));
    }

    #[Test]
    public function typesColumnsDoorSwingsAndWindowHeightsComeFromThePlan(): void
    {
        $r = $this->trace([
            'ambientes' => [
                ['nombre' => 'Pieza de Juli', 'tipo' => 'dormitorio', 'x' => 0, 'y' => 0, 'ancho' => 4, 'fondo' => 4],
                ['nombre' => 'Galería', 'x' => 4, 'y' => 0, 'ancho' => 3, 'fondo' => 4, 'abierto' => ['derecha', 'abajo']],
            ],
            'aberturas' => [
                ['tipo' => 'puerta', 'x' => 2, 'y' => 4, 'bisagra' => 'derecha', 'abre' => 'arriba'],
                ['tipo' => 'puerta', 'x' => 0, 'y' => 2, 'bisagra' => 'arriba', 'abre' => 'derecha'],
                ['tipo' => 'ventana', 'x' => 2, 'y' => 0, 'ancho' => 1.2, 'alto' => 1.5],
            ],
            'pilares' => [['x' => 7, 'y' => 4, 'lado' => 0.25], ['x' => 7, 'y' => 0]],
        ]);
        $level = $r['project']['levels'][0];

        self::assertSame(['Pieza de Juli', 'dormitorio'], [$level['labels'][0]['name'], $level['labels'][0]['type']]);
        self::assertSame([[true, true], [false, false]], array_map(static fn (array $o): array => [$o['hingeEnd'], $o['flip']], array_slice($level['openings'], 0, 2)));
        self::assertSame([10, 2, 6], [$level['openings'][2]['w'], $level['openings'][2]['sill'], $level['openings'][2]['h']], '1,20 × 1,50 m: vano de 125 × 150 con antepecho de 50 cm');
        self::assertSame([[80, 56, 25], [80, 24, 20]], array_map(static fn (array $c): array => [$c['x'], $c['y'], $c['size']], $level['columns']));
    }

    #[Test]
    public function whatThePlanPutsUpstairsMovesWithTheUpperFloor(): void
    {
        // la planta alta viene dibujada al lado de la baja (x desde 10 m): su ventana tiene que caer en su muro
        $r = $this->trace(['ambientes' => [
            ['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 6, 'fondo' => 4],
            ['nombre' => 'Dormitorio', 'nivel' => 2, 'x' => 10, 'y' => 0, 'ancho' => 6, 'fondo' => 4],
        ], 'aberturas' => [['tipo' => 'ventana', 'nivel' => 2, 'x' => 13, 'y' => 0]]]);

        self::assertCount(1, $r['project']['levels'][1]['openings']);
        self::assertStringContainsString('Puse la planta alta sobre la baja', implode(' ', $r['notes']));
    }

    #[Test]
    public function badPlansAreExplained(): void
    {
        $tracer = new PlanTracer();
        foreach ([
            [[], 'Faltan los ambientes'],
            [['ambientes' => [['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 4]]], '«fondo»'],
            [['ambientes' => [['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 0.3, 'fondo' => 4]]], 'menos de 0,75 m'],
            [['ambientes' => [['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 4, 'fondo' => 4, 'nivel' => 3]]], 'nivel es 1 o 2'],
            [['ambientes' => [['nombre' => 'Dormitorio', 'x' => 0, 'y' => 0, 'ancho' => 4, 'fondo' => 4, 'nivel' => 2]]], 'Nivel 1 no tiene ambientes'],
            [['ambientes' => [['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 150, 'fondo' => 4]]], 'terreno de 100 m'],
        ] as [$plan, $message]) {
            try {
                $tracer->trace($plan);
                self::fail("se esperaba un rechazo: {$message}");
            } catch (\InvalidArgumentException $e) {
                self::assertStringContainsString($message, $e->getMessage());
            }
        }
    }
}
