<?php

declare(strict_types=1);

namespace App\Domain\Solar;

use App\Domain\Geometry\OpeningPlacement;
use App\Domain\Geometry\Room;
use App\Domain\Hcca;
use App\Domain\LevelAnalysis;
use App\Domain\Model\Axis;
use App\Domain\Model\OpeningKind;
use App\Domain\Model\Project;
use App\Domain\Model\Wall;

/**
 * Sugeridor bioclimático de aberturas (reglas determinísticas, sin IA generativa):
 *
 *  1. Ganancia solar de invierno: en cada ambiente con fachada, propone una ventana en la cara mejor
 *     asoleada en invierno (norte en el hemisferio sur, sur en el norte).
 *  2. Ventilación cruzada de verano: propone la ventana opuesta (o, si no hay cara opuesta, la ortogonal)
 *     para forzar circulación de aire.
 *  3. Protege de la carga solar de la tarde de verano: en fachadas muy castigadas propone la ventana
 *     más chica y avisa sobre ventanas grandes ya colocadas.
 *
 * Las posiciones respetan jambas >= 25 cm respecto de esquinas y otros vanos (OpeningPlacement), de
 * modo que los dinteles U nunca compiten por el mismo apoyo, y se centran en el tramo libre.
 */
final class OpeningSuggester
{
    private const float FAVORABLE_RATIO = 0.6;
    private const float MIN_ROOM_M2 = 4.0;
    private const array PRESET_BY_WIDTH = [5 => 'V62', 8 => 'V100', 10 => 'V125', 12 => 'V150'];

    public function __construct(
        private readonly ExposureAnalyzer $exposure = new ExposureAnalyzer(),
        private readonly OpeningPlacement $placement = new OpeningPlacement(),
    ) {
    }

    /**
     * @param list<LevelAnalysis> $levels
     *
     * @return list<array<string, mixed>>
     */
    public function suggest(Project $project, array $levels): array
    {
        $out = [];
        $n = 0;
        foreach ($levels as $li => $la) {
            if ($la->level->isEmpty()) {
                continue;
            }
            $walls = [];
            foreach ($la->regions->exterior as $wallId => $normal) {
                $wall = $la->level->wall($wallId);
                if (null === $wall) {
                    continue;
                }
                $walls[$wallId] = [
                    'wall' => $wall,
                    'normal' => $normal,
                    'winter' => $this->exposure->winterGain($normal, $project->north, $project->latitude),
                    'summer' => $this->exposure->summerLoad($normal, $project->north, $project->latitude),
                    'facing' => $this->exposure->facing($normal, $project->north),
                ];
            }
            if ([] === $walls) {
                continue;
            }
            $maxWinter = max(array_column($walls, 'winter'));
            $maxSummer = max(array_column($walls, 'summer'));

            foreach ($la->regions->rooms as $room) {
                if ($room->netM2 < self::MIN_ROOM_M2) {
                    continue;
                }
                $segments = $this->segments($la, $room, $walls);
                if ([] === $segments) {
                    continue;
                }
                $this->roomSuggestions($out, $n, $li, $la, $room, $segments, $maxWinter, $maxSummer);
            }
        }

        return $out;
    }

    /**
     * Tramos de fachada cuya cara interior toca el ambiente.
     *
     * @param array<string, array<string, mixed>> $walls
     *
     * @return list<array<string, mixed>>
     */
    private function segments(LevelAnalysis $la, Room $room, array $walls): array
    {
        $segments = [];
        foreach ($walls as $wallId => $info) {
            $normal = $info['normal'];
            $innerSide = ($normal[0] < 0 || $normal[1] < 0) ? 'pos' : 'neg';
            $ids = $la->regions->faces[$wallId][$innerSide] ?? [];
            $start = null;
            foreach ([...$ids, -1] as $i => $id) {
                if ($id === $room->id && null === $start) {
                    $start = $i;
                } elseif ($id !== $room->id && null !== $start) {
                    $segments[] = [...$info, 'from' => $start, 'to' => $i, 'wallId' => $wallId];
                    $start = null;
                }
            }
        }

        return $segments;
    }

