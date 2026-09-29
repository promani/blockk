<?php

declare(strict_types=1);

namespace App\Domain\Timber;

use App\Domain\Hcca;
use App\Domain\Model\Axis;
use App\Domain\Model\JoistField;
use App\Domain\Model\Level;
use App\Domain\Model\TimberBeam;
use App\Domain\Model\Wall;

/**
 * Entrepiso en seco con madera escuadrada: ubica los tirantes de cada campo, verifica que apoyen
 * sobre muros portantes (>= 15 cm) de la planta baja con apoyo >= 10 cm sobre la viga corona
 * (con banda elástica), controla la luz libre y calcula cantidades comerciales.
 */
final class TimberPlanner
{
    /** Separación de los tirantes extremos respecto de la cara del muro paralelo (ticks = 2 cm). */
    private const int EDGE_GAP = 40;

    /** @param list<array{float, float, float, float}> $holes huecos de escalera (cm) que no llevan tirantes ni placa */
    public function plan(Level $ground, array $holes = []): TimberPlan
    {
        $fields = [];
        $beams = [];
        $issues = [];
        $pieces = []; // sección => [largo comercial cm => cantidad]
        $extraMl = array_fill_keys(array_keys(Hcca::timberSections()), 0.0);
        $osbM2 = 0.0;
        $bandMl = 0.0;
        $plates = 0;

        $fieldsSeen = [];
        foreach ($ground->timber as $element) {
            if ($element instanceof JoistField) {
                foreach ($fieldsSeen as $other) {
                    if ($element->x < $other->x + $other->w && $other->x < $element->x + $element->w && $element->y < $other->y + $other->h && $other->y < $element->y + $element->h) {
                        $issues[] = $this->issue('timber.overlap', 'error', 'Dos entrepisos de madera se superponen: se estarían contando dos veces los tirantes y las placas. Ajuste o elimine uno.', $element->id, $element->x, $element->y);
                    }
                }
                $fieldsSeen[] = $element;
                $field = $this->joistField($element, $ground, $issues, $holes);
                $fields[] = $field;
                foreach ($field['joists'] as $j) {
                    $this->commercial($pieces, $element->section, $j['lengthCm'], $element->id, $issues);
                }
                $perp = Axis::X === $element->dir ? $element->h : $element->w;
                $extraMl[$element->section] += 2 * $perp * Hcca::GRID_CM / 100; // cenefas de cierre
                $bandMl += 2 * $perp * Hcca::GRID_CM / 100;
                $osbM2 += $field['deckAreaM2'];
            } elseif ($element instanceof TimberBeam) {
                $beam = $this->beam($element, $ground, $issues);
                $beams[] = $beam;
                $this->commercial($pieces, $element->section, $beam['lengthCm'], $element->id, $issues);
                $plates += 2;
            }
        }

        ksort($pieces);
        $bom = [
            'pieces' => $pieces,
            'cenefaMl' => array_map(static fn (float $ml): float => round($ml, 2), $extraMl),
            'osbM2' => round($osbM2, 2),
            'osbSheets' => $osbM2 > 0 ? (int) ceil($osbM2 * 1.10 / Hcca::OSB_SHEET_M2) : 0,
            'elasticBandMl' => (int) ceil($bandMl),
            'plates' => $plates,
        ];

        return new TimberPlan($fields, $beams, $issues, $bom);
    }

