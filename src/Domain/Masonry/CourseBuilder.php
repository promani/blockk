<?php

declare(strict_types=1);

namespace App\Domain\Masonry;

use App\Domain\Cutting\StockPacker;
use App\Domain\Geometry\Topology;
use App\Domain\Hcca;
use App\Domain\Model\Axis;
use App\Domain\Model\Level;
use App\Domain\Model\Wall;

/**
 * Genera el despiece hilada por hilada de un nivel (todo en ticks de 0,5 mm).
 *
 * Reglas constructivas aplicadas:
 *  - Esquinas y cruces: los muros se alternan cada hilada (traba a 90°); ver Topology::endCondition.
 *  - Traba: las juntas verticales de una hilada distan >= 12,5 cm de las de la hilada anterior.
 *  - Vanos: dintel de bloque U en la hilada 9 (2,00 m), con apoyo >= 25 cm a cada lado.
 *  - Corona: la hilada 12 de los muros portantes es de bloque U (encadenado superior).
 *  - Piezas < 12,5 cm no se generan (se redistribuyen).
 *
 * Para cada tramo se evalúan varios patrones (largo de la pieza inicial y sentido) y se elige el que
 * respeta la traba y abre menos bloques nuevos, reaprovechando los remanentes de cortes previos.
 */
final class CourseBuilder
{
    /** Largos posibles de la primera pieza de un tramo, en orden de preferencia (ticks). */
    /** Largos preferidos para la primera pieza de una hilada (los que superan el bloque del sistema se descartan). */
    private const array START_LENGTHS = [1250, 625, 750, 500, 1000, 875, 375, 250, 1125];

    public function build(Level $level, Topology $topology): CourseModel
    {
        $packer = new StockPacker();
        $previousJoints = [];
        $courses = [];
        $warnings = [];
        // Vanos y vigas U indexados por muro (evita recorrer todos los vanos para cada corrida de cada hilada).
        $openings = [];
        foreach ($level->openings as $o) {
            $openings[$o->wallId][] = $o;
        }
        $beams = [];
        foreach ($level->ubeams as $u) {
            $beams[$u->wallId][] = $u;
        }

        // Cada muro tiene su alto: en las hiladas donde algún muro ya terminó se usa la topología de los muros que siguen
        // (una esquina con un muro más bajo pasa a ser un extremo libre, una T pasa a ser esquina, etc.).
        $top = array_reduce($level->walls, static fn (int $m, $w): int => max($m, $w->h), 0);
        $topologies = [];
        for ($c = 0; $c < $top; ++$c) {
            $active = array_values(array_filter($level->walls, static fn ($w): bool => $w->h > $c));
            $key = count($active) === count($level->walls) ? '*' : implode(',', array_map(static fn ($w): string => $w->id, $active));
            $topo = $topologies[$key] ??= ('*' === $key ? $topology : new Topology(new Level($active)));
            $runs = [];
            $joints = [];
            foreach ($this->seeds($topo, $c) as $seed) {
                $run = $this->fillRun($openings, $beams, $seed, $c, $previousJoints, $packer, $warnings);
                $runs[] = $run;
                foreach ($run->pieces as $i => $piece) {
                    if (isset($run->pieces[$i + 1]) && $run->pieces[$i + 1]->a === $piece->b) {
                        $joints[$run->key()][] = $piece->b;
                    }
                }
            }
            $courses[] = $runs;
            foreach ($joints as &$positions) {
                sort($positions); // las corridas de una recta se recorren de menor a mayor, pero se garantiza el orden
            }
            unset($positions);
            $previousJoints = $joints;
        }

        return new CourseModel($courses, $warnings);
    }

