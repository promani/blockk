<?php

declare(strict_types=1);

namespace App\Domain\Model;

use App\Domain\Hcca;

/** Proyecto completo: dos niveles estructurales como máximo (PB + PA). */
final readonly class Project
{
    public const array LEVEL_NAMES = ['Nivel 1: Planta Baja', 'Nivel 2: Planta Alta', 'Techo'];
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
        public bool $upper = false,
        /** @var list<RoofPart> */
        public array $roofs = [],
        /** longitud (°, oeste negativa) y huso horario (horas respecto de UTC): pasan la hora oficial a hora solar */
        public float $longitude = -58.4,
        public float $utcOffset = -3.0,
        /** @var list<Zone> pileta, patio, jardín…: no son de la casa, hacen a la disposición del terreno */
        public array $zones = [],
        /** @var list<Tree> */
        public array $trees = [],
        /** lado del terreno que da a la calle, como lado de la planta: N arriba, E derecha, S abajo, W izquierda */
        public string $lotFront = 'S',
    ) {
        if (count($levels) > Hcca::MAX_LEVELS) {
            throw new \InvalidArgumentException('La mampostería autoportante HCCA admite como máximo 2 niveles (PB + PA).');
        }
    }

    public function level(int $index): Level
    {
        return $this->levels[$index] ?? new Level();
    }

    /** Cota (cm) del piso de un nivel: la suma de los altos de los niveles de abajo. Con 2 niveles, la del techo. */
    public function levelBaseCm(int $index): int
    {
        $z = 0;
        for ($i = 0; $i < $index; ++$i) {
            $z += $this->level($i)->heightCm();
        }

        return $z;
    }

    /** Cota (cm) de la cara superior de un nivel (donde apoya lo que va arriba). */
    public function levelTopCm(int $index): int
    {
        return $this->levelBaseCm($index) + $this->level($index)->heightCm();
    }

    /** ¿Existe el Nivel 2? Es opcional: la casa empieza con un nivel y el techo. */
    public function upperEnabled(): bool
    {
        return $this->upper || !$this->level(1)->isEmpty();
    }

    /** Índice del nivel más alto con muros (donde apoya el techo), o -1. */
    public function topLevelIndex(): int
    {
        return match (true) {
            !$this->level(1)->isEmpty() => 1,
            !$this->level(0)->isEmpty() => 0,
            default => -1,
        };
    }

    /** @param list<Level> $levels */
    public function withLevels(array $levels): self
    {
        return new self($this->name, $levels, $this->settings, $this->north, $this->latitude, $this->lotW, $this->lotD, $this->upper, $this->roofs, $this->longitude, $this->utcOffset, $this->zones, $this->trees, $this->lotFront);
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
            'lon' => $this->longitude,
            'tz' => $this->utcOffset,
            'lot' => ['w' => $this->lotW, 'd' => $this->lotD, 'front' => $this->lotFront],
            'upper' => $this->upperEnabled(),
            'roofs' => array_map(static fn (RoofPart $r): array => $r->toArray(), $this->roofs),
            'zones' => array_map(static fn (Zone $z): array => $z->toArray(), $this->zones),
            'trees' => array_map(static fn (Tree $t): array => $t->toArray(), $this->trees),
            'settings' => $this->settings->toArray(),
            'levels' => array_map(static fn (Level $l): array => $l->toArray(), $this->levels),
        ];
    }
}
