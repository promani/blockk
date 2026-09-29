<?php

declare(strict_types=1);

namespace App\Domain\Floor;

final readonly class SlabPlan
{
    /**
     * @param list<array<string, mixed>> $slabs  cada losa con sus partes (rectángulos en cm sin los huecos de escalera)
     * @param list<array<string, mixed>> $issues
     * @param array<string, mixed>       $bom
     */
    public function __construct(public array $slabs = [], public array $issues = [], public array $bom = [])
    {
    }
}
