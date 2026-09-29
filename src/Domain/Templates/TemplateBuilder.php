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
    /** @var array<int, array{walls: list<array<string, mixed>>, openings: list<array<string, mixed>>, timber: list<array<string, mixed>>}> */
    private array $levels = [
        0 => ['walls' => [], 'openings' => [], 'timber' => [], 'slabs' => [], 'stairs' => []],
        1 => ['walls' => [], 'openings' => [], 'timber' => [], 'slabs' => [], 'stairs' => []],
    ];
    /** @var array<string, mixed> */
    private array $roof = ['type' => 'none'];
    /** @var list<array<string, mixed>>|null */
    private ?array $roofs = null;
    private bool $upper = false;
    private int $seq = 0;

    public function __construct(private readonly string $name, private readonly int $north = 0, private readonly float $latitude = -34.6)
    {
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
        $this->levels[$level]['walls'][] = ['id' => 'w'.(++$this->seq), 'x1' => $x1, 'y1' => $y1, 'x2' => $x2, 'y2' => $y2, 't' => $t];

        return $this;
    }

    /** @param string $axis 'x' (muro horizontal en y=$line) o 'y' (muro vertical en x=$line); $start = coordenada inicial del vano */
    public function opening(int $level, string $preset, string $axis, int $line, int $start): self
    {
        $spec = Hcca::openingPresets()[$preset] ?? throw new \InvalidArgumentException("Preset desconocido: $preset");
        foreach ($this->levels[$level]['walls'] as $w) {
            $horizontal = $w['y1'] === $w['y2'];
            if (($horizontal ? 'x' : 'y') !== $axis || ($horizontal ? $w['y1'] : $w['x1']) !== $line) {
                continue;
            }
            $from = min($horizontal ? [$w['x1'], $w['x2']] : [$w['y1'], $w['y2']]);
            $to = max($horizontal ? [$w['x1'], $w['x2']] : [$w['y1'], $w['y2']]);
            if ($start >= $from && $start + $spec['w'] <= $to) {
                $this->levels[$level]['openings'][] = ['id' => 'o'.(++$this->seq), 'wall' => $w['id'], 'pos' => $start - $from, 'preset' => $preset];

                return $this;
            }
        }
        throw new \LogicException("No hay muro para el vano $preset en $axis=$line desde $start");
    }

    public function joists(int $x, int $y, int $w, int $h, string $dir, string $section = '3x8'): self
    {
        $this->levels[0]['timber'][] = ['id' => 't'.(++$this->seq), 'kind' => 'joists', 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h, 'dir' => $dir, 'section' => $section, 'spacing' => 40];

        return $this;
    }

    /** Techo: $type 'gable' | 'shed'; $dir eje de la cumbrera ('x'|'y') o hacia dónde cae el agua ('N'|'S'|'E'|'W'). */
    /** Techo rectangular sobre el nivel `$level` (x, y, w, h en unidades de 12,5 cm). */
    public function roofPart(int $level, int $x, int $y, int $w, int $h, string $type = 'gable', string $dir = 'x', int $slope = 30, string $section = '3x8', int $extra = 0, array $more = []): self
    {
        $this->roofs ??= [];
        $this->roofs[] = ['id' => 'r'.(++$this->seq), 'level' => $level, 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h, 'type' => $type, 'dir' => $dir, 'slope' => $slope, 'section' => $section, 'overhang' => 40, 'spacing' => 50] + $more;

        return $this;
    }

    public function roof(string $type, string $dir = 'x', int $slope = 30, string $section = '3x8', int $spacing = 50): self
    {
        $this->roof = ['type' => $type, 'dir' => $dir, 'slope' => $slope, 'section' => $section, 'spacing' => $spacing, 'overhang' => 40];

        return $this;
    }

    public function slab(int $level, int $x, int $y, int $w, int $h): self
    {
        $this->levels[$level]['slabs'][] = ['id' => 'l'.(++$this->seq), 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h, 'thickness' => 12];

        return $this;
    }

    public function stair(int $level, int $x, int $y, string $dir = 'N', string $shape = 'straight', int $w = 8): self
    {
        $this->levels[$level]['stairs'][] = ['id' => 's'.(++$this->seq), 'x' => $x, 'y' => $y, 'dir' => $dir, 'shape' => $shape, 'w' => $w, 'tread' => 28, 'turn' => 'right'];

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
            ...(null === $this->roofs ? ['roof' => $this->roof] : ['roofs' => $this->roofs]),
            'levels' => [$this->levels[0], $this->levels[1]],
        ];
    }
}
