<?php

declare(strict_types=1);

namespace App\Domain\Model;

use App\Domain\Hcca;

/**
 * Muro recto entre dos nodos de la retícula (unidades de 12,5 cm).
 * Invariante: x1 <= x2, y1 <= y2 y el muro tiene extensión en un solo eje.
 * El espesor $t está en ticks (0,5 mm): 15 cm = 300.
 */
final readonly class Wall
{
    public function __construct(
        public string $id,
        public int $x1,
        public int $y1,
        public int $x2,
        public int $y2,
        public int $t,
    ) {
    }

    /** Construye un muro normalizando el sentido (de menor a mayor coordenada). */
    public static function between(string $id, int $xa, int $ya, int $xb, int $yb, int $t): self
    {
        return new self($id, min($xa, $xb), min($ya, $yb), max($xa, $xb), max($ya, $yb), $t);
    }

    public function isValid(): bool
    {
        $dx = $this->x2 - $this->x1;
        $dy = $this->y2 - $this->y1;

        return $this->x1 <= $this->x2 && $this->y1 <= $this->y2 && (($dx > 0) xor ($dy > 0));
    }

    public function axis(): Axis
    {
        return $this->y1 === $this->y2 ? Axis::X : Axis::Y;
    }

    /** Coordenada (unidades) del extremo inicial sobre el eje del muro. */
    public function startU(): int
    {
        return Axis::X === $this->axis() ? $this->x1 : $this->y1;
    }

    public function endU(): int
    {
        return Axis::X === $this->axis() ? $this->x2 : $this->y2;
    }

    /** Coordenada fija (unidades) de la línea que contiene al eje. */
    public function lineU(): int
    {
        return Axis::X === $this->axis() ? $this->y1 : $this->x1;
    }

    public function lengthU(): int
    {
        return $this->endU() - $this->startU();
    }

    public function lengthTicks(): int
    {
        return $this->lengthU() * Hcca::GRID;
    }

    public function isLoadBearing(): bool
    {
        return $this->t >= Hcca::LOAD_BEARING_MIN_T;
    }

    public function withId(string $id): self
    {
        return new self($id, $this->x1, $this->y1, $this->x2, $this->y2, $this->t);
    }

    /** Recorta/desplaza el muro al rango [startU, endU] sobre su propio eje. */
    public function withRange(int $startU, int $endU): self
    {
        return Axis::X === $this->axis()
            ? new self($this->id, $startU, $this->y1, $endU, $this->y2, $this->t)
            : new self($this->id, $this->x1, $startU, $this->x2, $endU, $this->t);
    }

    public function withThickness(int $t): self
    {
        return new self($this->id, $this->x1, $this->y1, $this->x2, $this->y2, $t);
    }

    /** @return array{id: string, x1: int, y1: int, x2: int, y2: int, t: float} */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'x1' => $this->x1,
            'y1' => $this->y1,
            'x2' => $this->x2,
            'y2' => $this->y2,
            't' => Hcca::ticksToCm($this->t),
        ];
    }
}
