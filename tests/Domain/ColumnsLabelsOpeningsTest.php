<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateBuilder;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Pilares, nombres de ambientes y formas de abrir de las aberturas. */
final class ColumnsLabelsOpeningsTest extends TestCase
{
    /** @return array<string, mixed> */
    private function analyze(TemplateBuilder $b): array
    {
        return (new ProjectAnalyzer())->analyze(Fixtures::build($b));
    }

    #[Test]
    public function aLabelNamesTheRoomItFallsIn(): void
    {
        $r = $this->analyze(Fixtures::room()->label(0, 10, 10, 'Dormitorio'));
        $room = $r['analysis']['levels'][0]['rooms'][0];

        self::assertSame('Dormitorio', $room['name']);
        self::assertSame(1, $room['labels']);
        self::assertSame($room['id'], $r['analysis']['levels'][0]['labels'][0]['room']);
    }

    #[Test]
    public function severalLabelsShareAnOpenSpace(): void
    {
        $r = $this->analyze(Fixtures::room()->label(0, 5, 5, 'Cocina')->label(0, 30, 20, 'Estar')->label(0, 500, 500, 'Afuera'));
        $room = $r['analysis']['levels'][0]['rooms'][0];

        self::assertSame('Cocina / Estar', $room['name']);
        self::assertSame(2, $room['labels']);
        self::assertNull($r['analysis']['levels'][0]['labels'][2]['room'], 'un nombre fuera de todo ambiente queda suelto');
    }

    #[Test]
    public function unnamedRoomsKeepTheirDefaultName(): void
    {
        $room = $this->analyze(Fixtures::room())['analysis']['levels'][0]['rooms'][0];

        self::assertStringStartsWith('Ambiente', $room['name']);
        self::assertSame(0, $room['labels']);
    }

    #[Test]
    public function labelsAndColumnsSurviveNormalization(): void
    {
        $b = Fixtures::room()->column(0, 20, 15, 25)->label(0, 10, 10, 'Estar');
        $level = $this->analyze($b)['project']['levels'][0];

        self::assertSame([20, 15, 25], [$level['columns'][0]['x'], $level['columns'][0]['y'], $level['columns'][0]['size']]);
        self::assertSame('Estar', $level['labels'][0]['name']);
    }

    #[Test]
    public function columnSizeAndLabelLimitsAreValidated(): void
    {
        $data = Fixtures::room()->build();
        $data['levels'][0]['columns'] = [['id' => 'c1', 'x' => 1, 'y' => 1, 'size' => 33]];
        $this->expectException(InvalidProjectException::class);
        ProjectFactory::fromArray($data);
    }

    #[Test]
    public function anUpperColumnNeedsSomethingBelow(): void
    {
        $b = Fixtures::room(40, 30)->upper()->room(1, 0, 0, 40, 30, 20)->slab(1, 0, 0, 40, 30)
            ->column(1, 20, 15)
            ->column(1, 0, 15);            // sobre el muro de la planta baja
        $codes = array_column($this->analyze($b)['analysis']['issues'], 'code');
        self::assertContains('support.column', $codes, 'el pilar del medio del piso no tiene apoyo');

        $withBelow = Fixtures::room(40, 30)->column(0, 20, 15)->upper()->room(1, 0, 0, 40, 30, 20)->slab(1, 0, 0, 40, 30)->column(1, 20, 15);
        self::assertNotContains('support.column', array_column($this->analyze($withBelow)['analysis']['issues'], 'code'));
    }

    #[Test]
    public function columnsAreCountedInTheBillOfMaterials(): void
    {
        $lines = $this->analyze(Fixtures::room()->column(0, 20, 15, 30)->column(0, 24, 15, 30))['analysis']['bom']['lines'];
        $pillars = array_values(array_filter($lines, static fn (array $l): bool => 'Pilares' === $l['group']));

        self::assertSame(['PHO', 'PD10', 'PD8', 'PEN'], array_column($pillars, 'code'));
        self::assertEqualsWithDelta(0.54, $pillars[0]['qty'], 0.001, '2 pilares de 30 × 30 × 3,00 m');
    }

    #[Test]
    public function openingsHaveATypeAndAWayToOpen(): void
    {
        $b = Fixtures::room()
            ->opening(0, 'P87', 'x', 30, 6)
            ->opening(0, 'V125', 'x', 0, 10)
            ->opening(0, 'PG250', 'x', 30, 20)
            ->opening(0, 'P75', 'y', 40, 6, flip: true, hingeEnd: true, mode: 'slide');
        $ops = $this->analyze($b)['project']['levels'][0]['openings'];
        $by = array_column($ops, null, 'preset');

        self::assertSame(['door', 'swing', false], [$by['P87']['kind'], $by['P87']['mode'], $by['P87']['hingeEnd']]);
        self::assertSame(['window', 'swing'], [$by['V125']['kind'], $by['V125']['mode']]);
        self::assertSame(['gate', 'overhead'], [$by['PG250']['kind'], $by['PG250']['mode']]);
        self::assertSame(['slide', true, true], [$by['P75']['mode'], $by['P75']['hingeEnd'], $by['P75']['flip']]);
    }

    #[Test]
    public function aWayToOpenThatTheTypeDoesNotAllowFallsBackToTheUsualOne(): void
    {
        $data = Fixtures::room()->opening(0, 'V125', 'x', 0, 10)->opening(0, 'P87', 'x', 30, 6)->build();
        $data['levels'][0]['openings'][0]['mode'] = 'overhead';
        $data['levels'][0]['openings'][1]['mode'] = 'fixed';
        $ops = ProjectFactory::fromArray($data)->toArray()['levels'][0]['openings'];

        self::assertSame(['swing', 'swing'], array_column($ops, 'mode'));
    }
}