    /**
     * @param list<array<string, mixed>> $issues
     * @param list<array{float, float, float, float}> $holes
     *
     * @return array<string, mixed>
     */
    private function joistField(JoistField $f, Level $ground, array &$issues, array $holes): array
    {
        $G = Hcca::GRID;
        $alongX = Axis::X === $f->dir;
        // Los extremos de los tirantes apoyan en muros perpendiculares a su dirección.
        $lineA = $alongX ? $f->x : $f->y;
        $lineB = $alongX ? $f->x + $f->w : $f->y + $f->h;
        $spanU = $lineB - $lineA;
        $perpA = $alongX ? $f->y : $f->x;
        $perpB = $alongX ? $f->y + $f->h : $f->x + $f->w;
        $bearingAxis = $alongX ? Axis::Y : Axis::X;

        $wallsA = $this->wallsOnLine($ground, $bearingAxis, $lineA);
        $wallsB = $this->wallsOnLine($ground, $bearingAxis, $lineB);
        $mid = intdiv(($perpA + $perpB) * $G, 2);
        $tA = $this->thicknessAt($wallsA, $mid);
        $tB = $this->thicknessAt($wallsB, $mid);

        // Muros paralelos a los tirantes (bordes del campo): limitan el ancho útil.
        $sideAxis = $alongX ? Axis::X : Axis::Y;
        $sideA = $this->thicknessAt($this->wallsOnLine($ground, $sideAxis, $perpA), intdiv(($lineA + $lineB) * $G, 2), 0);
        $sideB = $this->thicknessAt($this->wallsOnLine($ground, $sideAxis, $perpB), intdiv(($lineA + $lineB) * $G, 2), 0);
        $usableStart = $perpA * $G + intdiv($sideA, 2) + self::EDGE_GAP;
        $usableEnd = $perpB * $G - intdiv($sideB, 2) - self::EDGE_GAP;

        $clear = $spanU * $G - intdiv($tA + $tB, 2);
        $clearCm = Hcca::ticksToCm($clear);
        $section = Hcca::timberSections()[$f->section];

        // La luz máxima de referencia corresponde a 40 cm entre ejes; a igual deformación admisible varía con (40/separación)^(1/3).
        $maxSpan = $section['maxSpanCm'] * (40 / $f->spacing) ** (1 / 3);
        if ($clearCm > $maxSpan + 0.001) {
            $issues[] = $this->issue('timber.span', 'error', sprintf(
                'Luz libre de %s m excede el máximo referencial de %s m para %s a %d cm entre ejes. Use una sección mayor, menor separación o agregue un muro de apoyo.',
                $this->m($clearCm),
                $this->m($maxSpan),
                $section['label'],
                $f->spacing,
            ), $f->id, $f->x + intdiv($f->w, 2), $f->y + intdiv($f->h, 2));
        }

        $usable = $usableEnd - $usableStart;
        $spacing = $f->spacing * Hcca::TICKS_PER_CM;
        $count = $usable <= 0 ? 1 : (int) ceil($usable / $spacing) + 1;
        $step = $count > 1 ? $usable / ($count - 1) : 0;

        $joists = [];
        $unsupported = ['A' => 0, 'B' => 0];
        $thin = false;
        for ($i = 0; $i < $count; ++$i) {
            $p = $count > 1 ? (int) round($usableStart + $i * $step) : intdiv($usableStart + $usableEnd, 2);
            foreach (['A' => $wallsA, 'B' => $wallsB] as $end => $walls) {
                if (!$this->supports($walls, $p)) {
                    ++$unsupported[$end];
                    $thin = $thin || $this->coveredByThinWall($walls, $p);
                }
            }
            $a = $lineA * $G + intdiv($tA, 2) - $this->bearingTicks($tA);
            $b = $lineB * $G - intdiv($tB, 2) + $this->bearingTicks($tB);
            $joists[] = [
                'x1' => Hcca::ticksToCm($alongX ? $a : $p),
                'y1' => Hcca::ticksToCm($alongX ? $p : $a),
                'x2' => Hcca::ticksToCm($alongX ? $b : $p),
                'y2' => Hcca::ticksToCm($alongX ? $p : $b),
                'lengthCm' => Hcca::ticksToCm($b - $a),
            ];
        }

        // Los tirantes que cruzan un hueco de escalera no se colocan; la placa descuenta los huecos.
        $joists = array_values(array_filter($joists, static function (array $j) use ($holes): bool {
            $seg = [min($j['x1'], $j['x2']) - 3.75, min($j['y1'], $j['y2']) - 3.75, max($j['x1'], $j['x2']) + 3.75, max($j['y1'], $j['y2']) + 3.75];
            foreach ($holes as $h) {
                if (\App\Domain\Floor\RectMath::intersects($seg, $h)) {
                    return false;
                }
            }

            return true;
        }));
        $count = count($joists);
        $fieldRect = [$f->x * Hcca::GRID_CM, $f->y * Hcca::GRID_CM, ($f->x + $f->w) * Hcca::GRID_CM, ($f->y + $f->h) * Hcca::GRID_CM];
        $deckParts = \App\Domain\Floor\RectMath::subtract($fieldRect, $holes);

        foreach (['A', 'B'] as $end) {
            if (0 === $unsupported[$end]) {
                continue;
            }
            $side = $alongX ? ('A' === $end ? 'oeste' : 'este') : ('A' === $end ? 'norte' : 'sur');
            $reason = $thin ? 'Los tirantes apoyan sobre un tabique de menos de 15 cm, que no admite apoyo de madera.' : 'Apoyo mínimo 10 cm sobre viga corona con banda elástica.';
            $issues[] = $this->issue('timber.support', 'error', sprintf(
                '%d tirante(s) sin apoyo sobre muro portante (>= 15 cm) en el extremo %s del entrepiso. %s',
                $unsupported[$end],
                $side,
                $reason,
            ), $f->id, $alongX ? ('A' === $end ? $lineA : $lineB) : $f->x + intdiv($f->w, 2), $alongX ? $f->y + intdiv($f->h, 2) : ('A' === $end ? $lineA : $lineB));
        }

        return [
            'id' => $f->id,
            'dir' => $f->dir->value,
            'section' => $f->section,
            'rect' => ['x' => $f->x * Hcca::GRID_CM, 'y' => $f->y * Hcca::GRID_CM, 'w' => $f->w * Hcca::GRID_CM, 'h' => $f->h * Hcca::GRID_CM],
            'clearSpanCm' => $clearCm,
            'lengthCm' => $joists[0]['lengthCm'] ?? 0,
            'deckParts' => array_map(static fn (array $p): array => ['x0' => $p[0], 'y0' => $p[1], 'x1' => $p[2], 'y1' => $p[3]], $deckParts),
            'deckAreaM2' => round(\App\Domain\Floor\RectMath::area($deckParts) / 10000, 2),
            'deckHoles' => \App\Domain\Floor\RectMath::clipTo($fieldRect, $holes),
            'spacingCm' => $count > 1 ? round(Hcca::ticksToCm((int) round($step)), 1) : 0,
            'count' => $count,
            'joists' => $joists,
        ];
    }

