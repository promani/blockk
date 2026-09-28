<?php

declare(strict_types=1);

namespace App\Domain\Templates;

use App\Domain\Hcca;
use App\Domain\Model\Axis;
use App\Domain\Model\OpeningKind;
use App\Domain\Model\Project;
use App\Domain\Model\ProjectFactory;

/** Miniatura SVG vectorial de la planta de un proyecto (PB sólida, PA en trazo verde). */
final class TemplateThumbnail
{
    /** @param array<string, mixed> $projectData proyecto normalizado en formato JSON */
    public static function svg(array $projectData, int $width = 320, int $height = 200): string
    {
        $project = ProjectFactory::fromArray($projectData);
        $walls = [];
        foreach ($project->levels as $li => $level) {
            foreach ($level->walls as $w) {
                $walls[] = [$li, $w];
            }
        }
        if ([] === $walls) {
            return sprintf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" role="img" aria-label="Proyecto vacío"></svg>', $width, $height);
        }
        $g = Hcca::GRID_CM;
        $minX = min(array_map(static fn (array $e): int => $e[1]->x1, $walls)) * $g - 25;
        $maxX = max(array_map(static fn (array $e): int => $e[1]->x2, $walls)) * $g + 25;
        $minY = min(array_map(static fn (array $e): int => $e[1]->y1, $walls)) * $g - 25;
        $maxY = max(array_map(static fn (array $e): int => $e[1]->y2, $walls)) * $g + 25;
        $pad = 14;
        $scale = min(($width - 2 * $pad) / ($maxX - $minX), ($height - 2 * $pad) / ($maxY - $minY));
        $ox = ($width - ($maxX - $minX) * $scale) / 2 - $minX * $scale;
        $oy = ($height - ($maxY - $minY) * $scale) / 2 - $minY * $scale;

        $rect = static function (float $x, float $y, float $w, float $h, string $attrs) use ($scale, $ox, $oy): string {
            return sprintf('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" %s/>', $x * $scale + $ox, $y * $scale + $oy, $w * $scale, $h * $scale, $attrs);
        };
        $footprint = static function ($w) use ($g): array {
            $t = Hcca::ticksToCm($w->t);
            if (Axis::X === $w->axis()) {
                return [$w->x1 * $g - $t / 2, $w->y1 * $g - $t / 2, ($w->x2 - $w->x1) * $g + $t, $t];
            }

            return [$w->x1 * $g - $t / 2, $w->y1 * $g - $t / 2, $t, ($w->y2 - $w->y1) * $g + $t];
        };

        $svg = [sprintf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" role="img" aria-label="Planta de %s">', $width, $height, htmlspecialchars($project->name, ENT_QUOTES))];
        $svg[] = sprintf('<rect width="%d" height="%d" fill="#f7f9ff"/>', $width, $height);
        foreach ([1, 0] as $li) {
            foreach ($project->level($li)->walls as $w) {
                [$x, $y, $rw, $rh] = $footprint($w);
                $svg[] = 0 === $li ? $rect($x, $y, $rw, $rh, 'fill="#1e293b"') : $rect($x, $y, $rw, $rh, 'fill="none" stroke="#6da22a" stroke-width="1.6" stroke-dasharray="4 2"');
            }
            foreach ($project->level($li)->openings as $o) {
                $w = $project->level($li)->wall($o->wallId);
                if (null === $w || 1 === $li) {
                    continue;
                }
                $t = Hcca::ticksToCm($w->t);
                $from = ($w->startU() + $o->pos) * $g;
                $len = $o->w * $g;
                $fill = OpeningKind::Door === $o->kind ? '#f7f9ff' : '#8bc53f';
                $svg[] = Axis::X === $w->axis()
                    ? $rect($from, $w->y1 * $g - $t / 2, $len, $t, "fill=\"$fill\"")
                    : $rect($w->x1 * $g - $t / 2, $from, $t, $len, "fill=\"$fill\"");
            }
        }
        $svg[] = '</svg>';

        return implode('', $svg);
    }
}
