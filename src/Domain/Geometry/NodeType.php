<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

enum NodeType: string
{
    /** Extremo libre de un muro. */
    case Free = 'free';
    /** Dos muros colineales que se continúan. */
    case Straight = 'straight';
    /** Esquina a 90° entre dos muros. */
    case Corner = 'corner';
    /** Encuentro en T: un muro pasante y uno que llega. */
    case Tee = 'tee';
    /** Cruce de cuatro brazos. */
    case Cross = 'cross';
}
