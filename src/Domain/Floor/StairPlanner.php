<?php

declare(strict_types=1);

namespace App\Domain\Floor;

use App\Domain\Geometry\RegionMap;
use App\Domain\Hcca;
use App\Domain\Model\Project;
use App\Domain\Model\Stair;

/**
 * Escaleras rectas, en L y en U con descanso. La altura entre pisos (3,00 m) se reparte en contrahuellas de ~18 cm;
 * el último escalón es el piso superior. Devuelve los peldaños/descansos con su cota y los huecos que abren en el piso de arriba.
 */
final class StairPlanner
{
    private const float TARGET_RISE = 18.0;

    public function plan(Project $project, RegionMap $ground): StairPlan
    {
        $stairs = [];
        $holes = [];
        $issues = [];
        $steps = 0;
        $landingM2 = 0.0;
        $footprints = [];
        $G = Hcca::GRID_CM;

        foreach ($project->level(0)->stairs as $st) {
            $built = $this->build($st, $project->level(0)->heightCm());
            $stairs[] = $built['stair'];
            $steps += $built['stepCount'];
            $landingM2 += $built['landingM2'];
            $rise = $built['rise'];

            if ($rise < 15 || $rise > 19) {
                $issues[] = $this->issue('warn', 'stair.rise', sprintf('Contrahuella de %s cm fuera del rango cómodo (15–19 cm).', number_format($rise, 1, ',', '')), $st);
            }
            $blondel = 2 * $rise + $st->tread;
            if ($blondel < 60 || $blondel > 66) {
                $issues[] = $this->issue('warn', 'stair.blondel', sprintf('2 × contrahuella + huella = %s cm (confort: 60–66 cm). Ajuste la huella.', number_format($blondel, 0, ',', '')), $st);
            }
            foreach ($built['rects'] as $r) {
                $holes[] = $r;
                foreach ($footprints as [$other, $or]) {
                    if ($other !== $st->id && RectMath::intersects($r, $or)) {
                        $issues[] = $this->issue('error', 'stair.overlap', 'Dos escaleras se superponen.', $st);
                        break 2;
                    }
                }
                $footprints[] = [$st->id, $r];
            }
            foreach ($built['rects'] as [$rx0, $ry0, $rx1, $ry1]) {
                $cx = (int) floor($rx0 / $G + 1e-6);
                $cy = (int) floor($ry0 / $G + 1e-6);
                if (!$ground->isInsideRooms($cx, $cy, max(1, (int) ceil($rx1 / $G - 1e-6) - $cx), max(1, (int) ceil($ry1 / $G - 1e-6) - $cy))) {
                    $issues[] = $this->issue('error', 'stair.outside', 'La escalera sale del ambiente: debe quedar dentro de una habitación cerrada de la planta baja.', $st);
                    break;
                }
            }
        }
        if ([] !== $stairs && !$project->upperEnabled()) {
            $issues[] = ['severity' => 'info', 'code' => 'stair.noupper', 'message' => 'Hay una escalera pero no existe el Nivel 2: agregá el nivel con «Agregar nivel».', 'level' => 0, 'ref' => $stairs[0]['id'], 'x' => null, 'y' => null];
        }

        return new StairPlan($stairs, $holes, $issues, ['steps' => $steps, 'landingM2' => round($landingM2, 2), 'count' => count($stairs)]);
    }

    /** @return array<string, mixed> */
    private function issue(string $severity, string $code, string $message, Stair $st): array
    {
        return ['severity' => $severity, 'code' => $code, 'message' => $message, 'level' => 0, 'ref' => $st->id, 'x' => $st->x, 'y' => $st->y];
    }

