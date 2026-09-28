<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

use App\Domain\Model\Level;

final readonly class NormalizationResult
{
    /** @param list<string> $notices avisos para el usuario (vanos descartados por intersecciones, etc.) */
    public function __construct(public Level $level, public array $notices = [])
    {
    }
}