    /**
     * @param list<array<string, mixed>> $issues
     *
     * @return array<string, mixed>
     */
    private function beam(TimberBeam $b, Level $ground, array &$issues): array
    {
        $G = Hcca::GRID;
        $alongX = Axis::X === $b->axis();
        $bearingAxis = $alongX ? Axis::Y : Axis::X;
        $start = $alongX ? min($b->x1, $b->x2) : min($b->y1, $b->y2);
        $end = $alongX ? max($b->x1, $b->x2) : max($b->y1, $b->y2);
        $perp = $alongX ? $b->y1 : $b->x1;

        $wallsA = $this->wallsOnLine($ground, $bearingAxis, $start);
        $wallsB = $this->wallsOnLine($ground, $bearingAxis, $end);
        foreach ([[$wallsA, $start], [$wallsB, $end]] as [$walls, $at]) {
            if (!$this->supports($walls, $perp * $G)) {
                $issues[] = $this->issue('timber.beam-support', 'error', 'Viga de madera sin apoyo sobre muro portante (>= 15 cm) en uno de sus extremos.', $b->id, $alongX ? $at : $b->x1, $alongX ? $b->y1 : $at);
            }
        }
        $tA = $this->thicknessAt($wallsA, $perp * $G);
        $tB = $this->thicknessAt($wallsB, $perp * $G);
        $clear = ($end - $start) * $G - intdiv($tA + $tB, 2);
        $section = Hcca::timberSections()[$b->section];
        if (Hcca::ticksToCm($clear) > $section['maxSpanCm']) {
            $issues[] = $this->issue('timber.span', 'error', sprintf(
                'Luz libre de %s m excede el máximo referencial de %s m para %s.',
                $this->m(Hcca::ticksToCm($clear)),
                $this->m($section['maxSpanCm']),
                $section['label'],
            ), $b->id, $b->x1, $b->y1);
        }
        $length = $clear + 2 * $this->bearingTicks(min($tA, $tB));

        return [
            'id' => $b->id,
            'section' => $b->section,
            'x1' => $b->x1 * Hcca::GRID_CM,
            'y1' => $b->y1 * Hcca::GRID_CM,
            'x2' => $b->x2 * Hcca::GRID_CM,
            'y2' => $b->y2 * Hcca::GRID_CM,
            'clearSpanCm' => Hcca::ticksToCm($clear),
            'lengthCm' => Hcca::ticksToCm($length),
        ];
    }

