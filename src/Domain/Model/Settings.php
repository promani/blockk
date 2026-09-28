<?php

declare(strict_types=1);

namespace App\Domain\Model;

use App\Domain\Hcca;

/** Preferencias del proyecto que afectan al cómputo y a la cotización. */
final readonly class Settings
{
    /** @param array<string, float> $prices */
    public function __construct(
        public float $defaultThicknessCm = 20.0,
        public int $reservePct = 3,
        public string $currency = 'USD',
        public array $prices = [],
    ) {
    }

    /** @return array<string, float> precios efectivos: los del usuario sobre los valores por defecto */
    public function effectivePrices(): array
    {
        return [...Hcca::defaultPrices(), ...$this->prices];
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'defaultT' => $this->defaultThicknessCm,
            'reservePct' => $this->reservePct,
            'currency' => $this->currency,
            'prices' => $this->effectivePrices(),
        ];
    }
}
