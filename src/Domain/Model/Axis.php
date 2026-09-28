<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Orientación del eje de un muro (siempre ortogonal: a 90°). */
enum Axis: string
{
    case X = 'x';
    case Y = 'y';

    public function perpendicular(): self
    {
        return self::X === $this ? self::Y : self::X;
    }
}
