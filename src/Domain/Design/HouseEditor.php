<?php

declare(strict_types=1);

namespace App\Domain\Design;

use App\Domain\Hcca;

/**
 * Cambios puntuales sobre un proyecto existente (plantilla, proyecto del usuario o casa generada), expresados como
 * operaciones simples en metros y con los ids que devuelve HouseDescriber. El resultado lo valida el motor completo.
 */
final class HouseEditor
{
    public const array ACTIONS = ['agregar_ventana', 'agregar_vano', 'quitar_vano', 'cambiar_vano', 'agregar_muro', 'quitar_muro', 'cambiar_techo', 'renombrar'];

    /** Orden de preferencia de orientaciones para una ventana sin orientación pedida (sol de invierno en el hemisferio sur). */
    private const array SUN_ORDER = ['N', 'E', 'O', 'S'];

    /** @var array<string, mixed>|null análisis del proyecto (para ubicar ventanas por ambiente) */
    private ?array $analysis = null;

    /**
     * @param array<string, mixed>             $project
     * @param list<array<string, mixed>>       $operations
     * @param array<string, mixed>|null        $analysis   análisis de `$project` (lo necesita agregar_ventana)
     *
     * @return array<string, mixed> el proyecto modificado
     *
     * @throws \InvalidArgumentException si una operación no se puede aplicar (indica cuál y por qué)
     */
    public function apply(array $project, array $operations, ?array $analysis = null): array
    {
        $this->analysis = $analysis;
        if ([] === $operations || count($operations) > 30) {
            throw new \InvalidArgumentException('Mandá entre 1 y 30 operaciones.');
        }
        foreach (array_values($operations) as $i => $op) {
            try {
                $project = $this->one($project, (array) $op);
            } catch (\InvalidArgumentException $e) {
                throw new \InvalidArgumentException(sprintf('Operación %d (%s): %s', $i + 1, (string) ($op['accion'] ?? '?'), $e->getMessage()));
            }
        }

        return $project;
    }

