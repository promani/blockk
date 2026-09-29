<?php

declare(strict_types=1);

namespace App\Domain\Roof;

use App\Domain\Hcca;
use App\Domain\LevelAnalysis;
use App\Domain\Model\Axis;
use App\Domain\Model\Project;
use App\Domain\Model\RoofType;
use App\Domain\Model\Wall;

/**
 * Techo a dos aguas (cumbrera central) o a un agua, apoyado sobre el nivel más alto con muros. La planta es la caja envolvente
 * de esos muros. Calcula planos de cubierta, cabios (a la separación pedida), cumbrera, clavaderas y la mampostería adicional
 * de los hastiales (estimada por superficie; no entra en la optimización de cortes).
 */
final class RoofPlanner
{
    private const int BATTEN_SPACING_CM = 40;

    /** @param list<LevelAnalysis> $levels */
    public function plan(Project $project, array $levels): RoofPlan
    {
        $roof = $project->roof;
        $top = $project->topLevelIndex();
        if (RoofType::None === $roof->type || $top < 0) {
            return new RoofPlan('none');
        }
        $walls = $levels[$top]->level->walls;
        $G = Hcca::GRID_CM;
        $x0 = min(array_map(static fn (Wall $w): int => $w->x1, $walls)) * $G;
        $x1 = max(array_map(static fn (Wall $w): int => $w->x2, $walls)) * $G;
        $y0 = min(array_map(static fn (Wall $w): int => $w->y1, $walls)) * $G;
        $y1 = max(array_map(static fn (Wall $w): int => $w->y2, $walls)) * $G;
        $zTop = ($top + 1) * (float) Hcca::LEVEL_HEIGHT_CM;
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
        $masonryM2 = 0.0;

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
                $gables[] = ['pts' => [$pt($a, $c0, $zTop), $pt($a, $c1, $zTop), $pt($a, $mid, $zRidge)]];
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
            $masonryM2 = $span * $rise / 10000;
            $coverM2 = 2 * $rafterLen * $lr / 10000;
            $battenMl = 2 * ((int) ceil($rafterLen / self::BATTEN_SPACING_CM) + 1) * $lr / 100;
            $ridgeMl = $lr / 100;
            $ridgeLen = $a1 - $a0;
            if ($ridgeLen > 475) {
                $issues[] = $this->issue('info', 'roof.ridge', sprintf('Cumbrera de %s m: verificar apoyos intermedios (muros transversales o pilares) para que no supere la luz de la viga.', number_format($ridgeLen / 100, 2, ',', '')));
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
                $gables[] = ['pts' => [$pt($a, $low, $zTop), $pt($a, $high, $zTop), $pt($a, $high, $zTop + $rise)]];
            }
            $gables[] = ['pts' => [$pt($a0, $high, $zTop), $pt($a1, $high, $zTop), $pt($a1, $high, $zTop + $rise), $pt($a0, $high, $zTop + $rise)]];
            $n = (int) ceil($lr / $roof->spacing) + 1;
            for ($i = 0; $i < $n; ++$i) {
                $al = $a0 - $o + $i * $lr / max(1, $n - 1);
                $rafterLines[] = ['from' => $pt($al, $lowOuter, $zLow), 'to' => $pt($al, $highOuter, $zHigh)];
            }
            $pieces = $n;
            $masonryM2 = $rise * (($a1 - $a0) + $span) / 10000;
            $coverM2 = $rafterLen * $lr / 10000;
            $battenMl = ((int) ceil($rafterLen / self::BATTEN_SPACING_CM) + 1) * $lr / 100;
            $ridgeMl = 0.0;
            $eaves = [$c0, $c1];
        }

        // Los cabios apoyan sobre muros portantes del último nivel en las dos líneas de alero.
        foreach ($eaves as $line) {
            $covered = $this->coverage($walls, $alongX ? Axis::X : Axis::Y, (int) round($line / Hcca::GRID_CM), $a0, $a1);
            if ($covered < 0.8 * ($a1 - $a0)) {
                $issues[] = $this->issue('warn', 'roof.support', 'Falta muro portante bajo un lateral del techo: los cabios deben apoyar sobre muros de ≥ 15 cm con encadenado (viga corona).');
                break;
            }
        }

        $section = Hcca::timberSections()[$roof->section];
        $maxRun = $section['maxSpanCm'] * (40 / $roof->spacing) ** (1 / 3);
        if ($run > $maxRun + 0.001) {
            $issues[] = $this->issue('error', 'roof.rafter-span', sprintf('Luz horizontal del cabio de %s m excede el máximo referencial de %s m para %s a %d cm. Use una sección mayor, menor separación o agregue apoyos.', number_format($run / 100, 2, ',', ''), number_format($maxRun / 100, 2, ',', ''), $section['label'], $roof->spacing));
        }
        $commercial = array_find(Hcca::TIMBER_LENGTHS_CM, static fn (int $l): bool => $l >= $rafterLen - 0.001);
        if (null === $commercial) {
            $issues[] = $this->issue('warn', 'roof.length', sprintf('Un cabio de %s m supera el largo comercial máximo (6,00 m).', number_format($rafterLen / 100, 2, ',', '')));
            $commercial = (int) ceil($rafterLen / 10) * 10;
        }
        if ($roof->slopePct < 15 || $roof->slopePct > 70) {
            $issues[] = $this->issue('info', 'roof.slope', 'Pendiente fuera del rango habitual (15–70 %): verificar con el tipo de cubierta elegido.');
        }
        if ($masonryM2 > 0) {
            $issues[] = $this->issue('info', 'roof.gable', sprintf('Los hastiales/cargas de mampostería del techo (≈ %s m²) se computan por superficie y no están en el despiece de bloques.', number_format($masonryM2, 1, ',', '')));
        }

        return new RoofPlan($roof->type->value, [
            'rect' => ['x0' => $x0, 'y0' => $y0, 'x1' => $x1, 'y1' => $y1],
            'zTop' => $zTop,
            'riseCm' => round($rise, 1),
            'rafterLenCm' => round($rafterLen, 1),
            'planes' => $planes,
            'gables' => $gables,
            'ridge' => $ridge,
            'rafters' => $rafterLines,
            'dir' => $roof->dir,
        ], $issues, [
            'section' => $roof->section,
            'raftersCount' => $pieces,
            'raftersCommercialCm' => $commercial,
            'ridgeMl' => round($ridgeMl, 2),
            'battenMl' => round($battenMl, 1),
            'coverM2' => round($coverM2, 2),
            'gableMasonryM2' => round($masonryM2, 2),
        ]);
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
    private function issue(string $severity, string $code, string $message): array
    {
        return ['severity' => $severity, 'code' => $code, 'message' => $message, 'level' => 2, 'ref' => null, 'x' => null, 'y' => null];
    }
}
