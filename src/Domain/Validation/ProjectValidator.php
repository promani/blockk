<?php

declare(strict_types=1);

namespace App\Domain\Validation;

use App\Domain\Hcca;
use App\Domain\LevelAnalysis;
use App\Domain\Model\Axis;
use App\Domain\Model\JoistField;
use App\Domain\Model\Opening;
use App\Domain\Model\Project;
use App\Domain\Model\Wall;
use App\Domain\Timber\TimberPlan;

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
    public function validate(Project $project, array $levels, TimberPlan $timber): array
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

        foreach ($levels as $index => $analysis) {
            foreach ($analysis->level->walls as $wall) {
                $this->wall($issues, $index, $wall, $analysis);
            }
            $this->openings($issues, $index, $analysis);
            foreach ($analysis->courses->warnings as $w) {
                $issues[] = new Issue(Issue::WARN, 'bond', $w, $index);
            }
        }

        if (null !== $upper && !$upper->level->isEmpty()) {
            $this->upperSupport($issues, $ground, $upper, $project);
            if ([] === $ground->level->timber) {
                $issues[] = new Issue(Issue::WARN, 'timber.missing', 'La Planta Alta no tiene entrepiso: dibuje el entrepiso de madera sobre la Planta Baja (herramienta Entrepiso).', 0);
            }
        }

        foreach ($timber->issues as $t) {
            $issues[] = Issue::fromArray($t);
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
        $slenderness = Hcca::LEVEL_HEIGHT_CM / $tCm;
        $limit = $wall->isLoadBearing() ? self::MAX_SLENDERNESS_BEARING : self::MAX_SLENDERNESS_PARTITION;
        if ($slenderness > $limit) {
            $issues[] = new Issue(Issue::WARN, 'wall.slender', sprintf('Esbeltez h/t = %.0f en %s de %s cm (referencia ≤ %.0f): use mayor espesor o arriostre.', $slenderness, $label, $this->cm($tCm), $limit), $index, $wall->id, $x, $y);
        }
        if (!$wall->isLoadBearing() && isset($analysis->regions->exterior[$wall->id])) {
            $issues[] = new Issue(Issue::WARN, 'wall.exterior-thin', sprintf('Muro exterior de %s cm: las fachadas deben ser portantes (≥ 15 cm).', $this->cm($tCm)), $index, $wall->id, $x, $y);
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
        $floors = array_filter($ground->level->timber, static fn ($t): bool => $t instanceof JoistField);
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
                $mx = intdiv($wall->x1 + $wall->x2, 2);
                $my = intdiv($wall->y1 + $wall->y2, 2);
                $onFloor = array_any($floors, static fn (JoistField $f): bool => $mx >= $f->x && $mx <= $f->x + $f->w && $my >= $f->y && $my <= $f->y + $f->h);
                $issues[] = $onFloor
                    ? new Issue(Issue::INFO, 'support.partition', 'Tabique de PA sobre entrepiso de madera: prever tirante doble bajo el tabique.', 1, $wall->id, $wall->x1, $wall->y1)
                    : new Issue(Issue::ERROR, 'support.partition', 'Tabique de PA fuera del entrepiso y sin muro debajo: no tiene apoyo.', 1, $wall->id, $wall->x1, $wall->y1);
            }
        }
    }

    /** Longitud (unidades) de $wall cubierta por muros portantes de PB colineales. */
    private function coverage(LevelAnalysis $ground, Wall $wall): int
    {
        $spans = [];
        foreach ($ground->level->walls as $g) {
            if ($g->axis() === $wall->axis() && $g->lineU() === $wall->lineU() && $g->isLoadBearing()) {
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
