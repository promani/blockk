<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Design\HouseGenerator;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class HouseGeneratorTest extends TestCase
{
    /** @return iterable<string, array{array<string, mixed>, int, int}> programa, niveles, ambientes cerrados esperados */
    public static function programs(): iterable
    {
        yield '2 dormitorios' => [['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 2], ['tipo' => 'bano']]], 1, 4];
        yield '3 dormitorios con cocina aparte' => [['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio_principal'], ['tipo' => 'dormitorio', 'cantidad' => 2], ['tipo' => 'bano', 'cantidad' => 2], ['tipo' => 'lavadero'], ['tipo' => 'cocina'], ['tipo' => 'estar_comedor']]], 1, 8];
        yield 'dúplex' => [['niveles' => 2, 'ambientes' => [['tipo' => 'estar_comedor_cocina'], ['tipo' => 'toilette'], ['tipo' => 'lavadero'], ['tipo' => 'dormitorio_principal', 'nivel' => 2], ['tipo' => 'dormitorio', 'nivel' => 2, 'cantidad' => 2], ['tipo' => 'bano', 'nivel' => 2]]], 2, 10];
        yield 'a un agua' => [['niveles' => 1, 'techo' => 'un_agua', 'ambientes' => [['tipo' => 'dormitorio']]], 1, 4];
        yield 'dúplex a un agua' => [['niveles' => 2, 'techo' => 'un_agua', 'ambientes' => [['tipo' => 'cocina'], ['tipo' => 'dormitorio', 'nivel' => 2, 'cantidad' => 3], ['tipo' => 'bano', 'nivel' => 2]]], 2, 10];
    }

    /** @param array<string, mixed> $program */
    #[Test]
    #[DataProvider('programs')]
    public function generatedHousesPassTheReviewWithoutErrorsOrWarnings(array $program, int $levels, int $rooms): void
    {
        $result = (new HouseGenerator())->generate($program);
        $analysis = (new ProjectAnalyzer())->analyze(ProjectFactory::fromArray($result['project']))['analysis'];

        $serious = array_filter($analysis['issues'], static fn (array $i): bool => 'info' !== $i['severity']);
        self::assertSame([], array_values(array_map(static fn (array $i): string => "{$i['code']}: {$i['message']}", $serious)));
        self::assertSame($levels, $analysis['telemetry']['total']['levelsUsed']);
        self::assertSame($rooms, array_sum(array_map(static fn (array $l): int => count($l['rooms'] ?? []), $analysis['levels'])));
        self::assertLessThan(4.0, $analysis['telemetry']['total']['scrapPct']);
        self::assertSame(2 === $levels, $result['project']['upper']);
    }

    #[Test]
    public function randomProgramsAreEitherRejectedWithAMessageOrClean(): void
    {
        mt_srand(11);
        $gen = new HouseGenerator();
        $analyzer = new ProjectAnalyzer();
        $types = array_keys(HouseGenerator::TYPES);
        for ($i = 0; $i < 40; ++$i) {
            $levels = mt_rand(1, 2);
            $rooms = [['tipo' => HouseGenerator::LIVING_TYPES[mt_rand(0, 3)]]];
            for ($k = 0, $n = mt_rand(1, 8); $k < $n; ++$k) {
                $rooms[] = ['tipo' => $types[mt_rand(0, count($types) - 1)], 'nivel' => mt_rand(1, $levels)] + (mt_rand(0, 2) ? [] : ['m2' => mt_rand(3, 25)]);
            }
            $rooms[] = ['tipo' => 'dormitorio', 'nivel' => $levels];
            $program = ['niveles' => $levels, 'ambientes' => $rooms, 'techo' => mt_rand(0, 1) ? 'dos_aguas' : 'un_agua'];
            try {
                $result = $gen->generate($program);
            } catch (\InvalidArgumentException $e) {
                self::assertNotSame('', $e->getMessage());
                continue;
            }
            $issues = $analyzer->analyze(ProjectFactory::fromArray($result['project']))['analysis']['issues'];
            self::assertSame([], array_values(array_filter($issues, static fn (array $x): bool => 'info' !== $x['severity'])), json_encode($program, JSON_THROW_ON_ERROR));
        }
    }

    #[Test]
    public function theSameProgramAlwaysGivesTheSameHouse(): void
    {
        $program = ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 3], ['tipo' => 'bano']]];
        self::assertSame((new HouseGenerator())->generate($program)['project'], (new HouseGenerator())->generate($program)['project']);
    }

    #[Test]
    public function bedroomsFaceTheSunAndServicesTheOtherSide(): void
    {
        $rooms = (new HouseGenerator())->generate(['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 2], ['tipo' => 'bano'], ['tipo' => 'lavadero']]])['rooms'];
        $byName = [];
        foreach ($rooms as $r) {
            $byName[$r['tipo']][] = $r['rect'][1];
        }
        self::assertSame([0, 0], $byName['dormitorio']);
        self::assertGreaterThan(0, $byName['bano'][0]);
        self::assertGreaterThan(0, $byName['lavadero'][0]);
    }

    #[Test]
    public function aliasesAndQuantitiesAreUnderstood(): void
    {
        $p = (new HouseGenerator())->normalize(['niveles' => 1, 'ambientes' => [['tipo' => 'Baño', 'cantidad' => 2], ['tipo' => 'living'], ['tipo' => 'Habitación']]]);
        self::assertSame(['bano', 'bano', 'estar', 'dormitorio'], array_column($p['ambientes'], 'tipo'));
        self::assertSame('Casa de 1 dormitorio', $p['nombre']);
    }

    /** @return iterable<string, array{array<string, mixed>, string}> */
    public static function invalidPrograms(): iterable
    {
        yield 'tres niveles' => [['niveles' => 3, 'ambientes' => [['tipo' => 'dormitorio']]], '1 o 2 niveles'];
        yield 'tipo desconocido' => [['niveles' => 1, 'ambientes' => [['tipo' => 'piscina']]], 'desconocido'];
        yield 'nivel 2 vacío' => [['niveles' => 2, 'ambientes' => [['tipo' => 'dormitorio']]], 'Nivel 2 no tiene'];
        yield 'demasiado larga' => [['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 8], ['tipo' => 'dormitorio_principal', 'cantidad' => 4], ['tipo' => 'bano', 'cantidad' => 4]]], 'Demasiados ambientes'];
    }

    /** @param array<string, mixed> $program */
    #[Test]
    #[DataProvider('invalidPrograms')]
    public function unbuildableProgramsExplainWhy(array $program, string $message): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage($message);
        (new HouseGenerator())->generate($program);
    }
}
