<?php

declare(strict_types=1);

namespace App\Domain\Model;

/**
 * Un faldón o techo rectangular que apoya sobre los muros de un nivel (level 0 = sobre la Planta Baja, 1 = sobre la Planta Alta).
 * Se dibuja como una habitación: rectángulo a ejes de muros (x, y, w, h en unidades de 12,5 cm) al que se le configura tipo y pendiente.
 * dir: a dos aguas = eje de la cumbrera ('x' | 'y'); a un agua = lado hacia el que cae ('N' | 'S' | 'E' | 'W').
 * gableA / gableB: hastiales de bloque en los extremos (se pueden quitar); gableT: espesor de esos muros en cm.
 * windows: ventanas en los hastiales: lado ('A' | 'B' | 'H', el muro alto de un techo a un agua), pos (inicio, en unidades
 * de 12,5 cm sobre el eje del hastial, absoluto), w (ancho, unidades), sill (hiladas sobre el arranque del hastial), h (hiladas).
 */
final readonly class RoofPart
{
    public const array GABLE_THICKNESSES = [10, 15, 20];
    public const int MAX_WINDOWS = 8;

    public function __construct(
        public string $id,
        public int $level,
        public int $x,
        public int $y,
        public int $w,
        public int $h,
        public RoofType $type = RoofType::Gable,
        public string $dir = 'x',
        public int $slopePct = 30,
        public int $overhang = 40,
        public string $section = '3x8',
        public int $spacing = 50,
        public bool $gableA = true,
        public bool $gableB = true,
        public int $gableT = 20,
        /** @var list<array{id: string, side: string, pos: int, w: int, sill: int, h: int}> */
        public array $windows = [],
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'level' => $this->level,
            'x' => $this->x,
            'y' => $this->y,
            'w' => $this->w,
            'h' => $this->h,
            'type' => $this->type->value,
            'dir' => $this->dir,
            'slope' => $this->slopePct,
            'overhang' => $this->overhang,
            'section' => $this->section,
            'spacing' => $this->spacing,
            'gableA' => $this->gableA,
            'gableB' => $this->gableB,
            'gableT' => $this->gableT,
            'windows' => $this->windows,
        ];
    }
}