    /**
     * @param array<string, mixed> $p
     * @param array<string, mixed> $op
     *
     * @return array<string, mixed>
     */
    private function one(array $p, array $op): array
    {
        $action = (string) ($op['accion'] ?? '');
        switch ($action) {
            case 'agregar_ventana':
                return $this->windowInRoom($p, $op);
            case 'agregar_vano':
                [$li, $wi] = $this->findWall($p, (string) ($op['muro'] ?? ''));
                $w = $p['levels'][$li]['walls'][$wi];
                $preset = $this->preset((string) ($op['tipo'] ?? ''));
                $spec = Hcca::openingPresets()[$preset];
                $len = abs($w['x2'] - $w['x1']) + abs($w['y2'] - $w['y1']);
                $pos = isset($op['desde']) && is_numeric($op['desde']) ? $this->u((float) $op['desde']) : intdiv($len - $spec['w'], 2);
                if ($pos < 0 || $pos + $spec['w'] > $len) {
                    throw new \InvalidArgumentException(sprintf('el vano de %s m no entra en el muro %s de %s m.', $this->m($spec['w']), $w['id'], $this->m($len)));
                }
                $p['levels'][$li]['openings'][] = [
                    'id' => $this->nextId($p, 'o'), 'wall' => $w['id'], 'pos' => $pos, 'w' => $spec['w'], 'sill' => $spec['sill'], 'h' => $spec['h'],
                    'kind' => $spec['kind']->value, 'preset' => $preset, 'flip' => false,
                ];

                return $p;
            case 'quitar_vano':
            case 'cambiar_vano':
                [$li, $oi] = $this->findOpening($p, (string) ($op['vano'] ?? ''));
                if ('quitar_vano' === $action) {
                    array_splice($p['levels'][$li]['openings'], $oi, 1);

                    return $p;
                }
                $o = $p['levels'][$li]['openings'][$oi];
                $preset = $this->preset((string) ($op['tipo'] ?? ''));
                $spec = Hcca::openingPresets()[$preset];
                $center = $o['pos'] + $o['w'] / 2;
                $o = ['pos' => max(0, (int) round($center - $spec['w'] / 2)), 'w' => $spec['w'], 'sill' => $spec['sill'], 'h' => $spec['h'], 'kind' => $spec['kind']->value, 'preset' => $preset] + $o;
                $p['levels'][$li]['openings'][$oi] = $o;

                return $p;
            case 'agregar_muro':
                $li = (int) ($op['nivel'] ?? 1) - 1;
                if ($li < 0 || $li > 1 || (1 === $li && !($p['upper'] ?? false))) {
                    throw new \InvalidArgumentException('nivel inexistente.');
                }
                [$x1, $y1, $x2, $y2] = array_map(fn ($v): int => $this->u((float) $v), [$op['x1'] ?? 0, $op['y1'] ?? 0, $op['x2'] ?? 0, $op['y2'] ?? 0]);
                if (($x1 !== $x2) === ($y1 !== $y2)) {
                    throw new \InvalidArgumentException('el muro tiene que ser horizontal o vertical y tener largo.');
                }
                $t = (int) ($op['espesorCm'] ?? 10);
                if (!in_array((float) $t, Hcca::thicknesses(), true)) {
                    throw new \InvalidArgumentException(sprintf('espesor inválido (%s cm).', implode(', ', Hcca::thicknesses())));
                }
                $p['levels'][$li]['walls'][] = ['id' => $this->nextId($p, 'w'), 'x1' => min($x1, $x2), 'y1' => min($y1, $y2), 'x2' => max($x1, $x2), 'y2' => max($y1, $y2), 't' => $t];

                return $p;
            case 'quitar_muro':
                [$li, $wi] = $this->findWall($p, (string) ($op['muro'] ?? ''));
                $id = $p['levels'][$li]['walls'][$wi]['id'];
                array_splice($p['levels'][$li]['walls'], $wi, 1);
                $p['levels'][$li]['openings'] = array_values(array_filter($p['levels'][$li]['openings'], static fn (array $o): bool => $o['wall'] !== $id));

                return $p;
            case 'cambiar_techo':
                $type = (string) ($op['tipo'] ?? 'dos_aguas');
                if (!in_array($type, ['dos_aguas', 'un_agua'], true)) {
                    throw new \InvalidArgumentException('tipo de techo: dos_aguas o un_agua.');
                }
                if ([] === ($p['roofs'] ?? [])) {
                    throw new \InvalidArgumentException('la casa no tiene techo; volvé a generarla.');
                }
                $roofs = [];
                foreach ($p['roofs'] as $r) {
                    if (isset($op['pendiente']) && is_numeric($op['pendiente'])) {
                        $r['slope'] = max(10, min(60, (int) $op['pendiente']));
                    }
                    $r['spacing'] = 50;
                    array_push($roofs, ...('un_agua' === $type ? $this->shed($p, $r) : [$this->gable($r)]));
                }
                $p['roofs'] = $roofs;

                return $p;
            case 'renombrar':
                $name = trim((string) ($op['nombre'] ?? ''));
                if ('' === $name) {
                    throw new \InvalidArgumentException('falta el nombre.');
                }
                $p['name'] = mb_substr($name, 0, 80);

                return $p;
            default:
                throw new \InvalidArgumentException(sprintf('acción desconocida; usá: %s.', implode(', ', self::ACTIONS)));
        }
    }

    /** Luz horizontal máxima (u) que cubre un cabio de la sección más grande a 50 cm (misma regla que RoofPlanner). */
    private function maxRun(): float
    {
        $max = max(array_column(Hcca::timberSections(), 'maxSpanCm'));

        return $max * (40 / 50) ** (1 / 3) / Hcca::GRID_CM;
    }