    /**
     * @param list<array<string, mixed>> $out
     * @param list<array<string, mixed>> $segments
     */
    private function roomSuggestions(array &$out, int &$n, int $li, LevelAnalysis $la, Room $room, array $segments, float $maxWinter, float $maxSummer): void
    {
        foreach ($segments as $k => $s) {
            $segments[$k]['has'] = $this->hasWindow($la, $s);
        }
        usort($segments, static fn (array $a, array $b): int => $b['winter'] <=> $a['winter']);
        $best = $segments[0];
        $pair = 'p'.$li.'-'.$room->id;

        $bestFavorable = $maxWinter > 0.01 && $best['winter'] >= self::FAVORABLE_RATIO * $maxWinter;
        $opposite = null;
        foreach ($segments as $s) {
            if ($s['wallId'] === $best['wallId']) {
                continue;
            }
            $dot = $s['normal'][0] * $best['normal'][0] + $s['normal'][1] * $best['normal'][1];
            if (null === $opposite || $dot < $opposite['dot']) {
                $opposite = [...$s, 'dot' => $dot];
            }
        }

        $proposals = [];
        if (!$best['has']) {
            $hot = $maxSummer > 0.01 && $best['summer'] >= self::FAVORABLE_RATIO * $maxSummer;
            $proposals[] = [
                'seg' => $best,
                'width' => $hot ? 5 : ($bestFavorable ? 10 : 8),
                'type' => 'solar',
                'reason' => $bestFavorable
                    ? sprintf('%s: fachada %s con la mejor ganancia solar de invierno. Ventana amplia para captar sol.', $room->toArray()['name'], $best['facing'])
                    : sprintf('%s: única fachada disponible (%s). Ventana para luz natural y ventilación.', $room->toArray()['name'], $best['facing']),
            ];
        }
        if (null !== $opposite && !$opposite['has']) {
            $hot = $maxSummer > 0.01 && $opposite['summer'] >= self::FAVORABLE_RATIO * $maxSummer;
            $proposals[] = [
                'seg' => $opposite,
                'width' => $hot ? 5 : 8,
                'type' => 'cross',
                'reason' => sprintf('%s: ventana en fachada %s enfrentada a la %s para ventilación cruzada de verano%s.', $room->toArray()['name'], $opposite['facing'], $best['facing'], $hot ? ' (reducida: recibe sol fuerte de la tarde)' : ''),
            ];
        } elseif (null === $opposite) {
            $out[] = [
                'id' => 's'.(++$n),
                'level' => $li,
                'type' => 'info',
                'apply' => false,
                'wall' => $best['wallId'],
                'reason' => sprintf('%s tiene una sola fachada: no permite ventilación cruzada. Considere un ventiluz hacia un ambiente contiguo o un patio.', $room->toArray()['name']),
            ];
        }

        foreach ($proposals as $p) {
            $placed = $this->place($la, $p['seg'], $p['width']);
            if (null === $placed) {
                continue;
            }
            $out[] = [
                'id' => 's'.(++$n),
                'level' => $li,
                'type' => $p['type'],
                'apply' => true,
                'wall' => $p['seg']['wallId'],
                'pos' => $placed[0],
                'w' => $placed[1],
                'preset' => self::PRESET_BY_WIDTH[$placed[1]] ?? 'V100',
                'kind' => OpeningKind::Window->value,
                'facing' => $p['seg']['facing'],
                'pair' => 'cross' === $p['type'] || null !== $opposite ? $pair : null,
                'reason' => $p['reason'],
            ];
        }

        foreach ($segments as $s) {
            if ($s['has'] && $maxSummer > 0.01 && $s['summer'] >= self::FAVORABLE_RATIO * $maxSummer && $this->hasWideWindow($la, $s)) {
                $out[] = [
                    'id' => 's'.(++$n),
                    'level' => $li,
                    'type' => 'shade',
                    'apply' => false,
                    'wall' => $s['wallId'],
                    'reason' => sprintf('Fachada %s con ventana grande: recibe la mayor carga solar de la tarde en verano. Prever alero, parasol o postigos.', $s['facing']),
                ];
            }
        }
    }

    /** @param array<string, mixed> $s @return array{int, int}|null [pos, ancho] en unidades */
    private function place(LevelAnalysis $la, array $s, int $width): ?array
    {
        /** @var Wall $wall */
        $wall = $s['wall'];
        $best = null;
        foreach ($this->placement->freeIntervals($la->level, $la->topology, $wall) as [$f, $t]) {
            $from = max($f, $s['from']);
            $to = min($t, $s['to']);
            if ($to - $from > ($best[1] ?? 0)) {
                $best = [$from, $to - $from];
            }
        }
        if (null === $best) {
            return null;
        }
        foreach ([$width, 10, 8, 5] as $w) {
            if ($w <= $width && $w <= $best[1]) {
                return [$best[0] + intdiv($best[1] - $w, 2), $w];
            }
        }

        return null;
    }

    /** @param array<string, mixed> $s */
    private function hasWindow(LevelAnalysis $la, array $s): bool
    {
        return array_any($la->level->openingsOn($s['wallId']), static fn ($o): bool => OpeningKind::Window === $o->kind && $o->endU() > $s['from'] && $o->pos < $s['to']);
    }

    /** @param array<string, mixed> $s */
    private function hasWideWindow(LevelAnalysis $la, array $s): bool
    {
        return array_any($la->level->openingsOn($s['wallId']), static fn ($o): bool => OpeningKind::Window === $o->kind && $o->w >= 10 && $o->endU() > $s['from'] && $o->pos < $s['to']);
    }
}
