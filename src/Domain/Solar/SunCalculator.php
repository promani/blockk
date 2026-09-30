<?php

declare(strict_types=1);

namespace App\Domain\Solar;

/**
 * Posición solar aproximada (declinación de Cooper + ángulo horario, hora solar aparente).
 * Suficiente para anteproyecto de asoleamiento; no es una efeméride de precisión.
 */
final class SunCalculator
{
    /** @return array{alt: float, az: float} altura sobre el horizonte y acimut desde el Norte, en grados */
    public function position(float $latitude, int $dayOfYear, float $solarHour): array
    {
        $phi = deg2rad($latitude);
        $delta = deg2rad(23.45 * sin(deg2rad(360 / 365 * (284 + $dayOfYear))));
        $hourAngle = deg2rad(15 * ($solarHour - 12));

        $sinAlt = sin($phi) * sin($delta) + cos($phi) * cos($delta) * cos($hourAngle);
        $east = -cos($delta) * sin($hourAngle);
        $north = sin($delta) * cos($phi) - cos($delta) * cos($hourAngle) * sin($phi);
        $az = rad2deg(atan2($east, $north));

        return [
            'alt' => round(rad2deg(asin(max(-1.0, min(1.0, $sinAlt)))), 2),
            'az' => round(fmod($az + 360.0, 360.0), 2),
        ];
    }

    /**
     * Trayectoria del día de 05:00 a 21:00 cada 15 minutos (el cliente interpola sobre esta tabla). Sin longitud, `h` es
     * hora solar (el sol pasa por el meridiano a las 12); con longitud y huso, `h` es la hora oficial del reloj.
     *
     * @return list<array{h: float, alt: float, az: float}>
     */
    public function path(float $latitude, Season $season, ?float $longitude = null, float $utcOffset = 0.0): array
    {
        $doy = $season->dayOfYear($latitude);
        $shift = null === $longitude ? 0.0 : 12.0 - $this->solarNoon($doy, $longitude, $utcOffset);
        $path = [];
        for ($m = 5 * 60; $m <= 21 * 60; $m += 15) {
            $h = $m / 60.0;
            $path[] = ['h' => $h, ...$this->position($latitude, $doy, $h + $shift)];
        }

        return $path;
    }

    /** Hora oficial del mediodía solar: corrección por longitud respecto del meridiano del huso y ecuación del tiempo. */
    public function solarNoon(int $dayOfYear, float $longitude, float $utcOffset): float
    {
        $b = deg2rad(360 / 365 * ($dayOfYear - 81));
        $eot = 9.87 * sin(2 * $b) - 7.53 * cos($b) - 1.5 * sin($b); // minutos

        return 12.0 - ($longitude - 15.0 * $utcOffset) / 15.0 - $eot / 60.0;
    }
}
