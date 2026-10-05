<?php

declare(strict_types=1);

namespace App\Domain\Validation;

use App\Domain\Geometry\NodeType;
use App\Domain\Hcca;
use App\Domain\LevelAnalysis;
use App\Domain\Model\Axis;
use App\Domain\Model\Opening;
use App\Domain\Model\Project;
use App\Domain\Model\Slab;
use App\Domain\Model\Wall;

/**
 * Reglas constructivas de predimensionado del editor. NO reemplazan el cálculo estructural
 * (CIRSOC 501 / Eurocódigo 6): son controles de coherencia geométrica y de apoyos.
 */
final class ProjectValidator
{
    /** Esbeltez máxima h/t de referencia: portantes / tabiques no portantes. */
    private const float MAX_SLENDERNESS_BEARING = 21.0;
    private const float MAX_SLENDERNESS_PARTITION = 30.0;
    private const float MAX_OPENING_RATIO = 0.6;
    private const int MAX_LINTEL_SPAN_U = 16; // 2,00 m

    /**
     * @param list<LevelAnalysis> $levels
     *
     * @return list<Issue>
     */
    public function validate(Project $project, array $levels): array
    {
        $issues = [];
        $ground = $levels[0];
        $upper = $levels[1] ?? null;

        if (!$project->level(1)->isEmpty() && $project->level(0)->isEmpty()) {
            $issues[] = new Issue(Issue::ERROR, 'level.orphan', 'El Nivel 2 (Planta Alta) no puede existir sin Nivel 1 (Planta Baja).', 1);
        }
        if (!$project->level(1)->isEmpty()) {
            $issues[] = new Issue(Issue::INFO, 'height.total', sprintf('Altura autoportante total: %.2f m (límite estructural %.2f m: PB + PA).', 2 * Hcca::LEVEL_HEIGHT_CM / 100, Hcca::MAX_TOTAL_HEIGHT_CM / 100));
        }

        $this->columns($issues, $project);

        foreach ($levels as $index => $analysis) {
            foreach ($analysis->level->walls as $wall) {
                $this->wall($issues, $index, $wall, $analysis);
                // Más de 3,00 m sólo si no hay otro nivel encima (y nunca por encima del límite autoportante de 6,00 m).
                if ($wall->h > Hcca::COURSES && (1 === $index || $project->upperEnabled())) {
                    $issues[] = new Issue(Issue::ERROR, 'wall.height', sprintf('Muro de %s m de alto: %s', $this->cm($wall->h * 25 / 100), 1 === $index ? 'la Planta Alta no puede pasar de 3,00 m (límite autoportante total 6,00 m).' : 'con Nivel 2 encima, los muros de la Planta Baja miden 3,00 m.'), $index, $wall->id, $wall->x1, $wall->y1);
                }
            }
            $this->openings($issues, $index, $analysis);
            $this->junctions($issues, $index, $analysis);
            foreach ($analysis->courses->warnings as $w) {
                $issues[] = new Issue(Issue::WARN, 'bond', $w, $index);
            }
        }

        if (null !== $upper && !$upper->level->isEmpty()) {
            $this->upperSupport($issues, $ground, $upper, $project);
        }

        usort($issues, static fn (Issue $a, Issue $b): int => [self::rank($a->severity), $a->level] <=> [self::rank($b->severity), $b->level]);

        return $issues;
    }

    private static function rank(string $severity): int
    {
        return match ($severity) {
            Issue::ERROR => 0,
            Issue::WARN => 1,
            default => 2,
        };
    }

