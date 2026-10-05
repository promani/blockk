<?php

declare(strict_types=1);

namespace App\Domain\Templates;

use App\Domain\Hcca;

/**
 * Constructor fluido de proyectos-plantilla en unidades de 12,5 cm. Los vanos se ubican por geometría
 * (eje, línea y posición inicial) y se enlazan al muro que los contiene, de modo que la normalización
 * posterior (división en T, fusión) los reubique sin que la plantilla dependa de ids internos.
 */
final class TemplateBuilder
{
    /** @var array<int, array{walls: list<array<string, mixed>>, openings: list<array<string, mixed>>, slabs: list<array<string, mixed>>}> */
    private array $levels = [
        0 => ['walls' => [], 'openings' => [], 'slabs' => [], 'stairs' => [], 'columns' => [], 'labels' => []],
        1 => ['walls' => [], 'openings' => [], 'slabs' => [], 'stairs' => [], 'columns' => [], 'labels' => []],
    ];
    /** @var array<string, mixed> */
    private array $roof = ['type' => 'none'];
    /** @var list<array<string, mixed>>|null */
    private ?array $roofs = null;
    private bool $upper = false;
    private int $seq = 0;
    /** @var list<array<string, mixed>> */
    private array $zones = [];
    /** @var list<array<string, mixed>> */
    private array $trees = [];
    private int $dx = 0;
    private int $dy = 0;

    public function __construct(private readonly string $name, private readonly int $north = 0, private readonly float $latitude = -34.6)
    {
    }

    /** Corre todo lo que se dibuje de acá en adelante (en unidades): sirve para dejar lugar al norte o al oeste sin renumerar. */
    public function shift(int $dx, int $dy): self
    {
        [$this->dx, $this->dy] = [$dx, $dy];

        return $this;
    }

    public function room(int $level, int $x, int $y, int $w, int $h, float $t = 20.0): self
    {
        return $this->wall($level, $x, $y, $x + $w, $y, $t)
            ->wall($level, $x + $w, $y, $x + $w, $y + $h, $t)
            ->wall($level, $x + $w, $y + $h, $x, $y + $h, $t)
            ->wall($level, $x, $y + $h, $x, $y, $t);
    }

    public function wall(int $level, int $x1, int $y1, int $x2, int $y2, float $t): self
    {
        $this->levels[$level]['walls'][] = ['id' => 'w'.(++$this->seq), 'x1' => $x1 + $this->dx, 'y1' => $y1 + $this->dy, 'x2' => $x2 + $this->dx, 'y2' => $y2 + $this->dy, 't' => $t];

        return $this;
    }

    /**
     * @param string $axis 'x' (muro horizontal en y=$line) o 'y' (muro vertical en x=$line); $start = coordenada inicial del vano
     * @param bool   $flip la puerta abre hacia el lado negativo (arriba o a la izquierda) en vez del positivo (abajo o a la derecha)
     * @param bool   $hingeEnd la bisagra va en el extremo final del vano (derecha o abajo) en vez del inicial
     * @param string $mode forma de abrir: `swing`, `slide`, `open` (arcada, sin hoja), `fixed` u `overhead`; vacío, la habitual del tipo
     */
    public function opening(int $level, string $preset, string $axis, int $line, int $start, bool $flip = false, bool $hingeEnd = false, string $mode = ''): self
    {
        $spec = Hcca::openingPresets()[$preset] ?? throw new \InvalidArgumentException("Preset desconocido: $preset");
        [$line, $start] = 'x' === $axis ? [$line + $this->dy, $start + $this->dx] : [$line + $this->dx, $start + $this->dy];
        foreach ($this->levels[$level]['walls'] as $w) {
            $horizontal = $w['y1'] === $w['y2'];
            if (($horizontal ? 'x' : 'y') !== $axis || ($horizontal ? $w['y1'] : $w['x1']) !== $line) {
                continue;
            }
            $from = min($horizontal ? [$w['x1'], $w['x2']] : [$w['y1'], $w['y2']]);
            $to = max($horizontal ? [$w['x1'], $w['x2']] : [$w['y1'], $w['y2']]);
            if ($start >= $from && $start + $spec['w'] <= $to) {
                $this->levels[$level]['openings'][] = ['id' => 'o'.(++$this->seq), 'wall' => $w['id'], 'pos' => $start - $from, 'preset' => $preset] + ($flip ? ['flip' => true] : []) + ($hingeEnd ? ['hingeEnd' => true] : []) + ('' !== $mode ? ['mode' => $mode] : []);

                return $this;
            }
        }
        throw new \LogicException("No hay muro para el vano $preset en $axis=$line desde $start");
    }

