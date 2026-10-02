<?php

declare(strict_types=1);

namespace App\Domain\Design;

use App\Domain\Hcca;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;

/**
 * Calca un plano: arma un proyecto a partir de los ambientes leídos de una imagen (o dictados con medidas), dados como
 * rectángulos en metros a ejes de muro, con el origen arriba a la izquierda del plano (x hacia la derecha, y hacia
 * abajo). Es determinista, como el generador: quien lee el plano es el modelo; acá sólo se construye.
 *
 * - Las coordenadas se llevan a la retícula de 12,5 cm y las rectas que quedan a menos de 37,5 cm se unifican, así dos
 *   ambientes vecinos comparten el muro aunque sus medidas no cierren exactas (ningún ambiente mide menos de 75 cm).
 * - Con dos plantas, si la de arriba no viene ya sobre la de abajo (en la imagen suelen estar una al lado de la otra),
 *   se la superpone por la esquina en la que más muros coinciden.
 * - Los muros salen de los lados de los rectángulos: un lado que no comparte con nadie es exterior (20 cm); uno
 *   compartido es interior. Un lado marcado como abierto no lleva muro (ambientes integrados, formas en L, galerías).
 * - Las aberturas se dan por un punto y se ubican en el muro más cercano, en el lugar válido más próximo (jambas),
 *   con su ancho, su alto y el sentido de la puerta si el plano los muestra.
 * - También se calcan los pilares, la escalera (la forma que mejor llena su rectángulo) y el techo: una parte por cada
 *   rectángulo grande de la planta y, en dos plantas, la parte baja que queda sin nada encima.
 *
 * El resultado es un punto de partida: lo valida el motor completo y se ajusta en el editor.
 */
final class PlanTracer
{
    public const array SIDES = ['arriba', 'abajo', 'izquierda', 'derecha'];
    public const array OPENING_TYPES = ['puerta', 'ventana', 'ventanal', 'porton'];
    public const array ROOFS = ['dos_aguas', 'un_agua', 'ninguno'];

    private const int MAX_ROOMS = 40;
    private const int MAX_OPENINGS = 80;
    private const int MIN_SIDE = 6;     // 75 cm entre ejes
    private const int MERGE = 3;        // rectas a ≤ 37,5 cm son la misma
    private const int MARGIN = 24;      // 3 m de terreno alrededor
    private const int REACH = 6;        // una abertura busca muro hasta 75 cm
    private const int MAX_COLUMNS = 40;

    /** @var array<int, array{float, float}> corrimiento (u) de cada nivel: metros del plano → unidades del proyecto */
    private array $shift = [];
    /** @var array{float, float} metros que se corrió la planta alta para quedar sobre la baja */
    private array $upperOffset = [0.0, 0.0];

    /** Abertura por tipo: clase, ancho por defecto, mínimo y máximo (u), antepecho (hiladas) y forma de abrir. */
    private const array OPENINGS = [
        'puerta' => ['door', 7, 6, 13, 0, 'swing'],
        'ventana' => ['window', 10, 4, 24, 4, 'slide'],
        'ventanal' => ['window', 12, 8, 24, 0, 'slide'],
        'porton' => ['gate', 20, 16, 40, 0, 'overhead'],
    ];

    public function __construct(private readonly ProjectAnalyzer $analyzer = new ProjectAnalyzer())
    {
    }

