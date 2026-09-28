<?php

declare(strict_types=1);

namespace App\Domain\Model;

use App\Domain\Hcca;

/** Proyecto completo: dos niveles estructurales como máximo (PB + PA). */
final readonly class Project
{
    public const array LEVEL_NAMES = ['Nivel 1: Planta Baja', 'Nivel 2: Planta Alta'];
    public const array LEVEL_SHORT = ['Planta Baja', 'Planta Alta'];

    /**
     * @param list<Level> $levels siempre Hcca::MAX_LEVELS niveles (el 2.º puede estar vacío)
     * @param int         $north  hacia dónde apunta el norte en el plano: 0=N(arriba) 45=NE 90=E … (grados horarios)
     */
    public function __construct(
        public string $name,
        public array $levels,
        public Settings $settings = new Settings(),
        public int $north = 0,
        public float $latitude = -34.6,
        public int $lotW = 24,
        public int $lotD = 20,
    ) {
        if (count($levels) > Hcca::MAX_LEVELS) {
            throw new \InvalidArgumentException('La mampostería autoportante HCCA admite como máximo 2 niveles (PB + PA).');
        }
    }

    public function level(int $index): Level
    {
        return $this->levels[$index] ?? new Level();
    }

    public function withLevels(array $levels): self
    {
        return new self($this->name, $levels, $this->settings, $this->north, $this->latitude, $this->lotW, $this->lotD);
    }

    public function withLevel(int $index, Level $level): self
    {
        $levels = $this->levels;
        $levels[$index] = $level;

        return $this->withLevels($levels);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'v' => 1,
            'name' => $this->name,
            'north' => $this->north,
            'lat' => $this->latitude,
            'lot' => ['w' => $this->lotW, 'd' => $this->lotD],
            'settings' => $this->settings->toArray(),
            'levels' => array_map(static fn (Level $l): array => $l->toArray(), $this->levels),
        ];
    }
}
