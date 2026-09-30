<?php

declare(strict_types=1);

namespace App\Domain\Bom;

use App\Domain\Hcca;

/** Calculadora rápida de paño (catálogo técnico): bloques, volumen, pallets y mortero para un muro recto. */
final class QuickCalculator
{
    /** @return array<string, mixed> */
    public function panel(float $lengthM, float $heightM, float $thicknessCm, float $openingsM2 = 0.0, int $wastePct = 5): array
    {
        if (!in_array($thicknessCm, Hcca::thicknesses(), true)) {
            throw new \InvalidArgumentException(sprintf('Espesor no disponible: use %s cm.', implode(' / ', array_map(static fn (float $x): string => str_replace('.', ',', (string) $x), Hcca::thicknesses()))));
        }
        if ($lengthM <= 0 || $lengthM > 200 || $heightM <= 0 || $heightM > 12 || $openingsM2 < 0 || $wastePct < 0 || $wastePct > 30) {
            throw new \InvalidArgumentException('Medidas fuera de rango.');
        }
        $blockM = Hcca::blockLCm() / 100;
        $face = $blockM * 0.25;
        $gross = $lengthM * $heightM;
        if ($openingsM2 >= $gross) {
            throw new \InvalidArgumentException('Los vanos no pueden ocupar toda la superficie del paño.');
        }
        $area = $gross - $openingsM2;
        $t = Hcca::cmToTicks($thicknessCm);
        $blocks = (int) ceil($area / $face * (1 + $wastePct / 100));
        $capacity = Hcca::palletCapacity('B', $t);
        $adhesiveKg = $area * Hcca::adhesiveRate($t);

        return [
            'areaM2' => round($area, 2),
            'blocks' => $blocks,
            'volumeM3' => round($blocks * $face * $thicknessCm / 100, 2),
            'courses' => (int) ceil($heightM / 0.25),
            'blocksPerCourse' => round($lengthM / $blockM, 2),
            'pallets' => ['capacity' => $capacity, 'full' => intdiv($blocks, $capacity), 'loose' => $blocks % $capacity, 'total' => (int) ceil($blocks / $capacity)],
            'adhesiveKg' => round($adhesiveKg, 1),
            'adhesiveBags' => (int) ceil($adhesiveKg / Hcca::BAG_KG),
            'wastePct' => $wastePct,
        ];
    }
}
