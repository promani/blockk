<?php

declare(strict_types=1);

namespace App\Domain\Model;

/**
 * Nombre de un ambiente: un punto (x, y, en unidades de 12,5 cm) dentro de él y el texto que se dibuja en la planta.
 * El nombre es libre; el tipo (Hcca::roomTypes) es opcional y, si falta, se deduce del nombre.
 */
final readonly class Label
{
    public function __construct(
        public string $id,
        public int $x,
        public int $y,
        public string $name,
        public string $type = '',
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        // sin tipo no se agrega la clave: los proyectos anteriores quedan iguales
        return ['id' => $this->id, 'x' => $this->x, 'y' => $this->y, 'name' => $this->name] + ('' === $this->type ? [] : ['type' => $this->type]);
    }
}