    /**
     * Intervalos macizos de la hilada $course: una semilla por corrida (muros colineales fusionados).
     *
     * @return list<array{axis: Axis, line: int, a: int, b: int, t: int, walls: list<Wall>}>
     */
    private function seeds(Topology $topology, int $course): array
    {
        $walls = $topology->level->walls;
        $parent = [];
        foreach ($walls as $w) {
            $parent[$w->id] = $w->id;
        }
        $find = static function (string $id) use (&$parent, &$find): string {
            while ($parent[$id] !== $id) {
                $parent[$id] = $parent[$parent[$id]];
                $id = $parent[$id];
            }

            return $id;
        };
        foreach ($topology->mergePairs($course) as [$p, $q]) {
            $parent[$find($p->id)] = $find($q->id);
        }

        $groups = [];
        foreach ($walls as $w) {
            $start = $topology->endCondition($w, true, $course)['ext'];
            $end = $topology->endCondition($w, false, $course)['ext'];
            $base = $w->startU() * Hcca::GRID;
            $groups[$find($w->id)][] = [$w, $base - $start, $base + $w->lengthTicks() + $end];
        }

        $seeds = [];
        foreach ($groups as $members) {
            /** @var Wall $first */
            $first = $members[0][0];
            $a = min(array_map(static fn (array $m): int => $m[1], $members));
            $b = max(array_map(static fn (array $m): int => $m[2], $members));
            if ($b - $a <= 0) {
                continue;
            }
            $seeds[] = [
                'axis' => $first->axis(),
                'line' => $first->lineU() * Hcca::GRID,
                'a' => $a,
                'b' => $b,
                't' => $first->t,
                'walls' => array_map(static fn (array $m): Wall => $m[0], $members),
            ];
        }
        usort($seeds, static fn (array $x, array $y): int => [$x['axis']->value, $x['line'], $x['a']] <=> [$y['axis']->value, $y['line'], $y['a']]);

        return $seeds;
    }

    /**
     * @param array<string, list<\App\Domain\Model\Opening>>                       $openings vanos por id de muro
     * @param array<string, list<\App\Domain\Model\UBeam>>                         $beams    vigas U por id de muro
     * @param array{axis: Axis, line: int, a: int, b: int, t: int, walls: list<Wall>} $seed
     * @param array<string, list<int>>                                                 $previousJoints
     * @param list<string>                                                             $warnings
     */
    private function fillRun(array $openings, array $beams, array $seed, int $course, array $previousJoints, StockPacker $packer, array &$warnings): Run
    {
        ['axis' => $axis, 'line' => $line, 'a' => $a, 'b' => $b, 't' => $t, 'walls' => $walls] = $seed;
        $voids = [];
        $uSpans = [];
        $prev = $previousJoints[$axis->value.':'.$line] ?? [];

        foreach ($walls as $w) {
            $base = $w->startU() * Hcca::GRID;
            foreach ($openings[$w->id] ?? [] as $o) {
                $g0 = $base + $o->pos * Hcca::GRID;
                $g1 = $g0 + $o->w * Hcca::GRID;
                if ($o->sill <= $course && $course < $o->sill + $o->h) {
                    $voids[] = [max($a, $g0), min($b, $g1), $o->id];
                }
                if ($o->lintelCourse() === $course) {
                    // Apoyo mínimo 25 cm; se alarga (hasta 50 cm) si la junta bloque/U cae sobre una junta inferior.
                    $uSpans[] = [
                        $this->clearBoundary($g0 - Hcca::LINTEL_BEARING, -1, $prev, $a),
                        $this->clearBoundary($g1 + Hcca::LINTEL_BEARING, 1, $prev, $b),
                        'lintel',
                    ];
                }
            }
            foreach ($beams[$w->id] ?? [] as $u) {
                if ($u->course === $course) {
                    $g0 = $base + $u->pos * Hcca::GRID;
                    // Como los dinteles, el borde bloque/U de una viga manual no puede coincidir con una junta inferior.
                    $uSpans[] = [
                        $this->clearBoundary($g0, -1, $prev, $a),
                        $this->clearBoundary($g0 + $u->len * Hcca::GRID, 1, $prev, $b),
                        'beam',
                    ];
                }
            }
        }
        // Corona de bloques U en la última hilada de cada muro que la lleva.
        $crowned = array_values(array_filter($walls, static fn (Wall $w): bool => $w->hasCrown() && $course === $w->h - 1));
        if (count($crowned) === count($walls)) {
            $uSpans[] = [$a, $b, 'crown'];
        } else {
            foreach ($crowned as $w) {
                $s0 = $w->startU() * Hcca::GRID;
                $s1 = $w->endU() * Hcca::GRID;
                $uSpans[] = [abs($s0 - $a) <= 400 ? $a : max($a, $s0), abs($s1 - $b) <= 400 ? $b : min($b, $s1), 'crown'];
            }
        }

        $voids = array_values(array_filter($voids, static fn (array $v): bool => $v[1] > $v[0]));
        usort($voids, static fn (array $x, array $y): int => $x[0] <=> $y[0]);
        $uSpans = $this->mergeSpans($uSpans, $a, $b);

        $run = new Run($axis, $line, $a, $b, $t, array_map(static fn (Wall $w): string => $w->id, $walls), [], $voids);

        $parts = $this->partition($a, $b, $voids, $uSpans);
        $lay = function (int $i) use (&$parts, $prev, $t, $packer, $course, $axis, $line): array {
            [$sa, $sb, $kind] = $parts[$i];
            $w = [];
            $lengths = $this->chooseLayout($sb - $sa, $sa, $prev, (PieceKind::U === $kind ? 'U:' : 'B:').$t, $packer, $w, $course, $axis, $line);

            return [$lengths, $w];
        };
        $layouts = [];
        foreach (array_keys($parts) as $i) {
            $layouts[$i] = $lay($i);
        }
        // Un remanente de bloque macizo < 25 cm pegado a un tramo U deja tres juntas en menos de un bloque y la hilada
        // de arriba no puede trabar (con bloques de 50 cm pasa seguido): el U lo absorbe y se vuelve a despiezar.
        foreach (array_keys($parts) as $i) {
            if (!isset($parts[$i + 1]) || $parts[$i][1] !== $parts[$i + 1][0]) {
                continue;
            }
            $blockThenU = PieceKind::Block === $parts[$i][2] && PieceKind::U === $parts[$i + 1][2];
            $uThenBlock = PieceKind::U === $parts[$i][2] && PieceKind::Block === $parts[$i + 1][2];
            if ($blockThenU && count($layouts[$i][0]) > 1 && end($layouts[$i][0]) < 2 * Hcca::MIN_BOND) {
                $r = array_pop($layouts[$i][0]);
                $parts[$i][1] -= $r;
                $parts[$i + 1][0] -= $r;
                $layouts[$i + 1] = $lay($i + 1);
            } elseif ($uThenBlock && count($layouts[$i + 1][0]) > 1 && $layouts[$i + 1][0][0] < 2 * Hcca::MIN_BOND) {
                $r = array_shift($layouts[$i + 1][0]);
                $parts[$i][1] += $r;
                $parts[$i + 1][0] += $r;
                $layouts[$i] = $lay($i);
            }
        }
        foreach ($parts as $i => [$sa, , $kind, $role]) {
            [$lengths, $w] = $layouts[$i];
            array_push($warnings, ...$w);
            $packer->commit((PieceKind::U === $kind ? 'U:' : 'B:').$t, array_values(array_filter($lengths, static fn (int $l): bool => Hcca::blockL() !== $l)));
            $pos = $sa;
            foreach ($lengths as $len) {
                $run->pieces[] = new Piece($pos, $pos + $len, $kind, $role);
                $pos += $len;
            }
        }

        return $run;
    }