    /**
     * @param array<string, mixed> $r
     *
     * @return array<string, mixed>
     */
    private function gable(array $r): array
    {
        $r['type'] = 'gable';
        $r['dir'] = $r['w'] >= $r['h'] ? 'x' : 'y';
        $r['section'] = HouseGenerator::section(('x' === $r['dir'] ? $r['h'] : $r['w']) / 2);

        return $r;
    }

    /**
     * Techo a un agua: cae hacia el lado corto si la luz alcanza; si no, dos faldones escalonados sobre un muro
     * portante interior que cruce todo el techo; si tampoco hay, no se puede.
     *
     * @param array<string, mixed> $p
     * @param array<string, mixed> $r
     *
     * @return list<array<string, mixed>>
     */
    private function shed(array $p, array $r): array
    {
        $max = $this->maxRun();
        $r['type'] = 'shed';
        if ($r['h'] <= $max || $r['w'] <= $max) {
            $r['dir'] = $r['h'] <= $max && ($r['h'] <= $r['w'] || $r['w'] > $max) ? 'S' : 'E';
            $r['section'] = HouseGenerator::section('S' === $r['dir'] ? $r['h'] : $r['w']);

            return [$r];
        }
        // muro portante (≥ 15 cm) horizontal que cruce el techo, lo más al centro posible
        $walls = $p['levels'][(int) ($r['level'] ?? 0)]['walls'] ?? [];
        $best = null;
        foreach ($walls as $w) {
            if ($w['y1'] !== $w['y2'] || $w['t'] < 15 || $w['y1'] <= $r['y'] || $w['y1'] >= $r['y'] + $r['h']) {
                continue;
            }
            $covered = array_sum(array_map(static fn (array $o): int => max(0, min($o['x2'], $r['x'] + $r['w']) - max($o['x1'], $r['x'])), array_filter($walls, static fn (array $o): bool => $o['y1'] === $o['y2'] && $o['y1'] === $w['y1'] && $o['t'] >= 15)));
            $a = $w['y1'] - $r['y'];
            $b = $r['y'] + $r['h'] - $w['y1'];
            if ($covered >= 0.8 * $r['w'] && $a <= $max && $b <= $max && (null === $best || abs($a - $b) < abs($best[0] - $best[1]))) {
                $best = [$a, $b];
            }
        }
        if (null === $best) {
            throw new \InvalidArgumentException(sprintf('a un agua no se puede: la casa tiene %s m de fondo y un cabio cubre como máximo %s m, y no hay un muro portante interior que cruce toda la casa para partir el techo en dos faldones. Opciones: dejarlo a dos aguas o, si la casa tiene programa, volver a generarla con techo un_agua (el generador agrega ese muro).', $this->m($r['h']), $this->m((int) floor($max))));
        }
        $first = ['h' => $best[0], 'dir' => 'S', 'section' => HouseGenerator::section($best[0])] + $r;
        $second = ['id' => $r['id'].'b', 'y' => $r['y'] + $best[0], 'h' => $best[1], 'dir' => 'S', 'section' => HouseGenerator::section($best[1])] + $r;

        return [$first, $second];
    }

