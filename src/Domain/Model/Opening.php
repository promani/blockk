<?php

declare(strict_types=1);

namespace App\Domain\Model;

/**
 * Vano (puerta o ventana) sobre un muro.
 * pos y w en unidades de 12,5 cm a lo largo del eje del muro; sill y h en hiladas (25 cm).
 */
final readonly class Opening
{
    public function __construct(
        public string $id,
        public string $wallId,
        public int $pos,
        public int $w,
        public int $sill,
        public int $h,
        public OpeningKind $kind,
        public string $preset = '',
        public bool $flip = false,
        public bool $hingeEnd = false,
        public string $mode = 'swing',
    ) {
    }

    public function withPlacement(string $wallId, int $pos): self
    {
        return new self($this->id, $wallId, $pos, $this->w, $this->sill, $this->h, $this->kind, $this->preset, $this->flip, $this->hingeEnd, $this->mode);
    }

    public function endU(): int
    {
        return $this->pos + $this->w;
    }

    /** Hilada inmediatamente superior al vano: allí va el dintel de bloque U. */
    public function lintelCourse(): int
    {
        return $this->sill + $this->h;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'wall' => $this->wallId,
            'pos' => $this->pos,
            'w' => $this->w,
            'sill' => $this->sill,
            'h' => $this->h,
            'kind' => $this->kind->value,
            'preset' => $this->preset,
            'flip' => $this->flip,
            'hingeEnd' => $this->hingeEnd,
            'mode' => $this->mode,
        ];
    }
}
