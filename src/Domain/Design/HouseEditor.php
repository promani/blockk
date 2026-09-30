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
    public const array ACTIONS = ['agregar_vano', 'quitar_vano', 'cambiar_vano', 'agregar_muro', 'quitar_muro', 'cambiar_techo', 'renombrar'];

    /**
     * @param array<string, mixed>             $project
     * @param list<array<string, mixed>>       $operations
     *
     * @return array<string, mixed> el proyecto modificado
     *
     * @throws \InvalidArgumentException si una operación no se puede aplicar (indica cuál y por qué)
     */
    public function apply(array $project, array $operations): array
    {
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
                if (!in_array((float) $t, Hcca::THICKNESSES_CM, true)) {
                    throw new \InvalidArgumentException('espesor inválido (7,5, 10, 15 o 20 cm).');
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
                foreach ($p['roofs'] as $k => $r) {
                    $r['type'] = 'un_agua' === $type ? 'shed' : 'gable';
                    $r['dir'] = 'un_agua' === $type ? 'S' : ($r['w'] >= $r['h'] ? 'x' : 'y');
                    if (isset($op['pendiente']) && is_numeric($op['pendiente'])) {
                        $r['slope'] = max(10, min(60, (int) $op['pendiente']));
                    }
                    // cabio más chico que alcanza: a dos aguas cubre media luz; a un agua, toda
                    $span = 'un_agua' === $type ? $r['h'] : ('x' === $r['dir'] ? $r['h'] : $r['w']) / 2;
                    $r['section'] = HouseGenerator::section($span);
                    $r['spacing'] = 50;
                    $p['roofs'][$k] = $r;
                }

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