    /**
     * @param array<string, mixed> $plan {nombre?, ambientes: list<{nombre, tipo?, nivel?, x, y, ancho, fondo, abierto?}>,
     *                                   aberturas?: list<{tipo, nivel?, x, y, ancho?, alto?, bisagra?, abre?}>,
     *                                   escaleras?: list<{x, y, ancho, fondo, sube?}>, pilares?: list<{nivel?, x, y, lado?}>, techo?}
     *
     * @return array{project: array<string, mixed>, notes: list<string>}
     *
     * @throws \InvalidArgumentException con un mensaje para quien calca si el plano no se puede armar
     */
    public function trace(array $plan): array
    {
        $notes = [];
        $rooms = $this->rooms((array) ($plan['ambientes'] ?? []), $notes);
        $levels = max(array_column($rooms, 'level')) + 1;

        $project = [
            'v' => 1,
            'name' => mb_substr(trim((string) ($plan['nombre'] ?? '')) ?: 'Casa calcada de un plano', 0, 80),
            'north' => 0,
            'lat' => -34.6,
            'lot' => $this->lot($rooms),
            'settings' => ['defaultT' => 20, 'reservePct' => 3, 'currency' => 'USD'],
            'upper' => 2 === $levels,
            'roofs' => [],
            'levels' => [],
        ];
        $seq = 0;
        $byLevel = [];
        for ($li = 1; $li >= 0; --$li) {
            // En dos plantas, los muros interiores de abajo son portantes (apoyan las losas y el Nivel 2) y, bajo un muro
            // exterior de arriba, del mismo espesor que él.
            $byLevel[$li] = $this->walls(array_values(array_filter($rooms, static fn (array $r): bool => $r['level'] === $li)), 0 === $li && 2 === $levels ? 15 : 10, $byLevel[1] ?? []);
        }
        for ($li = 0; $li < 2; ++$li) {
            $here = array_values(array_filter($rooms, static fn (array $r): bool => $r['level'] === $li));
            $walls = [];
            foreach ($byLevel[$li] as $w) {
                $walls[] = ['id' => 'w'.(++$seq)] + $w;
            }
            $labels = [];
            $named = [];
            foreach ($here as $r) {
                // Un ambiente en L llega como dos rectángulos con el mismo nombre unidos por un lado abierto: un solo rótulo.
                $key = mb_strtolower($r['name']);
                if ('' === $r['name'] || ([] !== $r['open'] && isset($named[$key]))) {
                    continue;
                }
                $named[$key] = true;
                $labels[] = ['id' => 'n'.(++$seq), 'x' => $r['x0'] + intdiv($r['x1'] - $r['x0'], 2), 'y' => $r['y0'] + intdiv($r['y1'] - $r['y0'], 2), 'name' => $r['name']] + ('' === $r['type'] ? [] : ['type' => $r['type']]);
            }
            $project['levels'][] = ['walls' => $walls, 'openings' => [], 'ubeams' => [], 'timber' => [], 'slabs' => [], 'stairs' => [], 'columns' => [], 'labels' => $labels];
        }

        if (2 === $levels) {
            // Piso del Nivel 2: una losa por cada ambiente de abajo que tiene planta alta encima.
            $upper = array_values(array_filter($rooms, static fn (array $r): bool => 1 === $r['level']));
            foreach ($rooms as $r) {
                // si los rectángulos del plano se pisan, la losa del segundo no se repite sobre la del primero
                $taken = array_map(static fn (array $s): array => ['x0' => $s['x'], 'y0' => $s['y'], 'x1' => $s['x'] + $s['w'], 'y1' => $s['y'] + $s['h']], $project['levels'][1]['slabs']);
                if (0 === $r['level'] && $this->covered($r, $upper) >= 0.5 && 0.0 === $this->covered($r, $taken)) {
                    $project['levels'][1]['slabs'][] = ['id' => 'l'.(++$seq), 'x' => $r['x0'], 'y' => $r['y0'], 'w' => $r['x1'] - $r['x0'], 'h' => $r['y1'] - $r['y0'], 'thickness' => 12];
                }
            }
        }

        $roof = (string) ($plan['techo'] ?? 'dos_aguas');
        if (!in_array($roof, self::ROOFS, true)) {
            $roof = 'dos_aguas';
        }
        if ('ninguno' !== $roof) {
            $project['roofs'] = $this->roofs($rooms, $levels, $roof, $seq, $notes);
        }

        $columns = array_values(array_filter((array) ($plan['pilares'] ?? []), is_array(...)));
        foreach (array_slice($columns, 0, self::MAX_COLUMNS) as $c) {
            $li = (int) ($c['nivel'] ?? 1) - 1;
            if (!is_numeric($c['x'] ?? null) || !is_numeric($c['y'] ?? null) || !isset($project['levels'][$li]) || $li >= $levels) {
                continue;
            }
            // el lado admitido más cercano al del plano
            $side = is_numeric($c['lado'] ?? null) ? (float) $c['lado'] * ((float) $c['lado'] < 2 ? 100 : 1) : 20;
            $sizes = Hcca::COLUMN_SIZES_CM;
            usort($sizes, static fn (int $a, int $b): int => abs($a - $side) <=> abs($b - $side));
            $project['levels'][$li]['columns'][] = ['id' => 'c'.(++$seq), 'x' => (int) round($this->units((float) $c['x']) + $this->shift[$li][0]), 'y' => (int) round($this->units((float) $c['y']) + $this->shift[$li][1]), 'size' => $sizes[0]];
        }

        $asked = array_values(array_filter((array) ($plan['aberturas'] ?? []), is_array(...)));
        if (count($asked) > self::MAX_OPENINGS) {
            throw new \InvalidArgumentException(sprintf('Demasiadas aberturas (máximo %d).', self::MAX_OPENINGS));
        }
        if ([] !== $asked) {
            [$project, $missed] = $this->openings($project, $asked, $seq);
            if ($missed > 0) {
                $notes[] = sprintf('No pude ubicar %d abertura%s (sin un muro cerca o sin lugar con jambas de 25 cm): agregala%s en el editor.', $missed, 1 === $missed ? '' : 's', 1 === $missed ? '' : 's');
            }
        }

        $stairs = array_values(array_filter((array) ($plan['escaleras'] ?? []), is_array(...)));
        if (2 === $levels) {
            if ([] === $stairs) {
                $notes[] = 'El plano no trae la escalera: agregala en el editor (Nivel 1 → Escalera).';
            } else {
                $project = $this->stairs($project, $stairs, $seq, $notes);
            }
        }

        return ['project' => $project, 'notes' => $notes];
    }