    /**
     * @return array{stair: array<string, mixed>, rects: list<array{float, float, float, float}>, bbox: array{float, float, float, float}, stepCount: int, landingM2: float, rise: float}
     */
    private function build(Stair $st, int $heightCm): array
    {
        $H = (float) $heightCm;
        $n = (int) ceil($H / self::TARGET_RISE);
        $rise = $H / $n;
        $W = $st->w * Hcca::GRID_CM;
        $tread = (float) $st->tread;
        $k1 = 'straight' === $st->shape ? $n : (int) ceil($n / 2);
        $sgn = 'left' === $st->turn ? -1 : 1;

        // Marco local: u = sentido de subida, v = hacia la derecha. Cada peldaño: [u0, u1, v0, v1, cota].
        $steps = [];
        $landings = [];
        $flights = [];
        $l1 = ($k1 - 1) * $tread;
        for ($i = 1; $i < $k1; ++$i) {
            $steps[] = [($i - 1) * $tread, $i * $tread, 0.0, $W, $i * $rise];
        }
        $flights[] = [0.0, $l1, 0.0, $W];
        if ('straight' !== $st->shape) {
            $second = $n - $k1 - 1;
            if ('L' === $st->shape) {
                $landings[] = [$l1, $l1 + $W, 0.0, $W, $k1 * $rise];
                for ($j = 1; $j <= $second; ++$j) {
                    $steps[] = [$l1, $l1 + $W, $W + ($j - 1) * $tread, $W + $j * $tread, ($k1 + $j) * $rise];
                }
                $flights[] = [$l1, $l1 + $W, $W, $W + $second * $tread];
            } else {
                $landings[] = [$l1, $l1 + $W, 0.0, 2 * $W, $k1 * $rise];
                for ($j = 1; $j <= $second; ++$j) {
                    $steps[] = [$l1 - $j * $tread, $l1 - ($j - 1) * $tread, $W, 2 * $W, ($k1 + $j) * $rise];
                }
                $flights[] = [$l1 - $second * $tread, $l1, $W, 2 * $W];
            }
        }

        $toPlan = static function (array $r) use ($st, $sgn): array {
            [$u0, $u1, $v0, $v1] = $r;
            $v0 *= $sgn;
            $v1 *= $sgn;
            $pts = [[$u0, $v0], [$u1, $v1]];
            $xy = array_map(static fn (array $p): array => match ($st->dir) {
                'N' => [$p[1], -$p[0]],
                'E' => [$p[0], $p[1]],
                'S' => [-$p[1], $p[0]],
                default => [-$p[0], -$p[1]],
            }, $pts);

            return [min($xy[0][0], $xy[1][0]), min($xy[0][1], $xy[1][1]), max($xy[0][0], $xy[1][0]), max($xy[0][1], $xy[1][1])];
        };

        $all = array_merge(array_map(static fn (array $s): array => $toPlan($s), $steps), array_map(static fn (array $s): array => $toPlan($s), $landings));
        $minX = min(array_map(static fn (array $r): float => $r[0], $all));
        $minY = min(array_map(static fn (array $r): float => $r[1], $all));
        $maxX = max(array_map(static fn (array $r): float => $r[2], $all));
        $maxY = max(array_map(static fn (array $r): float => $r[3], $all));
        $dx = $st->x * Hcca::GRID_CM - $minX;
        $dy = $st->y * Hcca::GRID_CM - $minY;
        $shift = static fn (array $r): array => [round($r[0] + $dx, 2), round($r[1] + $dy, 2), round($r[2] + $dx, 2), round($r[3] + $dy, 2)];

        $outSteps = [];
        foreach ($steps as $s) {
            $r = $shift($toPlan($s));
            $outSteps[] = ['x0' => $r[0], 'y0' => $r[1], 'x1' => $r[2], 'y1' => $r[3], 'z' => round($s[4], 2)];
        }
        $outLandings = [];
        $landingM2 = 0.0;
        foreach ($landings as $l) {
            $r = $shift($toPlan($l));
            $outLandings[] = ['x0' => $r[0], 'y0' => $r[1], 'x1' => $r[2], 'y1' => $r[3], 'z' => round($l[4], 2)];
            $landingM2 += (($r[2] - $r[0]) * ($r[3] - $r[1])) / 10000;
        }
        $rects = array_map(static fn (array $f): array => $shift($toPlan($f)), $flights);
        foreach ($outLandings as $l) {
            $rects[] = [$l['x0'], $l['y0'], $l['x1'], $l['y1']];
        }

        return [
            'stair' => [
                'id' => $st->id,
                'shape' => $st->shape,
                'dir' => $st->dir,
                'riseCm' => round($rise, 2),
                'steps' => $outSteps,
                'landings' => $outLandings,
                'bbox' => ['x' => round($minX + $dx, 2), 'y' => round($minY + $dy, 2), 'w' => round($maxX - $minX, 2), 'h' => round($maxY - $minY, 2)],
            ],
            'rects' => $rects,
            'bbox' => $shift([$minX, $minY, $maxX, $maxY]),
            'stepCount' => count($steps),
            'landingM2' => $landingM2,
            'rise' => $rise,
        ];
    }
}
