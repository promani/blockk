<?php

declare(strict_types=1);

namespace App\Domain;

use App\Domain\Bom\BomCalculator;
use App\Domain\Floor\SlabPlanner;
use App\Domain\Floor\StairPlanner;
use App\Domain\Geometry\OpeningPlacement;
use App\Domain\Geometry\RegionAnalyzer;
use App\Domain\Geometry\Topology;
use App\Domain\Geometry\WallNormalizer;
use App\Domain\Masonry\CourseBuilder;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\Project;
use App\Domain\Model\Wall;
use App\Domain\Roof\RoofPlanner;
use App\Domain\Timber\TimberPlanner;
use App\Domain\Validation\Issue;
use App\Domain\Validation\ProjectValidator;

/**
 * Orquesta todo el pipeline de un proyecto: normalización → topología → regiones → despiece por hiladas →
 * entrepiso → cómputo → validación → telemetría. Es la única entrada que usa la API.
 */
final class ProjectAnalyzer
{
    public function __construct(
        private readonly WallNormalizer $normalizer = new WallNormalizer(),
        private readonly RegionAnalyzer $regions = new RegionAnalyzer(),
        private readonly CourseBuilder $courses = new CourseBuilder(),
        private readonly TimberPlanner $timber = new TimberPlanner(),
        private readonly StairPlanner $stairs = new StairPlanner(),
        private readonly SlabPlanner $slabs = new SlabPlanner(),
        private readonly RoofPlanner $roof = new RoofPlanner(),
        private readonly BomCalculator $bom = new BomCalculator(),
        private readonly ProjectValidator $validator = new ProjectValidator(),
        private readonly OpeningPlacement $placement = new OpeningPlacement(),
    ) {
    }

    /**
     * Normaliza los niveles (muros, T, cruces, solapes).
     *
     * @return array{Project, list<string>}
     *
     * @throws InvalidProjectException si el proyecto supera el presupuesto de complejidad
     */
    public function normalize(Project $project): array
    {
        $levels = [];
        $notices = [];
        foreach ($project->levels as $i => $level) {
            $r = $this->normalizer->normalize($level);
            if (count($r->level->walls) > Hcca::MAX_SEGMENTS_PER_LEVEL) {
                throw new InvalidProjectException([sprintf('%s: el proyecto es demasiado complejo (más de %d tramos de muro por nivel).', Project::LEVEL_SHORT[$i] ?? 'Nivel', Hcca::MAX_SEGMENTS_PER_LEVEL)]);
            }
            $this->assertFootprintBudget($r->level, $i);
            $levels[] = $r->level;
            array_push($notices, ...$r->notices);
        }

        return [$project->withLevels($levels), array_values(array_unique($notices))];
    }

    /** El análisis de ambientes usa una grilla de celdas de 12,5 cm sobre la caja envolvente: se acota su tamaño. */
    private function assertFootprintBudget(\App\Domain\Model\Level $level, int $index): void
    {
        if ($level->isEmpty()) {
            return;
        }
        $w = max(array_map(static fn (Wall $x): int => $x->x2, $level->walls)) - min(array_map(static fn (Wall $x): int => $x->x1, $level->walls));
        $h = max(array_map(static fn (Wall $x): int => $x->y2, $level->walls)) - min(array_map(static fn (Wall $x): int => $x->y1, $level->walls));
        if ($w > Hcca::MAX_BBOX_UNITS || $h > Hcca::MAX_BBOX_UNITS) {
            throw new InvalidProjectException([sprintf('%s: la construcción ocupa una superficie demasiado grande (máx. %s m por lado).', Project::LEVEL_SHORT[$index] ?? 'Nivel', number_format(Hcca::MAX_BBOX_UNITS * Hcca::GRID_CM / 100, 1))]);
        }
    }

    /**
     * @param list<\App\Domain\Model\Level> $levels niveles ya normalizados
     *
     * @return list<LevelAnalysis>
     */
    public function analyzeLevels(Project $normalized): array
    {
        $out = [];
        foreach ($normalized->levels as $level) {
            $topology = new Topology($level);
            $out[] = new LevelAnalysis($level, $topology, $this->regions->analyze($level), $this->courses->build($level, $topology));
        }

        return $out;
    }

    /** @return array<string, mixed> {project, analysis} */
    public function analyze(Project $project): array
    {
        [$normalized, $notices] = $this->normalize($project);
        $levels = $this->analyzeLevels($normalized);
        $stairPlan = $this->stairs->plan($normalized, $levels[0]->regions);
        $timber = $this->timber->plan($normalized->level(0), $stairPlan->holes);
        $slabPlan = $this->slabs->plan($normalized, $levels[0]->regions, $stairPlan->holes);
        $roofPlan = $this->roof->plan($normalized, $levels);
        $extras = ['stairs' => $stairPlan->bom, 'slabs' => $slabPlan->bom, 'roof' => $roofPlan->bom(), 'gables' => $roofPlan->gablePieces()];
        $bom = $this->bom->calculate(
            $normalized,
            array_map(static fn (LevelAnalysis $l) => $l->courses, $levels),
            array_map(static fn (LevelAnalysis $l) => $l->topology, $levels),
            $timber,
            $extras,
        );
        $issues = $this->validator->validate($normalized, $levels, $timber);
        foreach ([...$stairPlan->issues, ...$slabPlan->issues, ...$roofPlan->issues] as $i) {
            $issues[] = Issue::fromArray($i);
        }

        return [
            'project' => $normalized->toArray(),
            'analysis' => [
                'notices' => $notices,
                'levels' => array_map(fn (LevelAnalysis $l, int $i): array => $this->levelPayload($l, $bom['levels'][$i] ?? []), $levels, array_keys($levels)),
                'timber' => $timber->toArray(),
                'floors' => ['stairs' => $stairPlan->stairs, 'slabs' => $slabPlan->slabs],
                'roof' => $roofPlan->toArray(),
                'bom' => $bom,
                'issues' => array_map(static fn (Issue $i): array => $i->toArray(), $issues),
                'telemetry' => $this->telemetry($normalized, $levels, $bom) + ['roof' => ['count' => count($roofPlan->parts), 'coverM2' => $roofPlan->bom()['coverM2']], 'slabM2' => $slabPlan->bom['areaM2'], 'stairs' => $stairPlan->bom['count']],
            ],
        ];
    }

