<?php

declare(strict_types=1);

namespace App\Domain\Timber;

/** Resultado del cálculo de la estructura de madera del entrepiso (todo en cm / m según el campo). */
final readonly class TimberPlan
{
    /**
     * @param list<array<string, mixed>> $fields  campos de tirantes con sus tirantes ya ubicados (cm)
     * @param list<array<string, mixed>> $beams   vigas individuales
     * @param list<array<string, mixed>> $issues  problemas de apoyo, luz y largos comerciales
     * @param array<string, mixed>       $bom     cantidades para el cómputo
     */
    public function __construct(
        public array $fields = [],
        public array $beams = [],
        public array $issues = [],
        public array $bom = [],
    ) {
    }

    public function isEmpty(): bool
    {
        return [] === $this->fields && [] === $this->beams;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['fields' => $this->fields, 'beams' => $this->beams, 'issues' => $this->issues, 'bom' => $this->bom];
    }
}