    /** @param list<Issue> $issues */
    private function wall(array &$issues, int $index, Wall $wall, LevelAnalysis $analysis): void
    {
        $label = $wall->isLoadBearing() ? 'muro portante' : 'tabique';
        $tCm = Hcca::ticksToCm($wall->t);
        $x = $wall->x1;
        $y = $wall->y1;

        if ($wall->lengthU() < 2) {
            $issues[] = new Issue(Issue::WARN, 'wall.short', sprintf('Muro de %s cm: demasiado corto para trabar con bloques (mín. 25 cm).', $this->cm($wall->lengthU() * Hcca::GRID_CM)), $index, $wall->id, $x, $y);
        }
        // En las hiladas donde el muro queda recortado por los transversales, la corrida no debe bajar de 12,5 cm.
        foreach ([0, 1] as $course) {
            $start = $analysis->topology->endCondition($wall, true, $course);
            $end = $analysis->topology->endCondition($wall, false, $course);
            if (!$start['merge'] && !$end['merge'] && $wall->lengthTicks() + $start['ext'] + $end['ext'] < Hcca::MIN_PIECE) {
                $issues[] = new Issue(Issue::WARN, 'wall.short', sprintf('Muro de %s cm entre muros gruesos: en las hiladas alternadas queda una pieza menor a 12,5 cm que no se puede colocar. Alargue el tramo o achique los muros vecinos.', $this->cm($wall->lengthU() * Hcca::GRID_CM)), $index, $wall->id, $x, $y);
                break;
            }
        }
        $slenderness = $wall->h * Hcca::BLOCK_H / Hcca::TICKS_PER_CM / $tCm;
        $limit = $wall->isLoadBearing() ? self::MAX_SLENDERNESS_BEARING : self::MAX_SLENDERNESS_PARTITION;
        if ($slenderness > $limit) {
            $issues[] = new Issue(Issue::WARN, 'wall.slender', sprintf('Esbeltez h/t = %.0f en %s de %s cm (referencia ≤ %.0f): use mayor espesor o arriostre.', $slenderness, $label, $this->cm($tCm), $limit), $index, $wall->id, $x, $y);
        }
        if (!$wall->isLoadBearing() && isset($analysis->regions->exterior[$wall->id])) {
            $issues[] = new Issue(Issue::WARN, 'wall.exterior-thin', sprintf('Muro exterior de %s cm: las fachadas deben ser portantes (≥ 15 cm).', $this->cm($tCm)), $index, $wall->id, $x, $y);
        }
    }

    /** @param list<Issue> $issues */
    private function junctions(array &$issues, int $index, LevelAnalysis $analysis): void
    {
        foreach ($analysis->topology->nodes() as $node) {
            if (!in_array($node->type(), [NodeType::Tee, NodeType::Cross], true)) {
                continue;
            }
            foreach ([\App\Domain\Model\Axis::X, \App\Domain\Model\Axis::Y] as $axis) {
                $pair = $node->armsOn($axis);
                if (2 === count($pair) && $pair[0]->t !== $pair[1]->t) {
                    $issues[] = new Issue(Issue::WARN, 'junction.thickness', sprintf(
                        'Encuentro con muros pasantes de distinto espesor (%s y %s cm): el muro transversal no apoya de manera uniforme y puede quedar un hueco de mampostería. Verificar el detalle.',
                        $this->cm(Hcca::ticksToCm($pair[0]->t)),
                        $this->cm(Hcca::ticksToCm($pair[1]->t)),
                    ), $index, null, $node->x, $node->y);
                    break;
                }
            }
        }
    }

