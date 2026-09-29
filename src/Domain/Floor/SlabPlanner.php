<?php

declare(strict_types=1);

namespace App\Domain\Floor;

use App\Domain\Geometry\RegionMap;
use App\Domain\Hcca;
use App\Domain\Model\JoistField;
use App\Domain\Model\Project;

/**
 * Losa de hormigón como piso del Nivel 2: debe apoyar sobre la superficie cerrada de abajo (igual o menor),
 * descuenta los huecos de escalera y calcula hormigón, malla y encofrado.
 */
final class SlabPlanner
{
    /** Luz de referencia de una losa maciza sin vigas intermedias. */
    private const int MAX_SPAN_CM = 400;

    /** @param list<array{float, float, float, float}> $holes */
    public function plan(Project $project, RegionMap $ground, array $holes): SlabPlan
    {
        $G = Hcca::GRID_CM;
        $slabs = [];
        $issues = [];
        $areaM2 = 0.0;
        $concreteM3 = 0.0;
        $fields = array_values(array_filter($project->level(0)->timber, static fn ($t): bool => $t instanceof JoistField));

        foreach ($project->level(1)->slabs as $i => $s) {
            $rect = [$s->x * $G, $s->y * $G, ($s->x + $s->w) * $G, ($s->y + $s->h) * $G];
            $parts = RectMath::subtract($rect, $holes);
            $area = RectMath::area($parts) / 10000;
            $areaM2 += $area;
            $concreteM3 += $area * $s->thickness / 100;
            $slabs[] = [
                'id' => $s->id,
                'rect' => ['x' => $rect[0], 'y' => $rect[1], 'w' => $rect[2] - $rect[0], 'h' => $rect[3] - $rect[1]],
                'thickness' => $s->thickness,
                'areaM2' => round($area, 2),
                'parts' => array_map(static fn (array $p): array => ['x0' => $p[0], 'y0' => $p[1], 'x1' => $p[2], 'y1' => $p[3]], $parts),
                // Huecos (escaleras) recortados a la losa: el navegador dibuja una sola placa con estos agujeros.
                'holes' => RectMath::clipTo($rect, $holes),
            ];
            if (!$ground->isInsideRooms($s->x, $s->y, $s->w, $s->h)) {
                $issues[] = $this->issue('error', 'slab.outside', 'La losa excede la superficie cerrada del nivel de abajo: debe ser igual o más chica y apoyar sobre los muros.', $s->id, $s->x, $s->y);
            }
            if (min($s->w, $s->h) * $G > self::MAX_SPAN_CM) {
                $issues[] = $this->issue('warn', 'slab.span', sprintf('Luz de %s m: una losa maciza sin vigas intermedias se verifica con cálculo (referencia hasta 4,00 m).', number_format(min($s->w, $s->h) * $G / 100, 2, ',', '')), $s->id, $s->x, $s->y);
            }
            foreach ($fields as $f) {
                if (RectMath::intersects($rect, [$f->x * $G, $f->y * $G, ($f->x + $f->w) * $G, ($f->y + $f->h) * $G])) {
                    $issues[] = $this->issue('error', 'floor.overlap', 'La losa se superpone con un entrepiso de madera: use uno u otro en cada zona.', $s->id, $s->x, $s->y);
                    break;
                }
            }
            foreach (array_slice($project->level(1)->slabs, $i + 1) as $o) {
                if (RectMath::intersects($rect, [$o->x * $G, $o->y * $G, ($o->x + $o->w) * $G, ($o->y + $o->h) * $G])) {
                    $issues[] = $this->issue('error', 'floor.overlap', 'Dos losas se superponen.', $s->id, $s->x, $s->y);
                }
            }
        }

        return new SlabPlan($slabs, $issues, [
            'areaM2' => round($areaM2, 2),
            'concreteM3' => round($concreteM3, 2),
            'meshM2' => round($areaM2 * 1.10, 1),
            'formworkM2' => round($areaM2, 2),
        ]);
    }

    /** @return array<string, mixed> */
    private function issue(string $severity, string $code, string $message, string $ref, int $x, int $y): array
    {
        return ['severity' => $severity, 'code' => $code, 'message' => $message, 'level' => 1, 'ref' => $ref, 'x' => $x, 'y' => $y];
    }
}
