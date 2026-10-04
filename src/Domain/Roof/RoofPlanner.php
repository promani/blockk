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

    /** @param list<LevelAnalysis> $levels */
    public function plan(Project $project, array $levels): RoofPlan
    {
        $parts = [];
        $issues = [];
        foreach ($project->roofs as $part) {
            // El techo apoya sobre los muros que lo rodean: el nivel sale de ahí, no de lo que se haya elegido al dibujarlo.
            $level = $this->supportLevel($part, $levels);
            $upper = $level + 1 < count($levels) ? $levels[$level + 1]->level->walls : [];
            $built = $this->planPart($part, $level, $upper);
            $parts[] = $built;
            array_push($issues, ...$built['issues']);
        }
        if (count($parts) > 1) {
            $parts = $this->resolveOverlaps($project, $parts);
        }

        return new RoofPlan($parts, $issues);
    }

    /**
     * Techos que se superponen: donde uno queda debajo de otro más alto (p. ej. dos techos a dos aguas cruzados), esa parte no
     * existe. Se descuenta de la cubierta, los cabios y las correas (por la fracción visible de cada faldón) y de los hastiales
     * (hilada por hilada). El dibujo recorta lo mismo en el navegador.
     *
     * @param list<array<string, mixed>> $parts
     *
     * @return list<array<string, mixed>>
     */
    private function resolveOverlaps(Project $project, array $parts): array
    {
        $surfaces = array_map(fn (array $p): \Closure => $this->surface($p['geometry']['planes']), $parts);
        // Sólo se recortan techos del mismo nivel (los que se cruzan); el alero de un techo de arriba no le borra nada al
        // de abajo.
        $levelOf = array_column($parts, 'level');
        $above = static function (int $i, float $x, float $y, float $z) use ($surfaces, $levelOf): bool {
            foreach ($surfaces as $j => $sf) {
                if ($j === $i || $levelOf[$j] !== $levelOf[$i]) {
                    continue;
                }
                $h = $sf($x, $y);
                if (null !== $h && ($h > $z + 0.01 || (abs($h - $z) <= 0.01 && $j < $i))) {
                    return true;
                }
            }

            return false;
        };
        $byId = [];
        foreach ($project->roofs as $r) {
            $byId[$r->id] = $r;
        }

        foreach ($parts as $i => &$part) {
            // Fracción visible de cada faldón (muestreo cada 10 cm en planta).
            $fracSum = 0.0;
            $n = 0;
            foreach ($part['geometry']['planes'] as &$pl) {
                $eq = $this->planeEq($pl['pts']);
                $xs = array_column($pl['pts'], 0);
                $ys = array_column($pl['pts'], 1);
                $tot = 0;
                $vis = 0;
                for ($x = min($xs) + 5; $x < max($xs); $x += 10) {
                    for ($y = min($ys) + 5; $y < max($ys); $y += 10) {
                        ++$tot;
                        $vis += $above($i, $x, $y, $eq[0] * $x + $eq[1] * $y + $eq[2]) ? 0 : 1;
                    }
                }
                $pl['visible'] = $tot > 0 ? round($vis / $tot, 3) : 1.0;
                $fracSum += $pl['visible'];
                ++$n;
            }
            unset($pl);
            $frac = $n > 0 ? $fracSum / $n : 1.0;
            $b = &$part['bom'];
            $b['coverM2'] = round($b['coverM2'] * $frac, 2);
            $b['battenMl'] = round($b['battenMl'] * $frac, 1);
            $b['raftersCount'] = (int) ceil($b['raftersCount'] * $frac);
            $b['visiblePct'] = round(100 * $frac, 1);

            // Hastiales: se vuelven a trabar sin lo que queda debajo de otro techo.
            $roof = $byId[$part['id']];
            $hidden = static fn (float $x, float $y, float $z): bool => $above($i, $x, $y, $z);
            $masonry = 0.0;
            $byT = [];
            foreach ($part['geometry']['gables'] as &$g) {
                $full = $g['pieces'];
                $new = $this->gable($roof, $g['side'], $g['pts'], $g['areaM2'] * 10000, $g['fixed'], $hidden);
                $ratio = [] === $full ? 1.0 : array_sum($new['pieces']) / max(1, array_sum($full));
                $new['areaM2'] = round($g['areaM2'] * $ratio, 2);
                $g = $new;
                if ($g['enabled']) {
                    $masonry += $g['areaM2'];
                    $byT[$g['thickness']] = ($byT[$g['thickness']] ?? 0.0) + $g['areaM2'];
                }
            }
            unset($g);
            $b['gableMasonryM2'] = round($masonry, 2);
            $b['gableByThickness'] = array_map(static fn (float $m2): float => round($m2, 2), $byT);
            unset($b);
        }
        unset($part);

        return $parts;
    }

    /** z = a·x + b·y + c del plano que pasa por los tres primeros vértices. @param list<array{float, float, float}> $pts @return array{float, float, float} */
    private function planeEq(array $pts): array
    {
        [$p, $q, $r] = [$pts[0], $pts[1], $pts[2]];
        $ux = $q[0] - $p[0];
        $uy = $q[1] - $p[1];
        $uz = $q[2] - $p[2];
        $vx = $r[0] - $p[0];
        $vy = $r[1] - $p[1];
        $vz = $r[2] - $p[2];
        $nx = $uy * $vz - $uz * $vy;
        $ny = $uz * $vx - $ux * $vz;
        $nz = $ux * $vy - $uy * $vx;
        if (abs($nz) < 1e-9) {
            return [0.0, 0.0, $p[2]];
        }
        $a = -$nx / $nz;
        $b = -$ny / $nz;

        return [$a, $b, $p[2] - $a * $p[0] - $b * $p[1]];
    }

    /**
     * Altura de la cubierta de un techo en (x, y), o null fuera de su planta (con alero). Dos aguas = el menor de los dos
     * faldones (carpa); un agua = su único faldón.
     *
     * @param list<array{pts: list<array{float, float, float}>}> $planes
     */
    private function surface(array $planes): \Closure
    {
        $eqs = array_map(fn (array $pl): array => $this->planeEq($pl['pts']), $planes);
        $xs = array_merge(...array_map(static fn (array $pl): array => array_column($pl['pts'], 0), $planes));
        $ys = array_merge(...array_map(static fn (array $pl): array => array_column($pl['pts'], 1), $planes));
        [$x0, $x1, $y0, $y1] = [min($xs), max($xs), min($ys), max($ys)];

        return static function (float $x, float $y) use ($eqs, $x0, $x1, $y0, $y1): ?float {
            if ($x < $x0 || $x > $x1 || $y < $y0 || $y > $y1) {
                return null;
            }

            return min(array_map(static fn (array $e): float => $e[0] * $x + $e[1] * $y + $e[2], $eqs));
        };
    }

    /**
     * Nivel sobre el que apoya el techo: el más alto cuyos muros cubren al menos la mitad del contorno del rectángulo.
     * Si ninguno lo rodea, el guardado (limitado al último nivel con muros).
     *
     * @param list<LevelAnalysis> $levels
     */
    private function supportLevel(RoofPart $p, array $levels): int
    {
        $G = Hcca::GRID_CM;
        [$x0, $x1, $y0, $y1] = [$p->x * $G, ($p->x + $p->w) * $G, $p->y * $G, ($p->y + $p->h) * $G];
        $top = 0;
        for ($l = count($levels) - 1; $l >= 0; --$l) {
            $walls = $levels[$l]->level->walls;
            if ([] === $walls) {
                continue;
            }
            $top = max($top, $l);
            $covered = $this->coverage($walls, Axis::X, $p->y, $x0, $x1, false) + $this->coverage($walls, Axis::X, $p->y + $p->h, $x0, $x1, false)
                + $this->coverage($walls, Axis::Y, $p->x, $y0, $y1, false) + $this->coverage($walls, Axis::Y, $p->x + $p->w, $y0, $y1, false);
            if ($covered >= ($x1 - $x0 + $y1 - $y0)) { // la mitad del perímetro
                return $l;
            }
        }

        return min($p->level, $top);
    }

    /**
     * @param int        $level nivel sobre el que apoya
     * @param list<Wall> $upper muros del nivel de arriba: un borde del techo que choca contra ellos no lleva alero ni hastial
     *
     * @return array{id: string, level: int, type: string, geometry: array<string, mixed>, bom: array<string, mixed>, issues: list<array<string, mixed>>}
     */
    private function planPart(RoofPart $roof, int $level, array $upper = []): array
    {
        $G = Hcca::GRID_CM;
        $x0 = $roof->x * $G;
        $x1 = ($roof->x + $roof->w) * $G;
        $y0 = $roof->y * $G;
        $y1 = ($roof->y + $roof->h) * $G;
        $zTop = ($level + 1) * (float) Hcca::LEVEL_HEIGHT_CM;
        $o = (float) $roof->overhang;
        $s = $roof->slopePct / 100;
        // Los cabios apoyan sobre el borde exterior del muro (no en su eje): la cubierta sube media pared × pendiente (+1 cm)
        // y los hastiales se levantan hasta tocarla. Así el coronamiento no asoma por encima del faldón.
        $lift = 10 * $s + 1;
        $zBase = $zTop;
        $zTop += $lift;

        // Orientación: "along" es la dirección de la cumbrera / del borde del faldón; "across" la perpendicular (donde cae el agua).
        $shed = RoofType::Shed === $roof->type;
        $alongX = $shed ? in_array($roof->dir, ['N', 'S'], true) : 'x' === $roof->dir;
        [$a0, $a1] = $alongX ? [$x0, $x1] : [$y0, $y1];
        [$c0, $c1] = $alongX ? [$y0, $y1] : [$x0, $x1];
        $span = $c1 - $c0;
        $pt = static fn (float $along, float $across, float $z): array => $alongX ? [round($along, 2), round($across, 2), round($z, 2)] : [round($across, 2), round($along, 2), round($z, 2)];
        $issues = [];
        // Alero por borde: donde el techo choca contra un muro del nivel de arriba (p. ej. el techo de la PB contra la
        // pared de la PA) no hay alero, y en ese extremo tampoco hay hastial (lo cierra el muro de arriba).
        $abuts = fn (float $line, bool $lineIsAlong, float $from, float $to): bool => [] !== $upper
            && $this->coverage($upper, $lineIsAlong === $alongX ? Axis::X : Axis::Y, (int) round($line / $G), $from, $to, false) >= 0.5 * ($to - $from);
        // Medio espesor del muro de arriba sobre esa línea (cm): la cubierta termina en su cara, no adentro del muro.
        $halfUpper = function (float $line, bool $lineIsAlong) use ($upper, $alongX, $G): float {
            $axis = $lineIsAlong === $alongX ? Axis::X : Axis::Y;
            $u = (int) round($line / $G);
            $t = 0;
            foreach ($upper as $w) {
                if ($w->axis() === $axis && $w->lineU() === $u) {
                    $t = max($t, $w->t);
                }
            }

            return $t / Hcca::TICKS_PER_CM / 2;
        };
        $endA0 = $abuts($a0, false, $c0, $c1);
        $endA1 = $abuts($a1, false, $c0, $c1);
        $sideC0 = $abuts($c0, true, $a0, $a1);
        $sideC1 = $abuts($c1, true, $a0, $a1);
        // El alero va sólo donde cae el agua: los dos aleros de un techo a dos aguas y el lado bajo de uno a un agua.
        // En los extremos (hastiales) y en el lado alto la cubierta llega justo a la cara exterior del muro, así tapa el
        // hastial sin dejar intersticios. Contra un muro de arriba termina en la cara de ese muro (alero negativo).
        $flush = $roof->gableT / 2;
        $oa0 = $endA0 ? -$halfUpper($a0, false) : $flush;
        $oa1 = $endA1 ? -$halfUpper($a1, false) : $flush;
        $lowC0 = $shed && in_array($roof->dir, ['N', 'W'], true);
        $oc0 = $sideC0 ? -$halfUpper($c0, true) : ($shed && !$lowC0 ? $flush : $o);
        $oc1 = $sideC1 ? -$halfUpper($c1, true) : ($shed && $lowC0 ? $flush : $o);
        $lr = ($a1 - $a0) + $oa0 + $oa1; // largo de cada faldón a lo largo de la cumbrera

        $planes = [];
        $gables = [];
        $rafterLines = [];
        $ridge = null;

        if (!$shed) {
            $half = $span / 2;
            $mid = ($c0 + $c1) / 2;
            $rise = $half * $s;
            $run = $half;
            $zRidge = $zTop + $rise;
            $lens = [];
            foreach ([-1 => $oc0, 1 => $oc1] as $side => $oe) {
                $len = hypot($half + $oe, $rise + $oe * $s);
                $lens[] = $len;
                $edge = $mid + $side * ($half + $oe);
                $zEdge = $zTop - $oe * $s;
                $planes[] = ['pts' => [$pt($a0 - $oa0, $edge, $zEdge), $pt($a1 + $oa1, $edge, $zEdge), $pt($a1 + $oa1, $mid, $zRidge), $pt($a0 - $oa0, $mid, $zRidge)], 'areaM2' => round($len * $lr / 10000, 2)];
            }
            $rafterLen = max($lens);
            // Si un lado del techo choca contra un muro de arriba, el hastial arranca en la cara de ese muro (gana la pared real).
            $g0 = $sideC0 ? $c0 + $halfUpper($c0, true) : $c0;
            $g1 = $sideC1 ? $c1 - $halfUpper($c1, true) : $c1;
            foreach ([[$a0, 'A', $endA0], [$a1, 'B', $endA1]] as [$a, $name, $closed]) {
                if (!$closed) {
                    $gables[] = $this->gable($roof, $name, [$pt($a, $g0, $zBase), $pt($a, $g1, $zBase), $pt($a, $g1, $zTop + ($c1 - $g1) * $s), $pt($a, $mid, $zRidge), $pt($a, $g0, $zTop + ($g0 - $c0) * $s)], $span * ($rise / 2 + $lift));
                }
            }
            $ridge = ['from' => $pt($a0 - $oa0, $mid, $zRidge), 'to' => $pt($a1 + $oa1, $mid, $zRidge)];
            $n = (int) ceil($lr / $roof->spacing) + 1;
            for ($i = 0; $i < $n; ++$i) {
                $al = $a0 - $oa0 + $i * $lr / max(1, $n - 1);
                foreach ([-1 => $oc0, 1 => $oc1] as $side => $oe) {
                    $rafterLines[] = ['from' => $pt($al, $mid + $side * ($half + $oe), $zTop - $oe * $s), 'to' => $pt($al, $mid, $zRidge)];
                }
            }
            $pieces = 2 * $n;
            $coverM2 = array_sum($lens) * $lr / 10000;
            $battenMl = array_sum(array_map(static fn (float $l): int => (int) ceil($l / self::BATTEN_SPACING_CM) + 1, $lens)) * $lr / 100;
            $ridgeMl = $lr / 100;
        } else {
            $lowIsFirst = in_array($roof->dir, ['N', 'W'], true);
            $low = $lowIsFirst ? $c0 : $c1;
            $high = $lowIsFirst ? $c1 : $c0;
            $rise = $span * $s;
            $run = $span;
            [$oLow, $oHigh] = $lowIsFirst ? [$oc0, $oc1] : [$oc1, $oc0];
            $highClosed = $lowIsFirst ? $sideC1 : $sideC0;
            $rafterLen = hypot($span + $oLow + $oHigh, $rise + ($oLow + $oHigh) * $s);
            $lowOuter = $low + ($lowIsFirst ? -$oLow : $oLow);
            $highOuter = $high + ($lowIsFirst ? $oHigh : -$oHigh);
            $zLow = $zTop - $oLow * $s;
            $zHigh = $zTop + $rise + $oHigh * $s;
            $planes[] = ['pts' => [$pt($a0 - $oa0, $lowOuter, $zLow), $pt($a1 + $oa1, $lowOuter, $zLow), $pt($a1 + $oa1, $highOuter, $zHigh), $pt($a0 - $oa0, $highOuter, $zHigh)], 'areaM2' => round($rafterLen * $lr / 10000, 2)];
            // Contra un muro de arriba, el hastial termina en la cara de ese muro (gana la pared real).
            $inset = $highClosed ? $halfUpper($high, true) : 0.0;
            $highG = $high + ($lowIsFirst ? -$inset : $inset);
            foreach ([[$a0, 'A', $endA0], [$a1, 'B', $endA1]] as [$a, $name, $closed]) {
                if (!$closed) {
                    $gables[] = $this->gable($roof, $name, [$pt($a, $low, $zBase), $pt($a, $highG, $zBase), $pt($a, $highG, $zTop + $rise - $inset * $s), $pt($a, $low, $zTop)], $span * ($rise / 2 + $lift));
                }
            }
            // Muro alto: el muro del lado alto se levanta hasta la cumbre del faldón (parte fija del techo a un agua), salvo
            // que el faldón apoye contra un muro del nivel de arriba.
            if (!$highClosed) {
                $gables[] = $this->gable($roof, 'H', [$pt($a0, $high, $zBase), $pt($a1, $high, $zBase), $pt($a1, $high, $zTop + $rise), $pt($a0, $high, $zTop + $rise)], ($a1 - $a0) * ($rise + $lift), true);
            }
            $n = (int) ceil($lr / $roof->spacing) + 1;
            for ($i = 0; $i < $n; ++$i) {
                $al = $a0 - $oa0 + $i * $lr / max(1, $n - 1);
                $rafterLines[] = ['from' => $pt($al, $lowOuter, $zLow), 'to' => $pt($al, $highOuter, $zHigh)];
            }
            $pieces = $n;
            $coverM2 = $rafterLen * $lr / 10000;
            $battenMl = ((int) ceil($rafterLen / self::BATTEN_SPACING_CM) + 1) * $lr / 100;
            $ridgeMl = 0.0;
        }

        $masonryM2 = 0.0;
        foreach ($gables as $g) {
            if ($g['enabled']) {
                $masonryM2 += $g['areaM2'];
            }
        }

        // El techo es para que la casa se vea completa y para computar la madera: sin revisiones. La sección de los cabios
        // se elige sola (la guardada o la menor que cubre la luz) y el largo, el comercial que alcanza.
        $sectionKey = $this->rafterSection($roof, $run);
        $commercial = array_find(Hcca::TIMBER_LENGTHS_CM, static fn (int $l): bool => $l >= $rafterLen - 0.001) ?? (int) ceil($rafterLen / 10) * 10;

        $byT = [];
        foreach ($gables as $g) {
            if ($g['enabled']) {
                $byT[$g['thickness']] = ($byT[$g['thickness']] ?? 0.0) + $g['areaM2'];
            }
        }

        return [
            'id' => $roof->id,
            'level' => $level,
            'type' => $roof->type->value,
            'issues' => $issues,
            'geometry' => [
                'rect' => ['x0' => $x0, 'y0' => $y0, 'x1' => $x1, 'y1' => $y1],
                'overhang' => $o,
                // borde exterior de la cubierta (con el alero de cada lado)
                'outer' => $alongX
                    ? ['x0' => $x0 - $oa0, 'x1' => $x1 + $oa1, 'y0' => $y0 - $oc0, 'y1' => $y1 + $oc1]
                    : ['x0' => $x0 - $oc0, 'x1' => $x1 + $oc1, 'y0' => $y0 - $oa0, 'y1' => $y1 + $oa1],
                'zTop' => $zBase,
                'riseCm' => round($rise, 1),
                'rafterLenCm' => round($rafterLen, 1),
                'planes' => $planes,
                'gables' => $gables,
                'ridge' => $ridge,
                'rafters' => $rafterLines,
                'dir' => $roof->dir,
            ],
            'bom' => [
                'section' => $sectionKey,
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

    /** Sección de cabio: la guardada o, si no cubre la luz horizontal, la menor que la cubre (si ninguna, la mayor). */
    private function rafterSection(RoofPart $roof, float $run): string
    {
        $keys = array_keys(Hcca::timberSections());
        $from = array_search($roof->section, $keys, true);
        foreach (array_slice($keys, false === $from ? 0 : $from) as $k) {
            if (Hcca::timberSections()[$k]['maxSpanCm'] * (40 / $roof->spacing) ** (1 / 3) >= $run - 0.001) {
                return $k;
            }
        }

        return $keys[array_key_last($keys)];
    }

    /**
     * Hastial (o muro alto): polígono en el plano vertical del extremo, con su área y los bloques que lleva.
     *
     * @param list<array{float, float, float}> $pts
     *
     * @return array<string, mixed>
     */
    private function gable(RoofPart $roof, string $side, array $pts, float $areaCm2, bool $fixed = false, ?\Closure $hidden = null): array
    {
        $enabled = $fixed || ('A' === $side ? $roof->gableA : $roof->gableB);
        $layout = $this->layGable($pts, $hidden);
        $pieces = $enabled ? array_merge(...array_map(static fn (array $c): array => $c['pieces'], $layout['courses'] ?: [['pieces' => []]])) : [];
        $full = count(array_filter($pieces, static fn (int $l): bool => $l >= Hcca::blockL()));

        return [
            'id' => $roof->id.':'.$side,
            'side' => $side,
            'pts' => $pts,
            'areaM2' => round($areaCm2 / 10000, 2),
            'enabled' => $enabled,
            'fixed' => $fixed,
            'thickness' => $roof->gableT,
            // Despiece por hilada (para dibujar las juntas y para el cómputo): u a lo largo del hastial, v desde el coronamiento.
            'plane' => $layout['plane'],
            'courses' => array_map(static fn (array $c): array => ['v0' => $c['v0'], 'u0' => $c['u0'], 'joints' => $c['joints']], $layout['courses']),
            'pieces' => $pieces,
            'blocks' => count($pieces),
            'fullBlocks' => $full,
            'cutPieces' => count($pieces) - $full,
        ];
    }

    /**
     * Traba de un hastial (o del muro alto de un techo a un agua): hiladas de 25 cm desde el coronamiento, como un muro: las
     * juntas siguen una misma grilla desde el arranque del hastial y se corren medio bloque en hiladas alternas, así cada
     * bloque monta mitad y mitad sobre los dos de abajo. Las piezas de los extremos se cortan en diagonal siguiendo la
     * pendiente; se computan por su largo inferior.
     *
     * @param list<array{float, float, float}> $pts
     *
     * @return array{plane: array{axis: string, at: float, z: float}, courses: list<array{v0: float, u0: float, joints: list<float>, pieces: list<int>}>}
     */
    private function layGable(array $pts, ?\Closure $hidden = null): array
    {
        $alongY = abs($pts[0][0] - $pts[1][0]) < 0.01 && abs($pts[1][0] - $pts[2][0]) < 0.01;
        $z0 = min(array_column($pts, 2));
        $poly = array_map(static fn (array $p): array => [$alongY ? $p[1] : $p[0], $p[2] - $z0], $pts);
        $vMax = max(array_column($poly, 1));
        $courses = [];
        // Origen de la grilla de juntas: el arranque del hastial (su cara inferior, la más ancha).
        $origin = ($this->spanAt($poly, 0.0) ?? [min(array_column($poly, 0))])[0];
        $blockL = Hcca::blockL();
        for ($k = 0; $k * 25 < $vMax - 0.5; ++$k) {
            $v0 = $k * 25.0;
            $span = $this->spanAt($poly, $v0);
            if (null === $span || $span[1] - $span[0] < 2.5) {
                continue;
            }
            [$uL, $uR] = $span;
            // Tramos visibles de la hilada: lo que queda debajo de otro techo más alto no se construye.
            $segs = [[$uL, $uR]];
            if (null !== $hidden) {
                $segs = [];
                $zTopCourse = $z0 + $v0 + 25;
                $step = 2.5;
                $open = null;
                for ($u = $uL; $u < $uR - 1e-6; $u += $step) {
                    $um = min($u + $step / 2, $uR);
                    $h = $hidden($alongY ? $pts[0][0] : $um, $alongY ? $um : $pts[0][1], $zTopCourse);
                    if (!$h && null === $open) {
                        $open = $u;
                    } elseif ($h && null !== $open) {
                        $segs[] = [$open, $u];
                        $open = null;
                    }
                }
                if (null !== $open) {
                    $segs[] = [$open, $uR];
                }
            }
            $pieces = [];
            $joints = [];
            foreach ($segs as [$sL, $sR]) {
                $widthTicks = (int) round(($sR - $sL) * Hcca::TICKS_PER_CM);
                if ($widthTicks < 50) {
                    continue;
                }
                // Juntas en origen + medio bloque en hiladas impares + n bloques (en ticks, relativas al tramo).
                $phase = 1 === $k % 2 ? intdiv($blockL, 2) : 0;
                $startTicks = (int) round(($sL - $origin) * Hcca::TICKS_PER_CM);
                $next = $phase + (int) (ceil(($startTicks - $phase + 1) / $blockL) * $blockL);
                $pos = 0;
                while ($pos < $widthTicks) {
                    $cut = $next - $startTicks;
                    $len = min(max($cut - $pos, 1), $widthTicks - $pos);
                    $pieces[] = $len;
                    $pos += $len;
                    $next += $blockL;
                    if ($pos < $widthTicks) {
                        $joints[] = round($sL + $pos / Hcca::TICKS_PER_CM, 2);
                    }
                }
            }
            $courses[] = ['v0' => $v0, 'u0' => round($uL, 2), 'joints' => $joints, 'pieces' => $pieces];
        }

        return ['plane' => ['axis' => $alongY ? 'y' : 'x', 'at' => $alongY ? $pts[0][0] : $pts[0][1], 'z' => $z0], 'courses' => $courses];
    }

    /**
     * Intervalo [uMin, uMax] donde la recta horizontal v corta al polígono convexo, o null.
     *
     * @param list<array{float, float}> $poly
     *
     * @return array{float, float}|null
     */
    private function spanAt(array $poly, float $v): ?array
    {
        $xs = [];
        $n = count($poly);
        for ($i = 0; $i < $n; ++$i) {
            [$ua, $va] = $poly[$i];
            [$ub, $vb] = $poly[($i + 1) % $n];
            if (($va <= $v && $vb >= $v) || ($vb <= $v && $va >= $v)) {
                $xs[] = abs($vb - $va) < 1e-9 ? $ua : $ua + ($v - $va) * ($ub - $ua) / ($vb - $va);
                if (abs($vb - $va) < 1e-9) {
                    $xs[] = $ub;
                }
            }
        }

        return [] === $xs ? null : [min($xs), max($xs)];
    }

    /**
     * Longitud (cm) del alero cubierta por muros portantes colineales (unión de intervalos).
     *
     * @param list<Wall> $walls
     */
    private function coverage(array $walls, Axis $axis, int $lineUnits, float $a0, float $a1, bool $bearing = true): float
    {
        $spans = [];
        foreach ($walls as $w) {
            if ($w->axis() === $axis && $w->lineU() === $lineUnits && (!$bearing || ($w->isLoadBearing() && $w->h === Hcca::COURSES))) {
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

}