    /**
     * Ambientes en unidades de 12,5 cm, corridos para dejar margen de terreno y con las rectas cercanas unificadas.
     *
     * @param array<int, mixed> $list
     * @param list<string>      $notes
     *
     * @return non-empty-list<array{name: string, level: int, x0: int, y0: int, x1: int, y1: int, open: list<string>, shift: array{float, float}}>
     */
    private function rooms(array $list, array &$notes): array
    {
        $list = array_values(array_filter($list, is_array(...)));
        if ([] === $list) {
            throw new \InvalidArgumentException('Faltan los ambientes del plano.');
        }
        if (count($list) > self::MAX_ROOMS) {
            throw new \InvalidArgumentException(sprintf('Demasiados ambientes (máximo %d).', self::MAX_ROOMS));
        }
        $raw = [];
        foreach ($list as $i => $a) {
            $name = mb_substr(trim((string) ($a['nombre'] ?? '')), 0, 40);
            $where = '' !== $name ? "«{$name}»" : 'n.º '.($i + 1);
            foreach (['x', 'y', 'ancho', 'fondo'] as $k) {
                if (!is_numeric($a[$k] ?? null) || abs((float) $a[$k]) > 200) {
                    throw new \InvalidArgumentException("Ambiente {$where}: falta «{$k}» (en metros).");
                }
            }
            $level = (int) ($a['nivel'] ?? 1);
            if ($level < 1 || $level > Hcca::MAX_LEVELS) {
                throw new \InvalidArgumentException("Ambiente {$where}: el nivel es 1 o 2.");
            }
            if ((float) $a['ancho'] <= 0 || (float) $a['fondo'] <= 0) {
                throw new \InvalidArgumentException("Ambiente {$where}: el ancho y el fondo tienen que ser positivos.");
            }
            $open = array_values(array_intersect(self::SIDES, array_map(static fn (mixed $s): string => mb_strtolower(trim((string) $s)), (array) ($a['abierto'] ?? []))));
            $type = is_string($a['tipo'] ?? null) && isset(Hcca::roomTypes()[$a['tipo']]) ? $a['tipo'] : '';
            $raw[] = ['name' => $name, 'type' => $type, 'where' => $where, 'level' => $level - 1, 'open' => $open,
                'x0' => (float) $a['x'], 'y0' => (float) $a['y'], 'x1' => (float) $a['x'] + (float) $a['ancho'], 'y1' => (float) $a['y'] + (float) $a['fondo']];
        }
        if ([] === array_filter($raw, static fn (array $r): bool => 0 === $r['level'])) {
            throw new \InvalidArgumentException('El Nivel 1 no tiene ambientes.');
        }
        $this->upperOffset = [0.0, 0.0];
        $raw = $this->stack($raw, $notes);
        // Mismo corrimiento para los dos niveles: el Nivel 2 queda sobre el Nivel 1.
        $shift = [self::MARGIN - $this->units(min(array_column($raw, 'x0'))), self::MARGIN - $this->units(min(array_column($raw, 'y0')))];
        // lo que el plano ubica en la planta alta (aberturas, pilares) se corre igual que sus ambientes
        $this->shift = [$shift, [$shift[0] + $this->units($this->upperOffset[0]), $shift[1] + $this->units($this->upperOffset[1])]];
        $xs = [];
        $ys = [];
        foreach ($raw as $k => $r) {
            foreach (['x0' => 0, 'x1' => 0, 'y0' => 1, 'y1' => 1] as $key => $axis) {
                $raw[$k][$key] = (int) round($this->units($r[$key]) + $shift[$axis]);
            }
            array_push($xs, $raw[$k]['x0'], $raw[$k]['x1']);
            array_push($ys, $raw[$k]['y0'], $raw[$k]['y1']);
        }
        $mapX = $this->mergeLines($xs);
        $mapY = $this->mergeLines($ys);
        $out = [];
        foreach ($raw as $r) {
            $room = ['name' => $r['name'], 'type' => $r['type'], 'level' => $r['level'], 'x0' => $mapX[$r['x0']], 'y0' => $mapY[$r['y0']], 'x1' => $mapX[$r['x1']], 'y1' => $mapY[$r['y1']], 'open' => $r['open'], 'shift' => $shift];
            if ($room['x1'] - $room['x0'] < self::MIN_SIDE || $room['y1'] - $room['y0'] < self::MIN_SIDE) {
                throw new \InvalidArgumentException(sprintf('Ambiente %s: mide menos de %s m de lado; revisá sus medidas.', $r['where'], $this->m(self::MIN_SIDE)));
            }
            $out[] = $room;
        }
        // el terreno admite hasta 100 m (800 unidades) por lado
        if (max(array_column($out, 'x1')) > 800 - self::MARGIN || max(array_column($out, 'y1')) > 800 - self::MARGIN) {
            throw new \InvalidArgumentException('La casa del plano no entra en un terreno de 100 m: revisá la escala (las medidas van en metros).');
        }

        return $out;
    }

