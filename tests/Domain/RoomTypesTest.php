<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Hcca;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateBuilder;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Tipo de ambiente: elegido o deducido del nombre, con sus recomendaciones y los m² por tipo. */
final class RoomTypesTest extends TestCase
{
    /**
     * @param list<array<string, mixed>> $labels nombres del Nivel 1 (reemplazan a los del builder)
     *
     * @return array<string, mixed>
     */
    private function analyze(TemplateBuilder $b, array $labels): array
    {
        $project = $b->build();
        $project['levels'][0]['labels'] = $labels;

        return (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($project));
    }

    /** @param array<string, mixed> $r @return list<string> */
    private function codes(array $r): array
    {
        return array_values(array_map(static fn (array $i): string => "{$i['severity']} {$i['code']}", array_filter($r['analysis']['issues'], static fn (array $i): bool => str_starts_with($i['code'], 'room.'))));
    }

    #[Test]
    public function theTypeIsChosenOrGuessedFromTheName(): void
    {
        self::assertSame('dormitorio', Hcca::roomTypeOf('Dormitorio principal'));
        self::assertSame('estar_comedor', Hcca::roomTypeOf('Estar-comedor-cocina'));
        self::assertSame('bano', Hcca::roomTypeOf('  BAÑO en suite'));
        self::assertNull(Hcca::roomTypeOf('Sala de máquinas'));

        $r = $this->analyze(Fixtures::room(), [['id' => 'n1', 'x' => 10, 'y' => 10, 'name' => 'El cuarto de Juli', 'type' => 'dormitorio']]);
        self::assertSame('dormitorio', $r['analysis']['levels'][0]['rooms'][0]['type']);
        self::assertSame('El cuarto de Juli', $r['analysis']['levels'][0]['rooms'][0]['name'], 'el nombre sigue siendo libre');
        self::assertSame('dormitorio', $r['project']['levels'][0]['labels'][0]['type']);

        $guessed = $this->analyze(Fixtures::room(), [['id' => 'n1', 'x' => 10, 'y' => 10, 'name' => 'Cocina']]);
        self::assertSame('cocina', $guessed['analysis']['levels'][0]['rooms'][0]['type']);
        self::assertArrayNotHasKey('type', $guessed['project']['levels'][0]['labels'][0], 'sin tipo elegido el proyecto queda como antes');
    }

    #[Test]
    public function theTypeAloneNamesTheRoom(): void
    {
        $r = $this->analyze(Fixtures::room(), [['id' => 'n1', 'x' => 10, 'y' => 10, 'name' => '', 'type' => 'bano'], ['id' => 'n2', 'x' => 500, 'y' => 500, 'name' => 'Algo', 'type' => 'inventado']]);

        self::assertSame('Baño', $r['project']['levels'][0]['labels'][0]['name']);
        self::assertArrayNotHasKey('type', $r['project']['levels'][0]['labels'][1], 'un tipo desconocido se descarta');
    }

    #[Test]
    public function aBedroomWithoutAWindowIsFlaggedAndWithOneItIsNot(): void
    {
        $label = [['id' => 'n1', 'x' => 10, 'y' => 10, 'name' => 'Dormitorio']];

        self::assertSame(['warn room.window'], $this->codes($this->analyze(Fixtures::room()->opening(0, 'P87', 'x', 0, 10), $label)), 'una puerta no es una ventana');
        self::assertSame([], $this->codes($this->analyze(Fixtures::room()->opening(0, 'V125', 'y', 40, 10), $label)));
    }

    #[Test]
    public function serviceRoomsOnlyGetASoftNote(): void
    {
        // baño de 1,50 × 1,25 m sin ventana: nota de ventilación y de superficie, ninguna advertencia
        $r = $this->analyze(Fixtures::room(12, 10), [['id' => 'n1', 'x' => 5, 'y' => 5, 'name' => 'Baño']]);

        self::assertSame(['info room.vent', 'info room.small'], $this->codes($r));
        self::assertSame([], $this->codes($this->analyze(Fixtures::room(), [['id' => 'n1', 'x' => 10, 'y' => 10, 'name' => 'Pasillo']])), 'un pasillo no pide ventana');
        self::assertSame([], $this->codes($this->analyze(Fixtures::room(), [['id' => 'n1', 'x' => 10, 'y' => 10, 'name' => 'Sala de máquinas']])), 'sin tipo no hay recomendaciones');
    }

    #[Test]
    public function usefulAreaIsGroupedByType(): void
    {
        $b = Fixtures::room()->room(0, 40, 0, 24, 30)->room(0, 64, 0, 24, 30);
        $r = $this->analyze($b, [
            ['id' => 'n1', 'x' => 10, 'y' => 10, 'name' => 'Estar'],
            ['id' => 'n2', 'x' => 50, 'y' => 10, 'name' => 'Dormitorio 1'],
            ['id' => 'n3', 'x' => 70, 'y' => 10, 'name' => 'Pieza de los chicos', 'type' => 'dormitorio'],
        ]);
        $byType = array_column($r['analysis']['telemetry']['byType'], null, 'type');

        self::assertSame(['dormitorio', 'estar'], array_keys($byType), 'de mayor a menor superficie');
        self::assertSame(2, $byType['dormitorio']['rooms']);
        self::assertEqualsWithDelta($r['analysis']['telemetry']['total']['netM2'], array_sum(array_column($byType, 'm2')), 0.05);
    }
}
