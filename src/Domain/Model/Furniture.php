<?php

declare(strict_types=1);

namespace App\Domain\Model;

/**
 * Mueble simple (un gabarito de tamaño real para ver si el ambiente alcanza): tipo del catálogo `Hcca::furniture()`,
 * esquina superior izquierda de su huella ya girada (x, y en unidades de 12,5 cm) y giro en pasos de 90°.
 * No entra al cómputo ni a la Revisión.
 */
final readonly class Furniture
{
    public function __construct(
        public string $id,
        public string $kind,
        public int $x,
        public int $y,
        public int $rot = 0,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['id' => $this->id, 'kind' => $this->kind, 'x' => $this->x, 'y' => $this->y, 'rot' => $this->rot];
    }
}
