<?php

declare(strict_types=1);

namespace App\Domain\Model;

enum RoofType: string
{
    case None = 'none';
    /** A dos aguas: cumbrera central y dos faldones. */
    case Gable = 'gable';
    /** A un agua: un solo faldón inclinado. */
    case Shed = 'shed';
}
