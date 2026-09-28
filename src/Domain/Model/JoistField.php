<?php

declare(strict_types=1);

namespace App\Domain\Model;

/**
 * Entrepiso: rectángulo a ejes de muros (x, y, w, h en unidades) con tirantes paralelos al eje $dir
 * separados como máximo $spacing cm entre ejes.
 */
final readonly class JoistField implements TimberElement
{
    public function __construct(
        public string $id,
        public int $x,
        public int $y,
        public int $w,
        public int $h,
        public Axis $dir,
        public string $section = '3x8',
        public int $spacing = 40,
    ) {
    }

    public function id(): string
    {
        return $this->id;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'kind' => 'joists',
            'x' => $this->x,
            'y' => $this->y,
            'w' => $this->w,
            'h' => $this->h,
            'dir' => $this->dir->value,
            'section' => $this->section,
            'spacing' => $this->spacing,
        ];
    }
}