    /**
     * Ventana en un ambiente («N1-A2»): el tramo exterior más largo libre de vanos (con jambas de 25 cm), en la
     * orientación pedida o la de más sol. Si la ventana pedida no entra, la más grande que entre.
     *
     * @param array<string, mixed> $p
     * @param array<string, mixed> $op
     *
     * @return array<string, mixed>
     */
    private function windowInRoom(array $p, array $op): array
    {
        if (null === $this->analysis) {
            throw new \InvalidArgumentException('falta el análisis de la casa.');
        }
        if (1 !== preg_match('/^N([12])-A(\d+)$/', strtoupper(trim((string) ($op['ambiente'] ?? ''))), $m)) {
            throw new \InvalidArgumentException('indicá el ambiente con su id (por ejemplo N1-A2).');
        }
        $li = (int) $m[1] - 1;
        $room = array_values(array_filter($this->analysis['levels'][$li]['rooms'] ?? [], static fn (array $r): bool => $r['id'] === (int) $m[2]))[0] ?? null;
        if (null === $room) {
            throw new \InvalidArgumentException(sprintf('no existe el ambiente %s.', $op['ambiente']));
        }
        $want = strtoupper(trim((string) ($op['orientacion'] ?? '')));
        $want = ['W' => 'O'][$want] ?? $want;
        $info = $this->analysis['levels'][$li]['walls'] ?? [];
        $north = (int) ($p['north'] ?? 0);

        $gaps = []; // [facing, wallIndex, from, to]
        foreach ($p['levels'][$li]['walls'] as $wi => $w) {
            $ext = $info[$w['id']]['ext'] ?? null;
            if (!is_array($ext)) {
                continue;
            }
            $facing = $this->facing($ext, $north);
            $horizontal = $w['y1'] === $w['y2'];
            $line = $horizontal ? $w['y1'] : $w['x1'];
            $start = $horizontal ? min($w['x1'], $w['x2']) : min($w['y1'], $w['y2']);
            $end = $horizontal ? max($w['x1'], $w['x2']) : max($w['y1'], $w['y2']);
            foreach ($room['fill'] as [$fx, $fy, $fw, $fh]) {
                $touch = $horizontal ? ($fy === $line || $fy + $fh === $line) : ($fx === $line || $fx + $fw === $line);
                if (!$touch) {
                    continue;
                }
                $a = max($start, $horizontal ? $fx : $fy) - $start;
                $b = min($end, $horizontal ? $fx + $fw : $fy + $fh) - $start;
                if ($b - $a <= 6) {
                    continue;
                }
                // Tramo libre: 3 u de jamba en los extremos y 2 u contra otros vanos del muro.
                $free = [[$a + 3, $b - 3]];
                foreach ($p['levels'][$li]['openings'] as $o) {
                    if ($o['wall'] !== $w['id']) {
                        continue;
                    }
                    $next = [];
                    foreach ($free as [$f0, $f1]) {
                        if ($o['pos'] - 2 > $f0) {
                            $next[] = [$f0, min($f1, $o['pos'] - 2)];
                        }
                        if ($o['pos'] + $o['w'] + 2 < $f1) {
                            $next[] = [max($f0, $o['pos'] + $o['w'] + 2), $f1];
                        }
                    }
                    $free = $next;
                }
                foreach ($free as [$f0, $f1]) {
                    if ($f1 - $f0 >= 5) {
                        $gaps[] = [$facing, $wi, $f0, $f1];
                    }
                }
            }
        }
        $all = $gaps;
        if ('' !== $want) {
            $gaps = array_values(array_filter($gaps, static fn (array $g): bool => $g[0] === $want));
        }
        if ([] === $gaps) {
            $free = [];
            foreach ($all as [$f, , $a, $b]) {
                $free[$f] = max($free[$f] ?? 0, $b - $a);
            }
            $hint = [] === $free ? 'no tiene muros exteriores libres' : 'hay lugar hacia: '.implode(', ', array_map(fn (string $f, int $u): string => "{$f} (hasta {$this->m($u)} m)", array_keys($free), $free));

            throw new \InvalidArgumentException(sprintf('el ambiente %s no tiene muro exterior libre%s para una ventana; %s.', $op['ambiente'], '' !== $want ? " hacia el {$want}" : '', $hint));
        }
        usort($gaps, static fn (array $x, array $y): int => [array_search($x[0], self::SUN_ORDER, true), $y[3] - $y[2]] <=> [array_search($y[0], self::SUN_ORDER, true), $x[3] - $x[2]]);
        $presets = Hcca::openingPresets();
        $asked = isset($op['tipo']) ? $this->preset((string) $op['tipo']) : 'V150';
        if ('window' !== $presets[$asked]['kind']->value) {
            throw new \InvalidArgumentException('agregar_ventana es para ventanas; para puertas usá agregar_vano.');
        }
        // El primer tramo donde entre la ventana (o la más grande posible hasta la pedida) sin pasar el 60 % de vanos
        // del muro portante.
        foreach ($gaps as [, $wi, $f0, $f1]) {
            $wall = $p['levels'][$li]['walls'][$wi];
            $len = abs($wall['x2'] - $wall['x1']) + abs($wall['y2'] - $wall['y1']);
            $used = array_sum(array_map(static fn (array $o): int => $o['w'], array_filter($p['levels'][$li]['openings'], static fn (array $o): bool => $o['wall'] === $wall['id'])));
            $room = $wall['t'] >= 15 ? (int) floor(0.6 * $len) - $used : PHP_INT_MAX;
            foreach ([$asked, 'VG150', 'V187', 'V150', 'V125', 'V100', 'V62'] as $c) {
                $w = $presets[$c]['w'];
                if ($w <= $f1 - $f0 && $w <= $presets[$asked]['w'] && $w <= $room) {
                    return $this->one($p, ['accion' => 'agregar_vano', 'muro' => $wall['id'], 'tipo' => $c, 'desde' => ($f0 + intdiv($f1 - $f0 - $w, 2)) * Hcca::GRID_CM / 100]);
                }
            }
        }

        throw new \InvalidArgumentException(sprintf('en el ambiente %s no entra otra ventana%s sin pasar el 60 %% de vanos del muro portante.', $op['ambiente'], '' !== $want ? " hacia el {$want}" : ''));
    }

