<?php

declare(strict_types=1);

namespace App\Domain\Model;

use App\Domain\Hcca;

/**
 * Muro recto entre dos nodos de la retícula (unidades de 12,5 cm).
 * Invariante: x1 <= x2, y1 <= y2 y el muro tiene extensión en un solo eje.
 * El espesor $t está en ticks (0,5 mm): 15 cm = 300.
 * $h: alto en hiladas de 25 cm (12 = 3,00 m, el nivel completo). $crown: si la última hilada es de bloque U (encadenado);
 * null = automático (sí en muros portantes, no en tabiques).
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
        public int $h = Hcca::COURSES,
        public ?bool $crown = null,
    ) {
    }

    public function hasCrown(): bool
    {
        return $this->crown ?? $this->isLoadBearing();
    }

    /** ¿Tiene el mismo alto y la misma corona? (dos tramos colineales sólo se unen si coinciden). */
    public function sameSection(self $o): bool
    {
        return $this->t === $o->t && $this->h === $o->h && $this->hasCrown() === $o->hasCrown();
    }

    /** Construye un muro normalizando el sentido (de menor a mayor coordenada). */
    public static function between(string $id, int $xa, int $ya, int $xb, int $yb, int $t, int $h = Hcca::COURSES, ?bool $crown = null): self
    {
        return new self($id, min($xa, $xb), min($ya, $yb), max($xa, $xb), max($ya, $yb), $t, $h, $crown);
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
        return new self($id, $this->x1, $this->y1, $this->x2, $this->y2, $this->t, $this->h, $this->crown);
    }

    /** Recorta/desplaza el muro al rango [startU, endU] sobre su propio eje. */
    public function withRange(int $startU, int $endU): self
    {
        return Axis::X === $this->axis()
            ? new self($this->id, $startU, $this->y1, $endU, $this->y2, $this->t, $this->h, $this->crown)
            : new self($this->id, $this->x1, $startU, $this->x2, $endU, $this->t, $this->h, $this->crown);
    }

    public function withThickness(int $t): self
    {
        return new self($this->id, $this->x1, $this->y1, $this->x2, $this->y2, $t, $this->h, $this->crown);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return array_filter([
            'id' => $this->id,
            'x1' => $this->x1,
            'y1' => $this->y1,
            'x2' => $this->x2,
            'y2' => $this->y2,
            't' => Hcca::ticksToCm($this->t),
            'h' => $this->h,
            'crown' => $this->crown,
        ], static fn ($v): bool => null !== $v);
    }
}