    /** @param list<Issue> $issues */
    private function openings(array &$issues, int $index, LevelAnalysis $analysis): void
    {
        $level = $analysis->level;
        foreach ($level->walls as $wall) {
            $openings = $level->openingsOn($wall->id);
            usort($openings, static fn (Opening $a, Opening $b): int => $a->pos <=> $b->pos);
            $len = $wall->lengthTicks();
            $startPier = intdiv($analysis->topology->perpendicularThickness($wall, true), 2) + Hcca::MIN_PIER;
            $endPier = intdiv($analysis->topology->perpendicularThickness($wall, false), 2) + Hcca::MIN_PIER;
            $prevEnd = null;
            $openWidth = 0;

            foreach ($openings as $o) {
                $x = 'x' === $wall->axis()->value ? $wall->x1 + $o->pos : $wall->x1;
                $y = 'x' === $wall->axis()->value ? $wall->y1 : $wall->y1 + $o->pos;
                $from = $o->pos * Hcca::GRID;
                $to = $o->endU() * Hcca::GRID;
                $openWidth += $to - $from;
                if ($from < $startPier || $to > $len - $endPier) {
                    $issues[] = new Issue(Issue::ERROR, 'opening.pier', 'Vano a menos de 25 cm de la esquina o de un muro transversal: la jamba y el apoyo del dintel U requieren ≥ 25 cm.', $index, $o->id, $x, $y);
                }
                if (null !== $prevEnd && $from - $prevEnd < Hcca::MIN_PIER) {
                    $issues[] = new Issue(Issue::ERROR, 'opening.gap', 'Dos vanos separados por menos de 25 cm: la jamba intermedia no puede apoyar los dinteles.', $index, $o->id, $x, $y);
                }
                $prevEnd = $to;
                if ($o->lintelCourse() >= $wall->h) {
                    $issues[] = new Issue(Issue::ERROR, 'opening.height', sprintf('El vano no entra en el muro de %s m: necesita %s m más el dintel U. Subí el muro o elegí un vano más bajo.', $this->cm($wall->h * 25 / 100), $this->cm(($o->sill + $o->h) * 25 / 100)), $index, $o->id, $x, $y);
                }
                if ($o->w > self::MAX_LINTEL_SPAN_U) {
                    $issues[] = new Issue(Issue::WARN, 'opening.span', sprintf('Vano de %s cm: la luz del dintel U supera los 2,00 m de referencia; verificar con cálculo.', $this->cm($o->w * Hcca::GRID_CM)), $index, $o->id, $x, $y);
                }
            }
            if ($wall->isLoadBearing() && $len > 0 && $openWidth / $len > self::MAX_OPENING_RATIO) {
                $issues[] = new Issue(Issue::WARN, 'opening.ratio', sprintf('Los vanos ocupan el %.0f %% del muro portante: verificar la capacidad de las jambas.', 100 * $openWidth / $len), $index, $wall->id, $wall->x1, $wall->y1);
            }
        }
    }

    /** @param list<Issue> $issues */
    private function upperSupport(array &$issues, LevelAnalysis $ground, LevelAnalysis $upper, Project $project): void
    {
        foreach ($upper->level->walls as $wall) {
            $covered = $this->coverage($ground, $wall);
            $full = $covered >= $wall->lengthU();
            if ($wall->isLoadBearing()) {
                if (!$full) {
                    $issues[] = new Issue(Issue::ERROR, 'support.upper', 'Muro portante de PA sin apoyo continuo sobre un muro portante de PB: la mampostería autoportante debe descargar directamente sobre la viga corona inferior.', 1, $wall->id, $wall->x1, $wall->y1);
                } elseif (null !== ($below = $this->thinnestBelow($ground, $wall)) && $below->t < $wall->t) {
                    $issues[] = new Issue(Issue::WARN, 'support.thickness', sprintf('Muro de PA de %s cm apoya sobre un muro de PB de %s cm.', $this->cm(Hcca::ticksToCm($wall->t)), $this->cm(Hcca::ticksToCm($below->t))), 1, $wall->id, $wall->x1, $wall->y1);
                }
                continue;
            }
            if (!$full) {
                // el piso de arriba es la losa de las habitaciones (a un lado u otro del tabique) o un piso extra
                $mx = intdiv($wall->x1 + $wall->x2, 2);
                $my = intdiv($wall->y1 + $wall->y2, 2);
                $alongX = $wall->y1 === $wall->y2;
                $onRoom = 0 !== $upper->regions->roomAtCell($mx, $my) || 0 !== $upper->regions->roomAtCell($alongX ? $mx : $mx - 1, $alongX ? $my - 1 : $my);
                $onSlab = $onRoom || array_any($upper->level->slabs, static fn (Slab $s): bool => $mx >= $s->x && $mx <= $s->x + $s->w && $my >= $s->y && $my <= $s->y + $s->h);
                $issues[] = $onSlab
                    ? new Issue(Issue::INFO, 'support.partition', 'Tabique de PA sobre losa: incluir su peso en el cálculo de la losa.', 1, $wall->id, $wall->x1, $wall->y1)
                    : new Issue(Issue::ERROR, 'support.partition', 'Tabique de PA fuera del piso y sin muro debajo: no tiene apoyo.', 1, $wall->id, $wall->x1, $wall->y1);
            }
        }
    }