    /**
     * Pone la planta alta sobre la baja. Se prueba como viene y alineando cada esquina de las cajas de las dos plantas;
     * gana la posición en la que más rectas de muros de arriba coinciden con las de abajo (pesada por cuánto se pisan).
     *
     * @param list<array<string, mixed>> $raw   ambientes en metros
     * @param list<string>               $notes
     *
     * @return list<array<string, mixed>>
     */
    private function stack(array $raw, array &$notes): array
    {
        $lower = array_values(array_filter($raw, static fn (array $r): bool => 0 === $r['level']));
        $upper = array_values(array_filter($raw, static fn (array $r): bool => 1 === $r['level']));
        if ([] === $upper) {
            return $raw;
        }
        $box = static fn (array $rs): array => [min(array_column($rs, 'x0')), min(array_column($rs, 'y0')), max(array_column($rs, 'x1')), max(array_column($rs, 'y1'))];
        [$lx0, $ly0, $lx1, $ly1] = $box($lower);
        [$ux0, $uy0, $ux1, $uy1] = $box($upper);
        $lines = static fn (array $rs, string $a, string $b): array => array_values(array_unique(array_merge(array_column($rs, $a), array_column($rs, $b))));
        $score = static function (float $dx, float $dy) use ($lower, $upper, $lines, $lx0, $ly0, $lx1, $ly1, $ux0, $uy0, $ux1, $uy1): float {
            $overlap = max(0, min($lx1, $ux1 + $dx) - max($lx0, $ux0 + $dx)) * max(0, min($ly1, $uy1 + $dy) - max($ly0, $uy0 + $dy)) / (($ux1 - $ux0) * ($uy1 - $uy0));
            $hits = 0;
            foreach ([['x0', 'x1', $dx], ['y0', 'y1', $dy]] as [$a, $b, $d]) {
                $below = $lines($lower, $a, $b);
                foreach ($lines($upper, $a, $b) as $v) {
                    $hits += array_any($below, static fn (float $w): bool => abs($w - $v - $d) <= 0.25) ? 1 : 0;
                }
            }

            return $hits * $overlap;
        };
        $best = [0.0, 0.0, $score(0.0, 0.0), null];
        foreach ([
            'arriba a la izquierda' => [$lx0 - $ux0, $ly0 - $uy0], 'arriba a la derecha' => [$lx1 - $ux1, $ly0 - $uy0],
            'abajo a la izquierda' => [$lx0 - $ux0, $ly1 - $uy1], 'abajo a la derecha' => [$lx1 - $ux1, $ly1 - $uy1],
        ] as $corner => [$dx, $dy]) {
            $s = $score($dx, $dy);
            if ($s > $best[2] + 1e-9) {
                $best = [$dx, $dy, $s, $corner];
            }
        }
        if (null === $best[3] || (abs($best[0]) < 0.01 && abs($best[1]) < 0.01)) {
            return $raw;
        }
        foreach ($raw as $k => $r) {
            if (1 === $r['level']) {
                $raw[$k] = ['x0' => $r['x0'] + $best[0], 'x1' => $r['x1'] + $best[0], 'y0' => $r['y0'] + $best[1], 'y1' => $r['y1'] + $best[1]] + $r;
            }
        }
        $this->upperOffset = [$best[0], $best[1]];
        $notes[] = "Puse la planta alta sobre la baja alineando la esquina de {$best[3]}: revisá que coincida.";

        return $raw;
    }

    /**
     * Rectas casi iguales (a ≤ 37,5 cm) pasan a ser una sola: la más usada del grupo.
     *
     * @param list<int> $values
     *
     * @return array<int, int> valor => recta
     */
    private function mergeLines(array $values): array
    {
        $count = array_count_values($values);
        ksort($count);
        $map = [];
        $group = [];
        $flush = static function () use (&$group, &$map, $count): void {
            if ([] === $group) {
                return;
            }
            $best = $group[0];
            foreach ($group as $v) {
                if ($count[$v] > $count[$best]) {
                    $best = $v;
                }
            }
            foreach ($group as $v) {
                $map[$v] = $best;
            }
            $group = [];
        };
        foreach (array_keys($count) as $v) {
            if ([] !== $group && $v - $group[0] > self::MERGE) {
                $flush();
            }
            $group[] = $v;
        }
        $flush();

        return $map;
    }