    /**
     * Distancia de $x a la junta más cercana de una lista ordenada (búsqueda binaria); PHP_INT_MAX si no hay juntas.
     *
     * @param list<int> $sorted
     */
    private static function distanceToNearest(array $sorted, int $x): int
    {
        $n = count($sorted);
        if (0 === $n) {
            return PHP_INT_MAX;
        }
        $lo = 0;
        $hi = $n;
        while ($lo < $hi) {
            $mid = ($lo + $hi) >> 1;
            if ($sorted[$mid] < $x) {
                $lo = $mid + 1;
            } else {
                $hi = $mid;
            }
        }
        $best = PHP_INT_MAX;
        if ($lo < $n) {
            $best = $sorted[$lo] - $x;
        }
        if ($lo > 0) {
            $best = min($best, $x - $sorted[$lo - 1]);
        }

        return $best;
    }

    /**
     * Ubica un borde de dintel: parte de $pos (apoyo mínimo) y lo aleja del vano en pasos de 2,5 cm hasta que
     * la junta bloque/U quede a >= 12,5 cm de las juntas de la hilada inferior. Si el borde llega al final de la
     * corrida ($limit) no hay junta que cuidar.
     *
     * @param list<int> $previousJoints
     */
    private function clearBoundary(int $pos, int $direction, array $previousJoints, int $limit): int
    {
        for ($extra = 0; $extra <= Hcca::LINTEL_BEARING; $extra += 50) {
            $p = $pos + $direction * $extra;
            if ($direction * ($p - $limit) >= 0) {
                return $limit;
            }
            if (self::distanceToNearest($previousJoints, $p) >= Hcca::MIN_BOND) {
                return $p;
            }
        }

        return $pos;
    }