    /**
     * Pilares: dos en el mismo punto y los de la Planta Alta, que tienen que descargar sobre un pilar o un muro portante de abajo.
     *
     * @param list<Issue> $issues
     */
    private function columns(array &$issues, Project $project): void
    {
        foreach ($project->levels as $index => $level) {
            foreach ($level->columns as $i => $c) {
                if (array_any(array_slice($level->columns, 0, $i), static fn ($o): bool => $o->x === $c->x && $o->y === $c->y)) {
                    $issues[] = new Issue(Issue::WARN, 'column.duplicate', 'Dos pilares en el mismo punto.', $index, $c->id, $c->x, $c->y);
                }
                if (1 !== $index) {
                    continue;
                }
                $below = $project->level(0);
                $onColumn = array_any($below->columns, static fn ($o): bool => abs($o->x - $c->x) <= 1 && abs($o->y - $c->y) <= 1);
                $onWall = array_any($below->walls, static function (Wall $w) use ($c): bool {
                    $half = Hcca::ticksToCm($w->t) / Hcca::GRID_CM / 2;
                    $horizontal = $w->y1 === $w->y2;
                    [$along, $across] = $horizontal ? [$c->x, $c->y] : [$c->y, $c->x];
                    $line = $horizontal ? $w->y1 : $w->x1;

                    return $w->isLoadBearing() && $along >= $w->startU() && $along <= $w->endU() && abs($across - $line) <= $half;
                });
                if (!$onColumn && !$onWall) {
                    $issues[] = new Issue(Issue::WARN, 'support.column', 'Pilar de la Planta Alta sin apoyo: debajo no hay un pilar ni un muro portante.', 1, $c->id, $c->x, $c->y);
                }
            }
        }
    }

    /** Longitud (unidades) de $wall cubierta por muros portantes de PB colineales. */
    private function coverage(LevelAnalysis $ground, Wall $wall): int
    {
        $spans = [];
        foreach ($ground->level->walls as $g) {
            if ($g->axis() === $wall->axis() && $g->lineU() === $wall->lineU() && $g->isLoadBearing() && $g->h >= Hcca::COURSES) {
                $s = max($g->startU(), $wall->startU());
                $e = min($g->endU(), $wall->endU());
                if ($e > $s) {
                    $spans[] = [$s, $e];
                }
            }
        }
        sort($spans);
        $covered = 0;
        $cursor = PHP_INT_MIN;
        foreach ($spans as [$s, $e]) {
            $covered += max(0, $e - max($s, $cursor));
            $cursor = max($cursor, $e);
        }

        return $covered;
    }

    private function thinnestBelow(LevelAnalysis $ground, Wall $wall): ?Wall
    {
        $below = array_filter($ground->level->walls, static fn (Wall $g): bool => $g->axis() === $wall->axis() && $g->lineU() === $wall->lineU() && $g->endU() > $wall->startU() && $g->startU() < $wall->endU());
        if ([] === $below) {
            return null;
        }
        usort($below, static fn (Wall $a, Wall $b): int => $a->t <=> $b->t);

        return $below[array_key_first($below)];
    }

    private function cm(float $v): string
    {
        return rtrim(rtrim(number_format($v, 1, ',', ''), '0'), ',');
    }
}
