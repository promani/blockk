<?php

declare(strict_types=1);

namespace App\Domain\Roof;

final readonly class RoofPlan
{
    /**
     * @param array<string, mixed>       $geometry planos, hastiales, cabios y cumbrera (cm) para dibujar
     * @param list<array<string, mixed>> $issues
     * @param array<string, mixed>       $bom
     */
    public function __construct(public string $type = 'none', public array $geometry = [], public array $issues = [], public array $bom = [])
    {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['type' => $this->type, 'geometry' => $this->geometry, 'issues' => $this->issues, 'bom' => $this->bom];
    }
}
