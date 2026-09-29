<?php

declare(strict_types=1);

namespace App\Domain\Roof;

use App\Domain\Hcca;
use App\Domain\LevelAnalysis;
use App\Domain\Model\Axis;
use App\Domain\Model\Project;
use App\Domain\Model\RoofPart;
use App\Domain\Model\RoofType;
use App\Domain\Model\Wall;

/**
 * Techos rectangulares (a dos aguas con cumbrera central o a un agua), cada uno apoyado sobre los muros de un nivel. Por techo calcula
 * planos de cubierta, cabios (a la separación pedida), cumbrera, clavaderas y los hastiales de bloque (editables; se estiman por superficie
 * y no entran en la optimización de cortes).
 */
final class RoofPlanner
{
    private const int BATTEN_SPACING_CM = 40;
    private const float BLOCK_FACE_M2 = 0.625 * 0.25;

    /** @param list<LevelAnalysis> $levels */
    public function plan(Project $project, array $levels): RoofPlan
    {
        $parts = [];
        $issues = [];
        foreach ($project->roofs as $part) {
            $built = $this->planPart($part, $levels[$part->level]->level->walls);
            $parts[] = $built;
            array_push($issues, ...$built['issues']);
        }

        return new RoofPlan($parts, $issues);
    }

    /**
     * @param list<Wall> $walls muros del nivel sobre el que apoya
     *
     * @return array{id: string, level: int, type: string, geometry: array<string, mixed>, bom: array<string, mixed>, issues: list<array<string, mixed>>}
     */
    private function planPart(RoofPart $roof, array $walls): array
    {
        $G = Hcca::GRID_CM;
        $x0 = $roof->x * $G;
        $x1 = ($roof->x + $roof->w) * $G;
        $y0 = $roof->y * $G;
        $y1 = ($roof->y + $roof->h) * $G;
        $zTop = ($roof->level + 1) * (float) Hcca::LEVEL_HEIGHT_CM;
        $o = (float) $roof->overhang;
        $s = $roof->slopePct / 100;

        // Orientación: "along" es la dirección de la cumbrera / del borde del faldón; "across" la perpendicular (donde cae el agua).
        $shed = RoofType::Shed === $roof->type;
        $alongX = $shed ? in_array($roof->dir, ['N', 'S'], true) : 'x' === $roof->dir;
        [$a0, $a1] = $alongX ? [$x0, $x1] : [$y0, $y1];
        [$c0, $c1] = $alongX ? [$y0, $y1] : [$x0, $x1];
        $span = $c1 - $c0;
        $pt = static fn (float $along, float $across, float $z): array => $alongX ? [round($along, 2), round($across, 2), round($z, 2)] : [round($across, 2), round($along, 2), round($z, 2)];
        $issues = [];
        $lr = ($a1 - $a0) + 2 * $o; // largo de cada faldón a lo largo de la cumbrera

        $planes = [];
        $gables = [];
        $rafterLines = [];
        $ridge = null;

        if (!$shed) {
            $half = $span / 2;
            $mid = ($c0 + $c1) / 2;
            $rise = $half * $s;
            $run = $half;
            $rafterLen = hypot($half + $o, $rise + $o * $s);
            $zLow = $zTop - $o * $s;
            $zRidge = $zTop + $rise;
            foreach ([-1, 1] as $side) {
                $edge = $mid + $side * ($half + $o);
                $planes[] = ['pts' => [$pt($a0 - $o, $edge, $zLow), $pt($a1 + $o, $edge, $zLow), $pt($a1 + $o, $mid, $zRidge), $pt($a0 - $o, $mid, $zRidge)], 'areaM2' => round($rafterLen * $lr / 10000, 2)];
            }
            foreach ([$a0, $a1] as $a) {
                $gables[] = $this->gable($roof, $a === $a0 ? 'A' : 'B', [$pt($a, $c0, $zTop), $pt($a, $c1, $zTop), $pt($a, $mid, $zRidge)], $span * $rise / 2);
            }
            $ridge = ['from' => $pt($a0 - $o, $mid, $zRidge), 'to' => $pt($a1 + $o, $mid, $zRidge)];
            $n = (int) ceil($lr / $roof->spacing) + 1;
            for ($i = 0; $i < $n; ++$i) {
                $al = $a0 - $o + $i * $lr / max(1, $n - 1);
                foreach ([-1, 1] as $side) {
                    $rafterLines[] = ['from' => $pt($al, $mid + $side * ($half + $o), $zLow), 'to' => $pt($al, $mid, $zRidge)];
                }
            }
            $pieces = 2 * $n;
            $coverM2 = 2 * $rafterLen * $lr / 10000;
            $battenMl = 2 * ((int) ceil($rafterLen / self::BATTEN_SPACING_CM) + 1) * $lr / 100;
            $ridgeMl = $lr / 100;
            $ridgeLen = $a1 - $a0;
            if ($ridgeLen > 475) {
                $issues[] = $this->issue($roof, 'info', 'roof.ridge', sprintf('Cumbrera de %s m: verificar apoyos intermedios (muros transversales o pilares) para que no supere la luz de la viga.', number_format($ridgeLen / 100, 2, ',', '')));
            }
            $eaves = [$c0, $c1];
        } else {
            $lowIsFirst = in_array($roof->dir, ['N', 'W'], true);
            $low = $lowIsFirst ? $c0 : $c1;
            $high = $lowIsFirst ? $c1 : $c0;
            $rise = $span * $s;
            $run = $span;
            $rafterLen = hypot($span + 2 * $o, $rise + 2 * $o * $s);
            $lowOuter = $low + ($lowIsFirst ? -$o : $o);
            $highOuter = $high + ($lowIsFirst ? $o : -$o);
            $zLow = $zTop - $o * $s;
            $zHigh = $zTop + $rise + $o * $s;
            $planes[] = ['pts' => [$pt($a0 - $o, $lowOuter, $zLow), $pt($a1 + $o, $lowOuter, $zLow), $pt($a1 + $o, $highOuter, $zHigh), $pt($a0 - $o, $highOuter, $zHigh)], 'areaM2' => round($rafterLen * $lr / 10000, 2)];
            foreach ([$a0, $a1] as $a) {
                $gables[] = $this->gable($roof, $a === $a0 ? 'A' : 'B', [$pt($a, $low, $zTop), $pt($a, $high, $zTop), $pt($a, $high, $zTop + $rise)], $span * $rise / 2);
            }
            // Muro alto: el muro del lado alto se levanta hasta la cumbre del faldón (parte fija del techo a un agua).
            $gables[] = $this->gable($roof, 'H', [$pt($a0, $high, $zTop), $pt($a1, $high, $zTop), $pt($a1, $high, $zTop + $rise), $pt($a0, $high, $zTop + $rise)], ($a1 - $a0) * $rise, true);
            $n = (int) ceil($lr / $roof->spacing) + 1;
            for ($i = 0; $i < $n; ++$i) {
                $al = $a0 - $o + $i * $lr / max(1, $n - 1);
                $rafterLines[] = ['from' => $pt($al, $lowOuter, $zLow), 'to' => $pt($al, $highOuter, $zHigh)];
            }
            $pieces = $n;
            $coverM2 = $rafterLen * $lr / 10000;
            $battenMl = ((int) ceil($rafterLen / self::BATTEN_SPACING_CM) + 1) * $lr / 100;
            $ridgeMl = 0.0;
            $eaves = [$c0, $c1];
        }

        $masonryM2 = 0.0;
        foreach ($gables as $g) {
            if ($g['enabled']) {
                $masonryM2 += $g['areaM2'];
            }
        }

        // Los cabios apoyan sobre muros portantes del último nivel en las dos líneas de alero.
        foreach ($eaves as $line) {
            $covered = $this->coverage($walls, $alongX ? Axis::X : Axis::Y, (int) round($line / Hcca::GRID_CM), $a0, $a1);
            if ($covered < 0.8 * ($a1 - $a0)) {
                $issues[] = $this->issue($roof, 'warn', 'roof.support', 'Falta muro portante bajo un lateral del techo: los cabios deben apoyar sobre muros de ≥ 15 cm con encadenado (viga corona).');
                break;
            }
        }

        $section = Hcca::timberSections()[$roof->section];
        $maxRun = $section['maxSpanCm'] * (40 / $roof->spacing) ** (1 / 3);
        if ($run > $maxRun + 0.001) {
            $issues[] = $this->issue($roof, 'error', 'roof.rafter-span', sprintf('Luz horizontal del cabio de %s m excede el máximo referencial de %s m para %s a %d cm. Use una sección mayor, menor separación o agregue apoyos.', number_format($run / 100, 2, ',', ''), number_format($maxRun / 100, 2, ',', ''), $section['label'], $roof->spacing));
        }
        $commercial = array_find(Hcca::TIMBER_LENGTHS_CM, static fn (int $l): bool => $l >= $rafterLen - 0.001);
        if (null === $commercial) {
            $issues[] = $this->issue($roof, 'warn', 'roof.length', sprintf('Un cabio de %s m supera el largo comercial máximo (6,00 m).', number_format($rafterLen / 100, 2, ',', '')));
            $commercial = (int) ceil($rafterLen / 10) * 10;
        }
        if ($roof->slopePct < 15 || $roof->slopePct > 70) {
            $issues[] = $this->issue($roof, 'info', 'roof.slope', 'Pendiente fuera del rango habitual (15–70 %): verificar con el tipo de cubierta elegido.');
        }
        if ($masonryM2 > 0) {
            $issues[] = $this->issue($roof, 'info', 'roof.gable', sprintf('Hastiales de bloque del techo %s (≈ %s m²): se computan por superficie (+10 %%) y no entran en el despiece de cortes. Se pueden quitar o cambiar de espesor al elegirlos.', $roof->id, number_format($masonryM2, 1, ',', '')));
        }

        $byT = [];
        foreach ($gables as $g) {
            if ($g['enabled']) {
                $byT[$g['thickness']] = ($byT[$g['thickness']] ?? 0.0) + $g['areaM2'];
            }
        }

        return [
            'id' => $roof->id,
            'level' => $roof->level,
            'type' => $roof->type->value,
            'issues' => $issues,
            'geometry' => [
                'rect' => ['x0' => $x0, 'y0' => $y0, 'x1' => $x1, 'y1' => $y1],
                'overhang' => $o,
                'zTop' => $zTop,
                'riseCm' => round($rise, 1),
                'rafterLenCm' => round($rafterLen, 1),
                'planes' => $planes,
                'gables' => $gables,
                'ridge' => $ridge,
                'rafters' => $rafterLines,
                'dir' => $roof->dir,
            ],
            'bom' => [
                'section' => $roof->section,
                'raftersCount' => $pieces,
                'raftersCommercialCm' => $commercial,
                'ridgeMl' => round($ridgeMl, 2),
                'battenMl' => round($battenMl, 1),
                'coverM2' => round($coverM2, 2),
                'gableMasonryM2' => round($masonryM2, 2),
                'gableByThickness' => array_map(static fn (float $m2): float => round($m2, 2), $byT),
            ],
        ];
    }