    /** @param array{0: int|float, 1: int|float} $ext */
    private function facing(array $ext, int $north): string
    {
        $bearing = rad2deg(atan2((float) $ext[0], -(float) $ext[1]));
        $rel = fmod(fmod($bearing - $north, 360) + 360, 360);

        return ['N', 'E', 'S', 'O'][((int) round($rel / 90)) % 4];
    }

    /**
     * @param array<string, mixed> $p
     *
     * @return array{int, int}
     */
    private function findWall(array $p, string $id): array
    {
        foreach ($p['levels'] as $li => $level) {
            foreach ($level['walls'] as $wi => $w) {
                if ($w['id'] === $id) {
                    return [$li, $wi];
                }
            }
        }
        throw new \InvalidArgumentException(sprintf('no existe el muro «%s» (pedí ver_casa para los ids).', $id));
    }

    /**
     * @param array<string, mixed> $p
     *
     * @return array{int, int}
     */
    private function findOpening(array $p, string $id): array
    {
        foreach ($p['levels'] as $li => $level) {
            foreach ($level['openings'] as $oi => $o) {
                if ($o['id'] === $id) {
                    return [$li, $oi];
                }
            }
        }
        throw new \InvalidArgumentException(sprintf('no existe el vano «%s».', $id));
    }

    private function preset(string $preset): string
    {
        $preset = strtoupper(trim($preset));
        if (!isset(Hcca::openingPresets()[$preset])) {
            throw new \InvalidArgumentException(sprintf('tipo de vano desconocido; usá: %s.', implode(', ', array_keys(Hcca::openingPresets()))));
        }

        return $preset;
    }

    /** @param array<string, mixed> $p */
    private function nextId(array $p, string $prefix): string
    {
        $max = 0;
        foreach ($p['levels'] as $level) {
            foreach ([...$level['walls'], ...$level['openings']] as $e) {
                if (preg_match('/^'.$prefix.'(\d+)/', (string) $e['id'], $m)) {
                    $max = max($max, (int) $m[1]);
                }
            }
        }

        return $prefix.($max + 1);
    }

    private function u(float $meters): int
    {
        return (int) round($meters * 100 / Hcca::GRID_CM);
    }

    private function m(int $units): string
    {
        return rtrim(rtrim(number_format($units * Hcca::GRID_CM / 100, 2, ',', ''), '0'), ',');
    }
}