    /**
     * Une los tramos U que se superponen (p. ej. dos dinteles con jamba < 50 cm) y los recorta a la corrida.
     *
     * @param list<array{int, int, string}> $spans
     *
     * @return list<array{int, int, string}>
     */
    private function mergeSpans(array $spans, int $a, int $b): array
    {
        $clipped = [];
        foreach ($spans as [$s, $e, $role]) {
            $s = max($s, $a);
            $e = min($e, $b);
            if ($e > $s) {
                $clipped[] = [$s, $e, $role];
            }
        }
        usort($clipped, static fn (array $x, array $y): int => $x[0] <=> $y[0]);
        $merged = [];
        foreach ($clipped as [$s, $e, $role]) {
            $last = count($merged) - 1;
            if ($last >= 0 && $s <= $merged[$last][1]) {
                $merged[$last][1] = max($merged[$last][1], $e);
                if ('lintel' === $role) {
                    $merged[$last][2] = 'lintel';
                }
                continue;
            }
            $merged[] = [$s, $e, $role];
        }

        return $merged;
    }

    /**
     * Parte la corrida en tramos contiguos de bloque macizo o de bloque U, dejando libres los vanos.
     *
     * @param list<array{int, int, string}> $voids
     * @param list<array{int, int, string}> $uSpans
     *
     * @return list<array{int, int, PieceKind, ?string}>
     */
    private function partition(int $a, int $b, array $voids, array $uSpans): array
    {
        $solid = [];
        $cursor = $a;
        foreach ($voids as [$vs, $ve]) {
            if ($vs > $cursor) {
                $solid[] = [$cursor, $vs];
            }
            $cursor = max($cursor, $ve);
        }
        if ($cursor < $b) {
            $solid[] = [$cursor, $b];
        }

        $spans = [];
        foreach ($solid as [$ss, $se]) {
            $cur = $ss;
            $last = null; // índice del último tramo U de este intervalo
            foreach ($uSpans as [$us, $ue, $role]) {
                $s = max($us, $ss);
                $e = min($ue, $se);
                if ($e <= $s || $e <= $cur) {
                    continue;
                }
                $s = max($s, $cur);
                // Un remanente de bloque macizo < 12,5 cm antes del U no se puede colocar: el U lo absorbe.
                if ($s > $cur && $s - $cur >= Hcca::MIN_PIECE) {
                    $spans[] = [$cur, $s, PieceKind::Block, null];
                } else {
                    $s = $cur;
                }
                $spans[] = [$s, $e, PieceKind::U, $role];
                $last = count($spans) - 1;
                $cur = $e;
            }
            if ($cur < $se) {
                if (null !== $last && $se - $cur < Hcca::MIN_PIECE) {
                    $spans[$last][1] = $se; // ídem después del último U
                } else {
                    $spans[] = [$cur, $se, PieceKind::Block, null];
                }
            }
        }

        return $spans;
    }

    /**
     * Elige el largo de cada pieza de un tramo de longitud $span que empieza en $origin.
     *
     * @param list<int>    $previousJoints juntas verticales de la hilada anterior sobre la misma recta
     * @param list<string> $warnings
     *
     * @return list<int>
     */
    private function chooseLayout(int $span, int $origin, array $previousJoints, string $pieceKey, StockPacker $packer, array &$warnings, int $course, Axis $axis, int $line): array
    {
        if ($span <= Hcca::blockL()) {
            return [$span];
        }

        $best = null;
        $bestScore = null;
        $L = Hcca::blockL();
        $starts = array_values(array_unique(array_filter([$L, intdiv($L, 2), ...self::START_LENGTHS], static fn (int $l): bool => $l <= $L)));
        foreach ($starts as $pref => $start) {
            $base = $this->layout($span, $start);
            foreach ([$base, array_reverse($base)] as $variant => $lengths) {
                $joints = [];
                $pos = $origin;
                foreach (array_slice($lengths, 0, -1) as $len) {
                    $pos += $len;
                    $joints[] = $pos;
                }
                $clearance = PHP_INT_MAX;
                foreach ($joints as $j) {
                    $clearance = min($clearance, self::distanceToNearest($previousJoints, $j));
                }
                $cuts = array_values(array_filter($lengths, static fn (int $l): bool => Hcca::blockL() !== $l));
                $score = [
                    $clearance < Hcca::MIN_BOND ? 1 : 0,
                    min($lengths) < Hcca::MIN_PIECE ? 1 : 0,
                    $packer->newBinsFor($pieceKey, $cuts),
                    count($cuts),
                    $pref * 2 + $variant,
                ];
                if (null === $bestScore || $score < $bestScore) {
                    $best = $lengths;
                    $bestScore = $score;
                }
            }
        }

        if ($bestScore[0] > 0) {
            $repaired = $this->repairLayout($span, $origin, $previousJoints);
            if (null !== $repaired) {
                return $repaired;
            }
            $warnings[] = sprintf('Traba < 12,5 cm en hilada %d (%s=%s cm)', $course + 1, $axis->value, Hcca::ticksToCm($line));
        }

        return $best;
    }