    /**
     * Hastial (o muro alto): polígono en el plano vertical del extremo, con su área y los bloques que lleva.
     *
     * @param list<array{float, float, float}> $pts
     *
     * @return array<string, mixed>
     */
    private function gable(RoofPart $roof, string $side, array $pts, float $areaCm2, bool $fixed = false): array
    {
        $enabled = $fixed || ('A' === $side ? $roof->gableA : $roof->gableB);
        $m2 = $areaCm2 / 10000;

        return [
            'id' => $roof->id.':'.$side,
            'side' => $side,
            'pts' => $pts,
            'areaM2' => round($m2, 2),
            'enabled' => $enabled,
            'fixed' => $fixed,
            'thickness' => $roof->gableT,
            'blocks' => $enabled ? (int) ceil($m2 / self::BLOCK_FACE_M2 * 1.10) : 0,
        ];
    }

    /**
     * Longitud (cm) del alero cubierta por muros portantes colineales (unión de intervalos).
     *
     * @param list<Wall> $walls
     */
    private function coverage(array $walls, Axis $axis, int $lineUnits, float $a0, float $a1): float
    {
        $spans = [];
        foreach ($walls as $w) {
            if ($w->axis() === $axis && $w->lineU() === $lineUnits && $w->isLoadBearing()) {
                $s = max($w->startU() * Hcca::GRID_CM, $a0);
                $e = min($w->endU() * Hcca::GRID_CM, $a1);
                if ($e > $s) {
                    $spans[] = [$s, $e];
                }
            }
        }
        sort($spans);
        $covered = 0.0;
        $cursor = -INF;
        foreach ($spans as [$s, $e]) {
            $covered += max(0.0, $e - max($s, $cursor));
            $cursor = max($cursor, $e);
        }

        return $covered;
    }

    /** @return array<string, mixed> */
    private function issue(RoofPart $roof, string $severity, string $code, string $message): array
    {
        return ['severity' => $severity, 'code' => $code, 'message' => $message, 'level' => 2, 'ref' => $roof->id, 'x' => $roof->x, 'y' => $roof->y];
    }
}
