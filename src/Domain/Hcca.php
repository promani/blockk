<?php

declare(strict_types=1);

namespace App\Domain;

use App\Domain\Model\OpeningKind;

/**
 * Constantes y catálogos del sistema constructivo HCCA (Hormigón Celular Curado en Autoclave).
 *
 * Toda la geometría del motor se expresa en "ticks" enteros de 0,5 mm (20 ticks = 1 cm).
 * Así los submódulos (12,5 cm, 6,25 cm) y los medios espesores (3,75 cm) son enteros exactos
 * y no hay errores de coma flotante al comparar trabas ni remanentes de corte.
 *
 * Los valores de predimensionado y de precios son REFERENCIALES: no reemplazan el cálculo
 * estructural (CIRSOC 501 / Eurocódigo 6) ni la cotización oficial de un distribuidor.
 */
final class Hcca
{
    public const int TICKS_PER_CM = 20;

    /** Retícula de edición: 12,5 cm (submódulo de traba). */
    public const int GRID = 250;
    public const float GRID_CM = 12.5;

    /** Bloque estándar: 62,5 × 25 cm (el espesor varía). */
    public const int BLOCK_L = 1250;
    public const int BLOCK_H = 500;
    public const int UNITS_PER_BLOCK = 5;

    /** Pieza mínima manejable en obra (12,5 cm) y traba mínima entre hiladas consecutivas. */
    public const int MIN_PIECE = 250;
    public const int MIN_BOND = 250;

    /** Apoyo mínimo del dintel U a cada lado del vano y jamba mínima (25 cm). */
    public const int LINTEL_BEARING = 500;
    public const int MIN_PIER = 500;

    /** 11 hiladas de bloque + 1 hilada de bloque U (encadenado / viga corona) = 12 hiladas = 3,00 m. */
    public const int COURSES = 12;
    public const int REGULAR_COURSES = 11;
    public const int CROWN_COURSE = 11;
    public const int LEVEL_HEIGHT_CM = 300;

    /** Límite estructural: mampostería autoportante de 2 niveles (PB + PA <= 6,00 m). */
    public const int MAX_LEVELS = 2;
    public const int MAX_TOTAL_HEIGHT_CM = 600;

    /** Espesores disponibles (cm). >= 15 cm son portantes; menores, tabiques no portantes. */
    public const array THICKNESSES_CM = [7.5, 10.0, 15.0, 20.0];
    public const int LOAD_BEARING_MIN_T = 300; // 15 cm en ticks

    /** Los vanos se resuelven con su cara superior en la hilada 9 (2,00 m). */
    public const int OPENING_TOP_COURSE = 8;

    /** Límites defensivos de entrada (la API es pública y sin estado). */
    public const int MAX_WALLS_PER_LEVEL = 1500;
    /** Los lotes admitidos miden como máximo 100 m (800 unidades); las coordenadas admiten un margen alrededor. */
    public const int MAX_COORD_UNITS = 1000;
    public const int MAX_BBOX_UNITS = 900;
    public const int MAX_OPENINGS_PER_LEVEL = 1500;
    public const int MAX_UBEAMS_PER_LEVEL = 500;
    public const int MAX_TIMBER_PER_LEVEL = 40;
    /** Presupuesto de complejidad tras normalizar (una vivienda real usa < 150 tramos por nivel). */
    public const int MAX_SEGMENTS_PER_LEVEL = 800;

    /** @var array<string, array{kind: OpeningKind, label: string, w: int, sill: int, h: int}> w en unidades de 12,5 cm; sill/h en hiladas */
    public static function openingPresets(): array
    {
        return [
            'P75' => ['kind' => OpeningKind::Door, 'label' => 'Puerta 75 × 200', 'w' => 6, 'sill' => 0, 'h' => 8],
            'P87' => ['kind' => OpeningKind::Door, 'label' => 'Puerta 87,5 × 200', 'w' => 7, 'sill' => 0, 'h' => 8],
            'P100' => ['kind' => OpeningKind::Door, 'label' => 'Puerta 100 × 200', 'w' => 8, 'sill' => 0, 'h' => 8],
            'P150' => ['kind' => OpeningKind::Door, 'label' => 'Puerta doble 150 × 200', 'w' => 12, 'sill' => 0, 'h' => 8],
            'V62' => ['kind' => OpeningKind::Window, 'label' => 'Ventana 62,5 × 100', 'w' => 5, 'sill' => 4, 'h' => 4],
            'V100' => ['kind' => OpeningKind::Window, 'label' => 'Ventana 100 × 100', 'w' => 8, 'sill' => 4, 'h' => 4],
            'V125' => ['kind' => OpeningKind::Window, 'label' => 'Ventana 125 × 100', 'w' => 10, 'sill' => 4, 'h' => 4],
            'V150' => ['kind' => OpeningKind::Window, 'label' => 'Ventana 150 × 100', 'w' => 12, 'sill' => 4, 'h' => 4],
            'V187' => ['kind' => OpeningKind::Window, 'label' => 'Ventana 187,5 × 100', 'w' => 15, 'sill' => 4, 'h' => 4],
            'VT62' => ['kind' => OpeningKind::Window, 'label' => 'Ventiluz 62,5 × 50', 'w' => 5, 'sill' => 6, 'h' => 2],
            'VT100' => ['kind' => OpeningKind::Window, 'label' => 'Ventiluz 100 × 50', 'w' => 8, 'sill' => 6, 'h' => 2],
            'VG150' => ['kind' => OpeningKind::Window, 'label' => 'Ventanal 150 × 200', 'w' => 12, 'sill' => 0, 'h' => 8],
        ];
    }