    /**
     * Muros de un nivel a partir de los lados de sus ambientes.
     *
     * @param list<array<string, mixed>>                              $rooms
     * @param list<array{x1: int, y1: int, x2: int, y2: int, t: int}> $above muros del nivel de arriba
     *
     * @return list<array{x1: int, y1: int, x2: int, y2: int, t: int}>
     */
    private function walls(array $rooms, int $innerT, array $above = []): array
    {
        // lados por recta: [eje][recta] => list<[desde, hasta, abierto]>
        $lines = ['h' => [], 'v' => []];
        foreach ($rooms as $r) {
            $lines['h'][$r['y0']][] = [$r['x0'], $r['x1'], in_array('arriba', $r['open'], true)];
            $lines['h'][$r['y1']][] = [$r['x0'], $r['x1'], in_array('abajo', $r['open'], true)];
            $lines['v'][$r['x0']][] = [$r['y0'], $r['y1'], in_array('izquierda', $r['open'], true)];
            $lines['v'][$r['x1']][] = [$r['y0'], $r['y1'], in_array('derecha', $r['open'], true)];
        }
        $out = [];
        foreach ($lines as $axis => $byLine) {
            foreach ($byLine as $line => $edges) {
                $cuts = array_values(array_unique(array_merge(array_column($edges, 0), array_column($edges, 1))));
                sort($cuts);
                $run = null; // [desde, hasta, espesor]
                for ($i = 0; $i < count($cuts) - 1; ++$i) {
                    [$a, $b] = [$cuts[$i], $cuts[$i + 1]];
                    $over = array_filter($edges, static fn (array $e): bool => $e[0] <= $a && $e[1] >= $b);
                    // sin lados, o con alguno abierto, el tramo no lleva muro; con un solo lado es exterior
                    $t = [] === $over || [] !== array_filter($over, static fn (array $e): bool => $e[2]) ? null : (1 === count($over) ? 20 : $innerT);
                    if (null !== $t && $t < 20 && array_any($above, static fn (array $w): bool => 20 === $w['t'] && ('h' === $axis
                        ? $w['y1'] === $w['y2'] && $w['y1'] === $line && $w['x1'] < $b && $w['x2'] > $a
                        : $w['x1'] === $w['x2'] && $w['x1'] === $line && $w['y1'] < $b && $w['y2'] > $a))) {
                        $t = 20;
                    }
                    if (null !== $run && $run[2] === $t && null !== $t) {
                        $run[1] = $b;
                        continue;
                    }
                    if (null !== $run) {
                        $out[] = $this->wall($axis, $line, $run);
                    }
                    $run = null === $t ? null : [$a, $b, $t];
                }
                if (null !== $run) {
                    $out[] = $this->wall($axis, $line, $run);
                }
            }
        }

        return $out;
    }

    /**
     * @param array{int, int, int} $run
     *
     * @return array{x1: int, y1: int, x2: int, y2: int, t: int}
     */
    private function wall(string $axis, int $line, array $run): array
    {
        return 'h' === $axis
            ? ['x1' => $run[0], 'y1' => $line, 'x2' => $run[1], 'y2' => $line, 't' => $run[2]]
            : ['x1' => $line, 'y1' => $run[0], 'x2' => $line, 'y2' => $run[1], 't' => $run[2]];
    }

    /**
     * Fracción del ambiente que tiene ambientes de `$others` encima.
     *
     * @param array<string, mixed>       $room
     * @param list<array<string, mixed>> $others
     */
    private function covered(array $room, array $others): float
    {
        $area = 0;
        foreach ($others as $o) {
            $area += max(0, min($room['x1'], $o['x1']) - max($room['x0'], $o['x0'])) * max(0, min($room['y1'], $o['y1']) - max($room['y0'], $o['y0']));
        }

        return $area / (($room['x1'] - $room['x0']) * ($room['y1'] - $room['y0']));
    }

    /**
     * Techos: uno por cada rectángulo grande de la planta del último nivel (una planta en L lleva dos, que se cruzan) y,
     * en dos plantas, los de la parte de la planta baja que no tiene nada encima.
     *
     * @param list<array<string, mixed>> $rooms
     * @param list<string>               $notes
     *
     * @return list<array<string, mixed>>
     */
    private function roofs(array $rooms, int $levels, string $type, int &$seq, array &$notes): array
    {
        $top = array_values(array_filter($rooms, static fn (array $r): bool => $r['level'] === $levels - 1));
        $parts = [];
        $left = 0.0;
        foreach ($this->cover($top, [], $left) as $rect) {
            $parts[] = $this->roofPart($rect, $levels - 1, $type, 'r'.(++$seq));
        }
        if (2 === $levels) {
            $lower = array_values(array_filter($rooms, static fn (array $r): bool => 0 === $r['level']));
            $cx = (min(array_column($top, 'x0')) + max(array_column($top, 'x1'))) / 2;
            $cy = (min(array_column($top, 'y0')) + max(array_column($top, 'y1'))) / 2;
            foreach ($this->cover($lower, $top, $left) as $rect) {
                // techo bajo, pegado a la planta alta: a un agua, cayendo hacia afuera
                [$x, $y, $w, $h] = $rect;
                $dx = $x + $w / 2 - $cx;
                $dy = $y + $h / 2 - $cy;
                $parts[] = $this->roofPart($rect, 0, 'un_agua', 'r'.(++$seq), abs($dx) >= abs($dy) ? ($dx >= 0 ? 'E' : 'W') : ($dy >= 0 ? 'S' : 'N'));
            }
        }
        if ($left > 0.1) {
            $notes[] = 'Quedó una parte de la casa sin techo: completala en la pestaña Techo.';
        }

        return array_slice($parts, 0, Hcca::MAX_ROOFS);
    }

