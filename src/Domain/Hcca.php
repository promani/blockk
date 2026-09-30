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

    /** Alto del bloque: 25 cm en los dos sistemas. */
    public const int BLOCK_H = 500;

    /**
     * Sistemas de bloques (variable de entorno BLOCK_SYSTEM). Medidas en ticks; espesores en cm.
     *  - lika (por defecto): bloques Lika de 50 × 25 cm, espesores 10 / 15 / 20 y bloques U de 15 y 20
     *    (manual técnico en docs/);
     *  - generico: módulo genérico de 62,5 × 25 cm, espesores 7,5 / 10 / 15 / 20 con U en todos.
     * Pallets en unidades por espesor (ticks); adhesivo en kg/m² de muro; canal U [ancho, alto] en cm.
     */
    public const array SYSTEMS = [
        'lika' => [
            'id' => 'lika',
            'name' => 'Lika',
            'label' => 'Bloques Lika de 50 × 25 cm',
            'blockL' => 1000,
            'thicknesses' => [10.0, 15.0, 20.0],
            'uThicknesses' => [15.0, 20.0],
            'pallet' => [200 => 120, 300 => 72, 400 => 60],
            'uPallet' => [300 => 42, 400 => 40],
            'adhesive' => [200 => 3.25, 300 => 4.70, 400 => 6.25],
            'uChannel' => [300 => [9.0, 12.0], 400 => [14.0, 12.0]],
        ],
        'generico' => [
            'id' => 'generico',
            'name' => 'HCCA',
            'label' => 'Módulo genérico de 62,5 × 25 cm',
            'blockL' => 1250,
            'thicknesses' => [7.5, 10.0, 15.0, 20.0],
            'uThicknesses' => [7.5, 10.0, 15.0, 20.0],
            'pallet' => [150 => 128, 200 => 96, 300 => 72, 400 => 56],
            'uPallet' => [150 => 96, 200 => 96, 300 => 64, 400 => 48],
            'adhesive' => [150 => 1.5, 200 => 1.5, 300 => 2.0, 400 => 2.5],
            'uChannel' => [150 => [2.5, 20.0], 200 => [4.0, 20.0], 300 => [5.0, 20.0], 400 => [10.0, 20.0]],
        ],
    ];

    /** @var array<string, mixed>|null */
    private static ?array $system = null;

    /** @return array<string, mixed> el sistema de bloques activo */
    public static function system(): array
    {
        if (null === self::$system) {
            $name = strtolower(trim((string) ($_SERVER['BLOCK_SYSTEM'] ?? $_ENV['BLOCK_SYSTEM'] ?? (getenv('BLOCK_SYSTEM') ?: 'lika'))));
            self::$system = self::SYSTEMS[$name] ?? self::SYSTEMS['lika'];
        }

        return self::$system;
    }

    /** Cambia el sistema activo (tests; en la app lo fija BLOCK_SYSTEM). */
    public static function useSystem(string $name): void
    {
        self::$system = self::SYSTEMS[$name] ?? throw new \InvalidArgumentException("Sistema de bloques desconocido: {$name}");
    }

    /** Largo del bloque en ticks (Lika 50 cm = 1000; genérico 62,5 cm = 1250). */
    public static function blockL(): int
    {
        return self::system()['blockL'];
    }

    public static function blockLCm(): float
    {
        return self::blockL() / self::TICKS_PER_CM;
    }

    /** Largo del bloque en unidades de la retícula de 12,5 cm (Lika 4, genérico 5). */
    public static function blockUnits(): int
    {
        return intdiv(self::blockL(), self::GRID);
    }

    /** @return list<float> espesores disponibles en cm */
    public static function thicknesses(): array
    {
        return self::system()['thicknesses'];
    }

    /** ¿Hay bloque U de este espesor (ticks)? Si no, el dintel se hace de hormigón armado in situ. */
    public static function hasUBlock(int $tTicks): bool
    {
        return in_array(self::ticksToCm($tTicks), self::system()['uThicknesses'], true);
    }

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
    /** Un muro puede ser más bajo que el nivel (medianeras, parapetos) o, sin nada encima, llegar hasta 4,00 m (16 hiladas). */
    public const int MAX_WALL_COURSES = 16;

    /** Límite estructural: mampostería autoportante de 2 niveles (PB + PA <= 6,00 m). */
    public const int MAX_LEVELS = 2;
    public const int MAX_TOTAL_HEIGHT_CM = 600;

    /** >= 15 cm son portantes; menores, tabiques no portantes (espesores disponibles: thicknesses()). */
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
    public const int MAX_SLABS_PER_LEVEL = 20;
    public const int MAX_STAIRS_PER_LEVEL = 10;
    public const int MAX_ROOFS = 20;
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
            '3x12' => ['label' => 'Pino tratado 3" × 12" (7,5 × 30 cm)', 'b' => 7.5, 'd' => 30.0, 'maxSpanCm' => 575],
        ];
    }

    /** Largos comerciales de madera (cm). */
    public const array TIMBER_LENGTHS_CM = [300, 360, 420, 480, 540, 600];
    public const int JOIST_BEARING_CM = 10;
    public const int JOIST_MIN_SPACING_CM = 30;
    public const int JOIST_MAX_SPACING_CM = 60;
    public const float OSB_SHEET_M2 = 2.9768; // 1,22 × 2,44 m

    /** Bloques por pallet según el sistema activo (Lika: 120 / 72 / 60 y U 42 / 40). */
    public static function palletCapacity(string $kind, int $tTicks): int
    {
        $table = self::system()['U' === $kind ? 'uPallet' : 'pallet'];

        return $table[$tTicks] ?? ('U' === $kind ? 40 : 72);
    }

    /** Consumo de mortero adhesivo por m² de muro (kg/m²), según espesor y sistema. */
    public static function adhesiveRate(int $tTicks): float
    {
        $table = self::system()['adhesive'];
        if (isset($table[$tTicks])) {
            return $table[$tTicks];
        }
        // espesor intermedio: el del inmediato superior disponible
        foreach ($table as $t => $rate) {
            if ($t >= $tTicks) {
                return $rate;
            }
        }

        return end($table);
    }

    public const float BAG_KG = 25.0;
    public const float LEVELING_DENSITY = 1900.0; // kg/m³ mortero cementicio
    public const int LEVELING_THICKNESS_CM = 2;

    /**
     * Sección de hormigón a colar en un dintel o encadenado [ancho, alto] en cm: el canal del bloque U o, si el sistema
     * no tiene U de ese espesor, un dintel macizo in situ (espesor − 2 cm × 20 cm).
     *
     * @return array{float, float}
     */
    public static function uChannel(int $tTicks): array
    {
        return self::system()['uChannel'][$tTicks] ?? [max(4.0, self::ticksToCm($tTicks) - 2), 20.0];
    }

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
            'timber_3x12_m' => 11.0,
            'roof_cover_m2' => 22.0,
            'batten_m' => 1.4,
            'mesh_m2' => 6.0,
            'formwork_m2' => 12.0,
            'stair_step_u' => 28.0,
            'stair_landing_m2' => 95.0,
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