    /**
     * @param array<string, mixed> $bomScope
     *
     * @return array<string, mixed>
     */
    private function levelPayload(LevelAnalysis $l, array $bomScope): array
    {
        $walls = [];
        foreach ($l->level->walls as $w) {
            $walls[$w->id] = [
                'ext' => $l->regions->exterior[$w->id] ?? null,
                'free' => in_array($w->id, $l->regions->freeStanding, true),
                'slots' => $this->placement->freeIntervals($l->level, $l->topology, $w),
                'startTrim' => Hcca::ticksToCm($l->topology->perpendicularThickness($w, true)),
                'endTrim' => Hcca::ticksToCm($l->topology->perpendicularThickness($w, false)),
            ];
        }
        $shapes = $l->regions->shapes();
        $rooms = array_map(static fn ($r): array => $r->toArray() + ['fill' => $shapes[$r->id]['fill'] ?? [], 'corners' => $shapes[$r->id]['corners'] ?? []], $l->regions->rooms);

        [$rooms, $labels] = $this->nameRooms($rooms, $l->level->labels);

        return [
            'used' => !$l->level->isEmpty(),
            'walls' => $walls,
            'rooms' => $rooms,
            'labels' => $labels,
            'courses' => $l->courses->toArray(),
            'junctions' => [
                'tee' => $l->topology->count(Geometry\NodeType::Tee),
                'cross' => $l->topology->count(Geometry\NodeType::Cross),
                'corner' => $l->topology->count(Geometry\NodeType::Corner),
            ],
            'stock' => $bomScope['stock'] ?? 0,
        ];
    }

    /**
     * Pone a cada ambiente el nombre de las etiquetas que caen dentro (varias en un espacio abierto: «Cocina / Estar»).
     *
     * @param list<array<string, mixed>>        $rooms
     * @param list<\App\Domain\Model\Label> $labels
     *
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function nameRooms(array $rooms, array $labels): array
    {
        $byRoom = [];
        $out = [];
        foreach ($labels as $lb) {
            $roomId = null;
            foreach ($rooms as $r) {
                if (array_any($r['fill'], static fn (array $f): bool => $lb->x >= $f[0] && $lb->x < $f[0] + $f[2] && $lb->y >= $f[1] && $lb->y < $f[1] + $f[3])) {
                    $roomId = $r['id'];
                    break;
                }
            }
            if (null !== $roomId && '' !== $lb->name) {
                $byRoom[$roomId][] = $lb->name;
            }
            $out[] = $lb->toArray() + ['room' => $roomId];
        }
        foreach ($rooms as $i => $r) {
            $rooms[$i]['labels'] = count($byRoom[$r['id']] ?? []);
            if (isset($byRoom[$r['id']])) {
                $rooms[$i]['name'] = implode(' / ', $byRoom[$r['id']]);
            }
        }

        return [$rooms, $out];
    }

    /**
     * @param list<LevelAnalysis>  $levels
     * @param array<string, mixed> $bom
     *
     * @return array<string, mixed>
     */
    private function telemetry(Project $project, array $levels, array $bom): array
    {
        $perLevel = [];
        foreach ($levels as $i => $l) {
            $scope = $bom['levels'][$i];
            $perLevel[] = [
                'name' => Project::LEVEL_SHORT[$i],
                'used' => !$l->level->isEmpty(),
                'walls' => count($l->level->walls),
                'openings' => count($l->level->openings),
                'rooms' => count($l->regions->rooms),
                'wallLengthM' => $scope['wallLengthM'],
                'grossM2' => round($l->regions->totalGrossM2(), 2),
                'netM2' => round($l->regions->totalNetM2(), 2),
                'courses' => ['regular' => Hcca::REGULAR_COURSES, 'crown' => 1, 'total' => Hcca::COURSES],
                'heightM' => Hcca::LEVEL_HEIGHT_CM / 100,
                'blocks' => array_sum(array_column($scope['blocks'], 'stock')),
            ];
        }
        $usedLevels = count(array_filter($perLevel, static fn (array $l): bool => $l['used']));
        $total = $bom['total'];

        return [
            'levels' => $perLevel,
            'total' => [
                'levelsUsed' => $usedLevels,
                'heightM' => $usedLevels * Hcca::LEVEL_HEIGHT_CM / 100,
                'maxHeightM' => Hcca::MAX_TOTAL_HEIGHT_CM / 100,
                'grossM2' => round(array_sum(array_column($perLevel, 'grossM2')), 2),
                'netM2' => round(array_sum(array_column($perLevel, 'netM2')), 2),
                'blocks' => array_sum(array_column($total['blocks'], 'order')),
                'stock' => $total['stock'],
                'pallets' => array_sum(array_map(static fn (array $b): int => $b['pallets']['total'], $total['blocks'])),
                'adhesiveBags' => $total['mortar']['adhesiveBags'],
                'cutBlocksPct' => $total['cutBlocksPct'],
                'scrapPct' => $total['scrapPct'],
                'cost' => $bom['totalCost'],
                'currency' => $bom['currency'],
            ],
        ];
    }
}