    /**
     * Rectángulos (x, y, w, h en unidades) que cubren la planta de `$rooms` sin lo que tapan `$above`: se elige cada vez
     * el rectángulo lleno que más superficie nueva cubre, hasta 4 por planta. `$left` suma la fracción que quedó sin cubrir.
     *
     * @param list<array<string, mixed>> $rooms
     * @param list<array<string, mixed>> $above
     *
     * @return list<array{int, int, int, int}>
     */
    private function cover(array $rooms, array $above, float &$left): array
    {
        $xs = array_values(array_unique(array_merge(array_column($rooms, 'x0'), array_column($rooms, 'x1'), array_column($above, 'x0'), array_column($above, 'x1'))));
        $ys = array_values(array_unique(array_merge(array_column($rooms, 'y0'), array_column($rooms, 'y1'), array_column($above, 'y0'), array_column($above, 'y1'))));
        sort($xs);
        sort($ys);
        $nx = count($xs) - 1;
        $ny = count($ys) - 1;
        $inside = static fn (array $list, float $x, float $y): bool => array_any($list, static fn (array $r): bool => $x > $r['x0'] && $x < $r['x1'] && $y > $r['y0'] && $y < $r['y1']);
        $rest = []; // superficie todavía sin techo de cada celda; null = fuera de la planta
        $total = 0;
        for ($i = 0; $i < $nx; ++$i) {
            for ($j = 0; $j < $ny; ++$j) {
                $mx = ($xs[$i] + $xs[$i + 1]) / 2;
                $my = ($ys[$j] + $ys[$j + 1]) / 2;
                $rest[$i][$j] = $inside($rooms, $mx, $my) && !$inside($above, $mx, $my) ? ($xs[$i + 1] - $xs[$i]) * ($ys[$j + 1] - $ys[$j]) : null;
                $total += $rest[$i][$j] ?? 0;
            }
        }
        if (0 === $total) {
            return [];
        }
        $out = [];
        $covered = 0;
        for ($pass = 0; $pass < 4; ++$pass) {
            $best = null; // [ganancia, superficie, i0, i1, j0, j1]
            for ($i0 = 0; $i0 < $nx; ++$i0) {
                for ($j0 = 0; $j0 < $ny; ++$j0) {
                    $maxJ = $ny; // al ensanchar, el alto posible sólo se achica
                    $gainCols = array_fill($j0, $ny - $j0, 0);
                    for ($i1 = $i0; $i1 < $nx && $maxJ > $j0; ++$i1) {
                        $gain = 0;
                        for ($j1 = $j0; $j1 < $maxJ; ++$j1) {
                            if (null === $rest[$i1][$j1]) {
                                $maxJ = $j1;
                                break;
                            }
                            $gainCols[$j1] += $rest[$i1][$j1];
                            $gain += $gainCols[$j1];
                            $w = $xs[$i1 + 1] - $xs[$i0];
                            $h = $ys[$j1 + 1] - $ys[$j0];
                            if ($w >= 8 && $h >= 8 && (null === $best || $gain > $best[0] || ($gain === $best[0] && $w * $h > $best[1]))) {
                                $best = [$gain, $w * $h, $i0, $i1, $j0, $j1];
                            }
                        }
                    }
                }
            }
            // una parte chica (menos del 8 % o de 4 m²) no justifica otro techo
            if (null === $best || $best[0] < max(0.08 * $total, 256)) {
                break;
            }
            [, , $i0, $i1, $j0, $j1] = $best;
            for ($i = $i0; $i <= $i1; ++$i) {
                for ($j = $j0; $j <= $j1; ++$j) {
                    $rest[$i][$j] = 0;
                }
            }
            $covered += $best[0];
            $out[] = [$xs[$i0], $ys[$j0], $xs[$i1 + 1] - $xs[$i0], $ys[$j1 + 1] - $ys[$j0]];
        }
        $left += ($total - $covered) / $total;

        return $out;
    }

    /**
     * @param array{int, int, int, int} $rect
     *
     * @return array<string, mixed>
     */
    private function roofPart(array $rect, int $level, string $type, string $id, ?string $fall = null): array
    {
        [$x, $y, $w, $h] = $rect;
        $base = ['id' => $id, 'level' => $level, 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h, 'slope' => 30, 'overhang' => 40, 'spacing' => 50];
        // A un agua sólo si un cabio cubre la caída (misma regla que RoofPlanner); si no, a dos aguas.
        $maxRun = max(array_column(Hcca::timberSections(), 'maxSpanCm')) * (40 / 50) ** (1 / 3) / Hcca::GRID_CM;
        if ('un_agua' === $type) {
            $fall ??= $h <= $w ? 'S' : 'E';
            $run = in_array($fall, ['N', 'S'], true) ? $h : $w;
            if ($run <= $maxRun) {
                return $base + ['type' => 'shed', 'dir' => $fall, 'section' => HouseGenerator::section($run)];
            }
        }

        return $base + ['type' => 'gable', 'dir' => $w >= $h ? 'x' : 'y', 'section' => HouseGenerator::section(min($w, $h) / 2)];
    }

