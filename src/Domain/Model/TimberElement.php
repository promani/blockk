<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Elemento de la estructura de entrepiso en madera (campo de tirantes o viga individual). */
interface TimberElement
{
    public function id(): string;

    /** @return array<string, mixed> */
    public function toArray(): array;
}
