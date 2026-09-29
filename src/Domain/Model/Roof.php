<?php

declare(strict_types=1);

namespace App\Domain\Model;

/**
 * Cubierta (el "nivel de techo"): se apoya sobre el nivel más alto con muros y su planta es la caja envolvente de esos muros.
 * dir: para dos aguas, eje de la cumbrera ('x' | 'y'); para un agua, hacia dónde cae el agua ('N' | 'S' | 'E' | 'W', norte = arriba del plano).
 */
final readonly class Roof
{
    public function __construct(
        public RoofType $type = RoofType::None,
        public string $dir = 'x',
        public int $slopePct = 30,
        public int $overhang = 40,
        public string $section = '3x8',
        public int $spacing = 50,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['type' => $this->type->value, 'dir' => $this->dir, 'slope' => $this->slopePct, 'overhang' => $this->overhang, 'section' => $this->section, 'spacing' => $this->spacing];
    }
}