    /**
     * Escaleras del plano (rectángulos en metros de la planta baja): se prueba la forma, el ancho y la huella que mejor
     * llenan el rectángulo y entran en el ambiente; la que no entra de ninguna forma se avisa.
     *
     * @param array<string, mixed>       $project
     * @param list<array<string, mixed>> $asked
     * @param list<string>               $notes
     *
     * @return array<string, mixed>
     */
    private function stairs(array $project, array $asked, int &$seq, array &$notes): array
    {
        $n = (int) ceil(Hcca::LEVEL_HEIGHT_CM / 18);
        $k1 = (int) ceil($n / 2);
        $missed = 0;
        foreach (array_slice($asked, 0, Hcca::MAX_STAIRS_PER_LEVEL) as $s) {
            if (!is_numeric($s['x'] ?? null) || !is_numeric($s['y'] ?? null) || !is_numeric($s['ancho'] ?? null) || !is_numeric($s['fondo'] ?? null)) {
                ++$missed;
                continue;
            }
            $x = (int) round($this->units((float) $s['x']) + $this->shift[0][0]);
            $y = (int) round($this->units((float) $s['y']) + $this->shift[0][1]);
            $rw = (float) $s['ancho'] * 100;
            $rh = (float) $s['fondo'] * 100;
            $up = mb_strtolower(trim((string) ($s['sube'] ?? '')));
            $options = [];
            foreach (['U', 'L', 'straight'] as $shape) {
                foreach ([28, 25, 30] as $tread) {
                    for ($w = 7; $w <= 12; ++$w) {
                        $W = $w * Hcca::GRID_CM;
                        [$along, $across] = match ($shape) {
                            'straight' => [($n - 1) * $tread, $W],
                            'L' => [($k1 - 1) * $tread + $W, $W + ($n - $k1 - 1) * $tread],
                            default => [($k1 - 1) * $tread + $W, 2 * $W],
                        };
                        foreach (['x' => [$along, $across], 'y' => [$across, $along]] as $axis => [$fw, $fh]) {
                            if ($fw > $rw + 40 || $fh > $rh + 40) {
                                continue;
                            }
                            $dir = 'x' === $axis ? ('izquierda' === $up ? 'W' : 'E') : ('arriba' === $up ? 'N' : 'S');
                            // si el plano dice hacia dónde sube, se prefiere ese eje
                            $offAxis = '' !== $up && (in_array($up, ['izquierda', 'derecha'], true) !== ('x' === $axis)) ? 200 : 0;
                            $options[] = [abs($rw - $fw) + abs($rh - $fh) + $offAxis, ['x' => $x, 'y' => $y, 'dir' => $dir, 'shape' => $shape, 'w' => $w, 'tread' => $tread, 'turn' => 'right']];
                        }
                    }
                }
            }
            usort($options, static fn (array $a, array $b): int => $a[0] <=> $b[0]);
            $placed = false;
            foreach (array_slice($options, 0, 8) as [, $stair]) {
                $try = $project;
                $id = 'e'.($seq + 1);
                $try['levels'][0]['stairs'][] = ['id' => $id] + $stair;
                try {
                    $issues = $this->analyzer->analyze(ProjectFactory::fromArray($try))['analysis']['issues'];
                } catch (InvalidProjectException) {
                    continue;
                }
                if (!array_any($issues, static fn (array $i): bool => $id === ($i['ref'] ?? null) && in_array($i['code'], ['stair.outside', 'stair.overlap'], true))) {
                    $project = $try;
                    ++$seq;
                    $placed = true;
                    break;
                }
            }
            $missed += $placed ? 0 : 1;
        }
        if ($missed > 0) {
            $notes[] = 'La escalera del plano no entra en su ambiente con las medidas que tomé: agregala en el editor (Nivel 1 → Escalera).';
        }

        return $project;
    }

