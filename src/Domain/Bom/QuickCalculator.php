<?php

declare(strict_types=1);

namespace App\Domain\Bom;

use App\Domain\Hcca;

/** Calculadora rápida de paño (catálogo técnico): bloques, volumen, pallets y mortero para un muro recto. */
final class QuickCalculator
{
    private const float FACE_M2 = 0.625 * 0.25;

    /** @return array<string, mixed> */
    public function panel(float $lengthM, float $heightM, float $thicknessCm, float $openingsM2 = 0.0, int $wastePct = 5): array
    {
        if (!in_array($thicknessCm, Hcca::THICKNESSES_CM, true)) {
            throw new \InvalidArgumentException('Espesor no disponible: use 7,5 / 10 / 15 / 20 cm.');
        }
        if ($lengthM <= 0 || $lengthM > 200 || $heightM <= 0 || $heightM > 12 || $openingsM2 < 0 || $wastePct < 0 || $wastePct > 30) {
            throw new \InvalidArgumentException('Medidas fuera de rango.');
        }
        $gross = $lengthM * $heightM;
        if ($openingsM2 >= $gross) {
            throw new \InvalidArgumentException('Los vanos no pueden ocupar toda la superficie del paño.');
        }
        $area = $gross - $openingsM2;
        $t = Hcca::cmToTicks($thicknessCm);
        $blocks = (int) ceil($area / self::FACE_M2 * (1 + $wastePct / 100));
        $capacity = Hcca::palletCapacity('B', $t);
        $adhesiveKg = $area * Hcca::adhesiveRate($t);

        return [
            'areaM2' => round($area, 2),
            'blocks' => $blocks,
            'volumeM3' => round($blocks * self::FACE_M2 * $thicknessCm / 100, 2),
            'courses' => (int) ceil($heightM / 0.25),
            'blocksPerCourse' => round($lengthM / 0.625, 2),
            'pallets' => ['capacity' => $capacity, 'full' => intdiv($blocks, $capacity), 'loose' => $blocks % $capacity, 'total' => (int) ceil($blocks / $capacity)],
            'adhesiveKg' => round($adhesiveKg, 1),
            'adhesiveBags' => (int) ceil($adhesiveKg / Hcca::BAG_KG),
            'wastePct' => $wastePct,
        ];
    }
}