    /** Apoyo de 10 cm, limitado a lo que permite el espesor del muro (deja >= 5 cm de borde). */
    private function bearingTicks(int $wallT): int
    {
        return min(Hcca::cmToTicks(Hcca::JOIST_BEARING_CM), max(0, $wallT - Hcca::cmToTicks(5)));
    }

    /**
     * Muros de PB sobre la recta $axis = $line (unidades). Un muro de apoyo puede estar partido en varios
     * tramos por tabiques en T, por eso se consideran todos.
     *
     * @return list<Wall>
     */
    private function wallsOnLine(Level $ground, Axis $axis, int $line): array
    {
        return array_values(array_filter($ground->walls, static fn (Wall $w): bool => $w->axis() === $axis && $w->lineU() === $line));
    }

    private function covers(Wall $w, int $p): bool
    {
        return $p >= $w->startU() * Hcca::GRID - 200 && $p <= $w->endU() * Hcca::GRID + 200;
    }

    /** ¿Algún muro portante de la línea cubre la posición $p (ticks) sobre su eje? @param list<Wall> $walls */
    private function supports(array $walls, int $p): bool
    {
        return array_any($walls, fn (Wall $w): bool => $w->isLoadBearing() && $this->covers($w, $p));
    }

    /** @param list<Wall> $walls */
    private function coveredByThinWall(array $walls, int $p): bool
    {
        return array_any($walls, fn (Wall $w): bool => !$w->isLoadBearing() && $this->covers($w, $p));
    }

    /** Espesor del muro que cubre $p; si no hay, $default (por defecto 15 cm). @param list<Wall> $walls */
    private function thicknessAt(array $walls, int $p, int $default = Hcca::LOAD_BEARING_MIN_T): int
    {
        $wall = array_find($walls, fn (Wall $w): bool => $this->covers($w, $p));

        return $wall?->t ?? $default;
    }

    /** @param array<string, array<int, int>> $pieces @param list<array<string, mixed>> $issues */
    private function commercial(array &$pieces, string $section, float $lengthCm, string $id, array &$issues): void
    {
        $commercial = array_find(Hcca::TIMBER_LENGTHS_CM, static fn (int $l): bool => $l >= $lengthCm - 0.001);
        if (null === $commercial) {
            $issues[] = $this->issue('timber.length', 'warn', sprintf('Un tirante de %s m supera el largo comercial máximo (6,00 m).', $this->m($lengthCm)), $id, 0, 0);
            $commercial = (int) ceil($lengthCm / 10) * 10;
        }
        $pieces[$section][$commercial] = ($pieces[$section][$commercial] ?? 0) + 1;
    }

    /** @return array<string, mixed> */
    private function issue(string $code, string $severity, string $message, string $ref, int $x, int $y): array
    {
        return ['code' => $code, 'severity' => $severity, 'message' => $message, 'level' => 0, 'ref' => $ref, 'x' => $x, 'y' => $y];
    }

    private function m(float $cm): string
    {
        return number_format($cm / 100, 2, ',', '');
    }
}