    /**
     * Secciones de madera escuadrada. maxSpanCm: luz libre máxima referencial a 40 cm entre ejes.
     *
     * @return array<string, array{label: string, b: float, d: float, maxSpanCm: int}>
     */
    public static function timberSections(): array
    {
        return [
            '3x8' => ['label' => 'Pino tratado 3" × 8" (7,5 × 20 cm)', 'b' => 7.5, 'd' => 20.0, 'maxSpanCm' => 375],
            '3x10' => ['label' => 'Pino tratado 3" × 10" (7,5 × 25 cm)', 'b' => 7.5, 'd' => 25.0, 'maxSpanCm' => 475],
        ];
    }

    /** Largos comerciales de madera (cm). */
    public const array TIMBER_LENGTHS_CM = [300, 360, 420, 480, 540, 600];
    public const int JOIST_BEARING_CM = 10;
    public const int JOIST_MIN_SPACING_CM = 30;
    public const int JOIST_MAX_SPACING_CM = 60;
    public const float OSB_SHEET_M2 = 2.9768; // 1,22 × 2,44 m

    /** Bloques por pallet (referencial, 1,44–1,80 m³ por pallet según espesor). */
    public static function palletCapacity(string $kind, int $tTicks): int
    {
        $blocks = [150 => 128, 200 => 96, 300 => 72, 400 => 56];
        $ublocks = [150 => 96, 200 => 96, 300 => 64, 400 => 48];
        $table = 'U' === $kind ? $ublocks : $blocks;

        return $table[$tTicks] ?? 72;
    }

    /** Consumo de mortero adhesivo de junta delgada por m² de paño (kg/m²), según espesor. */
    public static function adhesiveRate(int $tTicks): float
    {
        return match (true) {
            $tTicks <= 200 => 1.5,
            $tTicks <= 300 => 2.0,
            default => 2.5,
        };
    }

    public const float BAG_KG = 25.0;
    public const float LEVELING_DENSITY = 1900.0; // kg/m³ mortero cementicio
    public const int LEVELING_THICKNESS_CM = 2;

    /** Ancho interior del canal del bloque U (cm), para el volumen de hormigón a colar. */
    public static function uChannelWidthCm(int $tTicks): float
    {
        return match (true) {
            $tTicks <= 150 => 2.5,
            $tTicks <= 200 => 4.0,
            $tTicks <= 300 => 5.0,
            default => 10.0,
        };
    }

    public const float U_CHANNEL_DEPTH_CM = 20.0;
    public const float REBAR8_KG_M = 0.395;
    public const float REBAR10_KG_M = 0.617;

    /** Anclajes metálicos (planchuela) por encuentro en T / en cruz: uno cada 2 hiladas. */
    public const int ANCHORS_PER_TEE = 6;
    public const int ANCHORS_PER_CROSS = 12;

    /** Precios de ejemplo EDITABLES (moneda configurable). No son cotizaciones reales. */
    public static function defaultPrices(): array
    {
        return [
            'block_m3' => 115.0,
            'ublock_m3' => 140.0,
            'adhesive_bag' => 7.5,
            'leveling_bag' => 5.0,
            'concrete_m3' => 130.0,
            'rebar8_kg' => 1.4,
            'rebar10_kg' => 1.4,
            'anchor_u' => 1.2,
            'timber_3x8_m' => 6.5,
            'timber_3x10_m' => 8.5,
            'osb_sheet' => 34.0,
            'elastic_band_m' => 1.1,
            'plate_u' => 9.0,
        ];
    }

    public static function cmToTicks(float|int $cm): int
    {
        return (int) round($cm * self::TICKS_PER_CM);
    }

    public static function ticksToCm(int $ticks): float
    {
        return $ticks / self::TICKS_PER_CM;
    }

    public static function unitsToTicks(int $units): int
    {
        return $units * self::GRID;
    }
}