    /** Techo: $type 'gable' | 'shed'; $dir eje de la cumbrera ('x'|'y') o hacia dónde cae el agua ('N'|'S'|'E'|'W'). */
    /** Techo rectangular sobre el nivel `$level` (x, y, w, h en unidades de 12,5 cm). */
    public function roofPart(int $level, int $x, int $y, int $w, int $h, string $type = 'gable', string $dir = 'x', int $slope = 30, string $section = '3x8', int $extra = 0, array $more = []): self
    {
        $this->roofs ??= [];
        $this->roofs[] = ['id' => 'r'.(++$this->seq), 'level' => $level, 'x' => $x + $this->dx, 'y' => $y + $this->dy, 'w' => $w, 'h' => $h, 'type' => $type, 'dir' => $dir, 'slope' => $slope, 'section' => $section, 'overhang' => 40, 'spacing' => 50] + $more;

        return $this;
    }

    public function roof(string $type, string $dir = 'x', int $slope = 30, string $section = '3x8', int $spacing = 50): self
    {
        $this->roof = ['type' => $type, 'dir' => $dir, 'slope' => $slope, 'section' => $section, 'spacing' => $spacing, 'overhang' => 40];

        return $this;
    }

    public function slab(int $level, int $x, int $y, int $w, int $h): self
    {
        $this->levels[$level]['slabs'][] = ['id' => 'l'.(++$this->seq), 'x' => $x + $this->dx, 'y' => $y + $this->dy, 'w' => $w, 'h' => $h, 'thickness' => 12];

        return $this;
    }

    public function stair(int $level, int $x, int $y, string $dir = 'N', string $shape = 'straight', int $w = 8): self
    {
        $this->levels[$level]['stairs'][] = ['id' => 's'.(++$this->seq), 'x' => $x + $this->dx, 'y' => $y + $this->dy, 'dir' => $dir, 'shape' => $shape, 'w' => $w, 'tread' => 28, 'turn' => 'right'];

        return $this;
    }

    /** Pilar de hormigón de `$size` cm de lado, centrado en el nodo (x, y) de la retícula. */
    public function column(int $level, int $x, int $y, int $size = 20): self
    {
        $this->levels[$level]['columns'][] = ['id' => 'c'.(++$this->seq), 'x' => $x + $this->dx, 'y' => $y + $this->dy, 'size' => $size];

        return $this;
    }

    /** Nombre de un ambiente: se dibuja en la planta sobre la celda que empieza en (x, y). */
    public function label(int $level, int $x, int $y, string $name, string $type = ''): self
    {
        $this->levels[$level]['labels'][] = ['id' => 'n'.(++$this->seq), 'x' => $x + $this->dx, 'y' => $y + $this->dy, 'name' => $name] + ('' === $type ? [] : ['type' => $type]);

        return $this;
    }

    /** Zona del terreno (pileta, patio, jardín, camino): rectángulo de `$w` × `$h` unidades desde (x, y). */
    public function zone(int $x, int $y, int $w, int $h, string $kind = 'patio', string $name = ''): self
    {
        $this->zones[] = ['id' => 'z'.(++$this->seq), 'x' => $x + $this->dx, 'y' => $y + $this->dy, 'w' => $w, 'h' => $h, 'kind' => $kind, 'name' => $name];

        return $this;
    }

    /** Árbol simple de tamaño S, M o L en el nodo (x, y). */
    public function tree(int $x, int $y, string $size = 'M'): self
    {
        $this->trees[] = ['id' => 'a'.(++$this->seq), 'x' => $x + $this->dx, 'y' => $y + $this->dy, 'size' => $size];

        return $this;
    }

    public function upper(): self
    {
        $this->upper = true;

        return $this;
    }

    /** @return array<string, mixed> */
    public function build(): array
    {
        return [
            'v' => 1,
            'name' => $this->name,
            'north' => $this->north,
            'lat' => $this->latitude,
            'lot' => ['w' => 24, 'd' => 20],
            'settings' => ['defaultT' => 20, 'reservePct' => 3, 'currency' => 'USD'],
            'upper' => $this->upper,
            ...([] === $this->zones ? [] : ['zones' => $this->zones]),
            ...([] === $this->trees ? [] : ['trees' => $this->trees]),
            ...(null === $this->roofs ? ['roof' => $this->roof] : ['roofs' => $this->roofs]),
            // sin pilares ni nombres no se agregan las claves: así las plantillas viejas conservan su hash
            'levels' => array_map(static fn (array $l): array => array_filter($l, static fn (mixed $v, string $k): bool => !in_array($k, ['columns', 'labels'], true) || [] !== $v, ARRAY_FILTER_USE_BOTH), [$this->levels[0], $this->levels[1]]),
        ];
    }
}
