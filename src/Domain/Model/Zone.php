<?php

declare(strict_types=1);

namespace App\Domain\Model;

/**
 * Zona del terreno que no es parte de la casa pero condiciona cómo se usa el espacio (pileta, patio, jardín, camino):
 * un rectángulo (x, y, w, h en unidades de 12,5 cm) con su tipo y un nombre opcional. No entra al cómputo.
 */
final readonly class Zone
{
    public function __construct(
        public string $id,
        public int $x,
        public int $y,
        public int $w,
        public int $h,
        public string $kind = 'patio',
        public string $name = '',
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['id' => $this->id, 'x' => $this->x, 'y' => $this->y, 'w' => $this->w, 'h' => $this->h, 'kind' => $this->kind, 'name' => $this->name];
    }
}
