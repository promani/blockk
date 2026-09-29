<?php

declare(strict_types=1);

namespace App\Domain\Floor;

final readonly class StairPlan
{
    /**
     * @param list<array<string, mixed>>                        $stairs con peldaños y descansos ya ubicados (cm)
     * @param list<array{float, float, float, float}>           $holes  huecos que dejan en el piso superior (cm)
     * @param list<array<string, mixed>>                        $issues
     * @param array<string, mixed>                              $bom
     */
    public function __construct(public array $stairs = [], public array $holes = [], public array $issues = [], public array $bom = [])
    {
    }
}