    /**
     * Ningún patrón estándar respeta la traba (p. ej. sobre dinteles, donde conviven dos retículas de
     * juntas desfasadas). Búsqueda exacta por programación dinámica sobre una retícula de 2,5 cm:
     * piezas de 12,5 cm al largo del bloque, juntas a >= 12,5 cm de las anteriores, mínima cantidad de cortes.
     *
     * @param list<int> $previousJoints
     *
     * @return list<int>|null
     */
    private function repairLayout(int $span, int $origin, array $previousJoints): ?array
    {
        // Todas las posiciones (orígenes y juntas) son múltiplos de 25 ticks: los medios espesores son 75/100/150/200.
        $step = 25;
        $near = array_values(array_filter($previousJoints, static fn (int $p): bool => $p > $origin - Hcca::MIN_BOND && $p < $origin + $span + Hcca::MIN_BOND));
        $allowed = static fn (int $pos): bool => self::distanceToNearest($near, $pos) >= Hcca::MIN_BOND;

        // best[m] = [cortes, piezas, m anterior]: mejor forma de llegar a la junta m·step.
        $best = [0 => [0, 0, -1]];
        $final = null;
        $lastM = intdiv($span, $step);
        for ($m = 0; $m <= $lastM; ++$m) {
            if (!isset($best[$m])) {
                continue;
            }
            [$cuts, $count] = $best[$m];
            $pos = $m * $step;
            $rest = $span - $pos;
            if ($rest >= Hcca::MIN_PIECE && $rest <= Hcca::blockL()) {
                $cand = [$cuts + (Hcca::blockL() === $rest ? 0 : 1), $count + 1, $m];
                if (null === $final || $cand < $final) {
                    $final = $cand;
                }
            }
            for ($len = Hcca::MIN_PIECE; $len <= Hcca::blockL(); $len += $step) {
                $q = $pos + $len;
                if ($span - $q < Hcca::MIN_PIECE || !$allowed($origin + $q)) {
                    continue;
                }
                $cand = [$cuts + (Hcca::blockL() === $len ? 0 : 1), $count + 1, $m];
                $mq = intdiv($q, $step);
                if (!isset($best[$mq]) || $cand < $best[$mq]) {
                    $best[$mq] = $cand;
                }
            }
        }
        if (null === $final) {
            return null;
        }

        $lengths = [];
        $end = $span;
        $m = $final[2];
        while ($m >= 0) {
            $start = $m * $step;
            $lengths[] = $end - $start;
            $end = $start;
            $m = $best[$m][2];
        }

        return array_reverse($lengths);
    }

    /**
     * Patrón desde la izquierda: pieza inicial $start, bloques enteros y una pieza final de ajuste.
     * Si el ajuste queda < 12,5 cm se reparte con el último bloque entero en dos mitades.
     *
     * @return list<int>
     */
    private function layout(int $span, int $start): array
    {
        $start = min($start, $span);
        $rest = $span - $start;
        $full = intdiv($rest, Hcca::blockL());
        $end = $rest - $full * Hcca::blockL();
        $lengths = [$start, ...array_fill(0, $full, Hcca::blockL())];
        if ($end >= Hcca::MIN_PIECE) {
            $lengths[] = $end;
        } elseif ($end > 0) {
            if ($full > 0) {
                array_pop($lengths);
                $total = Hcca::blockL() + $end;
                $lengths[] = intdiv($total, 2);
                $lengths[] = $total - intdiv($total, 2);
            } else {
                $lengths = [intdiv($span, 2), $span - intdiv($span, 2)];
            }
        }

        return $lengths;
    }
}
