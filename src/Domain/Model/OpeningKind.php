<?php

declare(strict_types=1);

namespace App\Domain\Model;

enum OpeningKind: string
{
    case Door = 'door';
    case Window = 'window';
    /** Portón (garaje, acceso de vehículos): estructuralmente una puerta de hasta 3 m. */
    case Gate = 'gate';

    /** Formas de abrir que admite cada tipo; la primera es la habitual. @return list<string> */
    public function modes(): array
    {
        return match ($this) {
            self::Door => ['swing', 'slide'],
            self::Window => ['swing', 'slide', 'fixed'],
            self::Gate => ['overhead', 'slide'],
        };
    }
}
