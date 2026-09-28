<?php

declare(strict_types=1);

namespace App\Domain\Solar;

/**
 * Irradiación directa relativa sobre una cara vertical: Σ max(0, cos(altura) · (n · s)) por hora,
 * con n la normal saliente de la fachada y s la dirección horizontal hacia el sol.
 */
final class ExposureAnalyzer
{
    public function __construct(private readonly SunCalculator $sun = new SunCalculator())
    {
    }

    /**
     * @param array{int, int} $normal normal saliente en coordenadas de plano (x → derecha, y → abajo)
     * @param int             $north  grados horarios desde "arriba" hacia donde apunta el norte en el plano
     */
    public function faceScore(array $normal, int $north, float $latitude, Season $season, float $fromHour, float $toHour): float
    {
        $theta = deg2rad($north);
        // Vectores unitarios del plano: norte = (sin θ, −cos θ); este = (cos θ, sin θ).
        $east = $normal[0] * cos($theta) + $normal[1] * sin($theta);
        $northComponent = $normal[0] * sin($theta) - $normal[1] * cos($theta);
        $doy = $season->dayOfYear($latitude);
        $score = 0.0;
        for ($h = $fromHour; $h <= $toHour; $h += 0.5) {
            $p = $this->sun->position($latitude, $doy, $h);
            if ($p['alt'] <= 2.0) {
                continue;
            }
            $az = deg2rad($p['az']);
            $facing = $east * sin($az) + $northComponent * cos($az);
            $score += max(0.0, cos(deg2rad($p['alt'])) * $facing) * 0.5;
        }

        return $score;
    }

    /** Ganancia de invierno (mañana a tarde). */
    public function winterGain(array $normal, int $north, float $latitude): float
    {
        return $this->faceScore($normal, $north, $latitude, Season::Winter, 8, 16);
    }

    /** Sobrecalentamiento de verano (tarde). */
    public function summerLoad(array $normal, int $north, float $latitude): float
    {
        return $this->faceScore($normal, $north, $latitude, Season::Summer, 12, 19);
    }

    /** Nombre cardinal de la fachada (N, NE, E, …) según hacia dónde mira respecto del norte. */
    public function facing(array $normal, int $north): string
    {
        $theta = deg2rad($north);
        $east = $normal[0] * cos($theta) + $normal[1] * sin($theta);
        $northComponent = $normal[0] * sin($theta) - $normal[1] * cos($theta);
        $bearing = fmod(rad2deg(atan2($east, $northComponent)) + 360.0, 360.0);
        $names = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

        return $names[(int) round($bearing / 45) % 8];
    }
}