    /**
     * Ubica las aberturas en los muros ya normalizados (los tramos libres salen del análisis, como en el editor).
     *
     * @param array<string, mixed>       $project
     * @param list<array<string, mixed>> $asked
     *
     * @return array{array<string, mixed>, int} el proyecto y cuántas no entraron
     */
    private function openings(array $project, array $asked, int &$seq): array
    {
        try {
            $result = $this->analyzer->analyze(ProjectFactory::fromArray($project));
        } catch (InvalidProjectException $e) {
            throw new \InvalidArgumentException('Los ambientes no forman un proyecto válido: '.implode('; ', array_slice($e->errors, 0, 3)));
        }
        $project = $result['project'];
        $slots = [];
        foreach ($result['analysis']['levels'] as $li => $level) {
            foreach ($level['walls'] as $id => $info) {
                $slots[$li][$id] = $info['slots'];
            }
        }
        $missed = 0;
        foreach ($asked as $o) {
            $spec = self::OPENINGS[$this->openingType((string) ($o['tipo'] ?? ''))] ?? null;
            $li = (int) ($o['nivel'] ?? 1) - 1;
            if (null === $spec || !is_numeric($o['x'] ?? null) || !is_numeric($o['y'] ?? null) || !isset($project['levels'][$li])) {
                ++$missed;
                continue;
            }
            [$kind, $default, $min, $max, $sill, $mode] = $spec;
            $want = is_numeric($o['ancho'] ?? null) && (float) $o['ancho'] > 0 ? max($min, min($max, (int) round($this->units((float) $o['ancho'])))) : $default;
            if ('window' === $kind && is_numeric($o['alto'] ?? null) && (float) $o['alto'] > 0) {
                // el alto de la carpintería fija el antepecho: todos los vanos rematan a 2,00 m
                $sill = Hcca::OPENING_TOP_COURSE - max(2, min(Hcca::OPENING_TOP_COURSE, (int) ceil((float) $o['alto'] * 100 / 25 - 1e-6)));
            }
            $hinge = mb_strtolower(trim((string) ($o['bisagra'] ?? '')));
            $swing = mb_strtolower(trim((string) ($o['abre'] ?? '')));
            $px = $this->units((float) $o['x']) + $this->shift[$li][0];
            $py = $this->units((float) $o['y']) + $this->shift[$li][1];

            // muros del nivel, del más cercano al punto al más lejano
            $near = [];
            foreach ($project['levels'][$li]['walls'] as $w) {
                $horizontal = $w['y1'] === $w['y2'];
                $along = $horizontal ? $px - $w['x1'] : $py - $w['y1'];
                $len = $horizontal ? $w['x2'] - $w['x1'] : $w['y2'] - $w['y1'];
                $d = hypot(abs($horizontal ? $py - $w['y1'] : $px - $w['x1']), max(0, -$along, $along - $len));
                if ($d <= self::REACH) {
                    $near[] = [$d, $w['id'], $along, $horizontal];
                }
            }
            usort($near, static fn (array $a, array $b): int => $a[0] <=> $b[0]);
            $placed = false;
            foreach ($near as [, $wallId, $along, $horizontal]) {
                // el ancho pedido o, si no entra, el más grande que entre
                for ($w = $want; $w >= $min && !$placed; --$w) {
                    $best = null;
                    foreach ($slots[$li][$wallId] ?? [] as [$from, $to]) {
                        if ($to - $from < $w) {
                            continue;
                        }
                        $pos = max($from, min($to - $w, (int) round($along - $w / 2)));
                        if (null === $best || abs($pos + $w / 2 - $along) < abs($best + $w / 2 - $along)) {
                            $best = $pos;
                        }
                    }
                    if (null === $best) {
                        continue;
                    }
                    $project['levels'][$li]['openings'][] = ['id' => 'o'.(++$seq), 'wall' => $wallId, 'pos' => $best, 'w' => $w, 'sill' => $sill, 'h' => Hcca::OPENING_TOP_COURSE - $sill, 'kind' => $kind, 'preset' => '',
                        // sentido de la puerta, dicho por el plano: bisagra al final del vano y hoja hacia arriba o la izquierda
                        'flip' => $swing === ($horizontal ? 'arriba' : 'izquierda'), 'hingeEnd' => $hinge === ($horizontal ? 'derecha' : 'abajo'), 'mode' => $mode];
                    $slots[$li][$wallId] = $this->block($slots[$li][$wallId], $best - 2, $best + $w + 2);
                    $placed = true;
                }
                if ($placed) {
                    break;
                }
            }
            $missed += $placed ? 0 : 1;
        }

        return [$project, $missed];
    }

    /**
     * Quita [desde, hasta] de los tramos libres (el vano y sus jambas de 25 cm).
     *
     * @param list<array{int, int}> $slots
     *
     * @return list<array{int, int}>
     */
    private function block(array $slots, int $from, int $to): array
    {
        $out = [];
        foreach ($slots as [$a, $b]) {
            if ($to <= $a || $from >= $b) {
                $out[] = [$a, $b];
                continue;
            }
            if ($a < $from) {
                $out[] = [$a, $from];
            }
            if ($to < $b) {
                $out[] = [$to, $b];
            }
        }

        return $out;
    }

    private function openingType(string $t): string
    {
        $t = mb_strtolower(trim(strtr($t, ['ó' => 'o', 'á' => 'a'])));

        return ['puerta_ventana' => 'ventanal', 'puerta ventana' => 'ventanal', 'balcon' => 'ventanal', 'garage' => 'porton', 'garaje' => 'porton'][$t] ?? $t;
    }

    /**
     * Terreno: el de siempre o, si la casa es más grande, lo que ocupa más el margen.
     *
     * @param list<array<string, mixed>> $rooms
     *
     * @return array{w: int, d: int}
     */
    private function lot(array $rooms): array
    {
        $size = static fn (int $units, int $min): int => min(100, max($min, (int) ceil(($units + self::MARGIN) * Hcca::GRID_CM / 100)));

        return ['w' => $size(max(array_column($rooms, 'x1')), 24), 'd' => $size(max(array_column($rooms, 'y1')), 20)];
    }

    private function units(float $meters): float
    {
        return $meters * 100 / Hcca::GRID_CM;
    }

    private function m(int $units): string
    {
        return rtrim(rtrim(number_format($units * Hcca::GRID_CM / 100, 2, ',', ''), '0'), ',');
    }
}
