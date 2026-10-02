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
    public const int MAX_ZONES = 30;
    public const int MAX_TREES = 60;
    /** Tipos de zona del terreno y tamaños de árbol. */
    public const array ZONE_KINDS = ['pool', 'patio', 'garden', 'path'];
    public const array TREE_SIZES = ['S', 'M', 'L'];
    public const int MAX_COLUMNS_PER_LEVEL = 40;
    public const int MAX_LABELS_PER_LEVEL = 40;
    /** Lados de pilar de hormigón armado (cm). */
    public const array COLUMN_SIZES_CM = [20, 25, 30, 40];
    public const int MAX_ROOFS = 20;
    public const int MAX_FURNITURE_PER_LEVEL = 80;

    /**
     * Muebles simples: gabaritos de tamaño real para ver si un ambiente alcanza (¿entra la cama con las mesas de luz?,
     * ¿la puerta abre sin tocar el inodoro?). Medidas habituales de REFERENCIA en cm: ancho × fondo de la huella y alto
     * de la caja en la isométrica. `back`: el borde de arriba es una cabecera o un respaldo. Las mesas incluyen las
     * sillas (45 cm a cada lado largo). No entran al cómputo ni a la Revisión.
     *
     * @return array<string, array{name: string, short: string, group: string, w: int, d: int, h: int, back?: bool}>
     */
    public static function furniture(): array
    {
        return [
            'cama1' => ['name' => 'Cama de 1 plaza (90 × 190)', 'short' => 'Cama', 'group' => 'Dormitorio', 'w' => 90, 'd' => 190, 'h' => 50, 'back' => true],
            'cama15' => ['name' => 'Cama de 1 plaza y media (105 × 190)', 'short' => 'Cama', 'group' => 'Dormitorio', 'w' => 105, 'd' => 190, 'h' => 50, 'back' => true],
            'cama2' => ['name' => 'Cama de 2 plazas (140 × 190)', 'short' => 'Cama 2 pl.', 'group' => 'Dormitorio', 'w' => 140, 'd' => 190, 'h' => 50, 'back' => true],
            'camaking' => ['name' => 'Cama king (180 × 200)', 'short' => 'Cama king', 'group' => 'Dormitorio', 'w' => 180, 'd' => 200, 'h' => 50, 'back' => true],
            'mesaluz' => ['name' => 'Mesa de luz (45 × 40)', 'short' => 'M. luz', 'group' => 'Dormitorio', 'w' => 45, 'd' => 40, 'h' => 50],
            'placard120' => ['name' => 'Placard (120 × 60)', 'short' => 'Placard', 'group' => 'Dormitorio', 'w' => 120, 'd' => 60, 'h' => 200],
            'placard180' => ['name' => 'Placard (180 × 60)', 'short' => 'Placard', 'group' => 'Dormitorio', 'w' => 180, 'd' => 60, 'h' => 200],
            'escritorio' => ['name' => 'Escritorio (120 × 60)', 'short' => 'Escritorio', 'group' => 'Dormitorio', 'w' => 120, 'd' => 60, 'h' => 75],
            'mesa4' => ['name' => 'Mesa para 4 con sillas (120 × 170)', 'short' => 'Mesa 4', 'group' => 'Estar y comedor', 'w' => 120, 'd' => 170, 'h' => 75],
            'mesa6' => ['name' => 'Mesa para 6 con sillas (180 × 180)', 'short' => 'Mesa 6', 'group' => 'Estar y comedor', 'w' => 180, 'd' => 180, 'h' => 75],
            'mesa8' => ['name' => 'Mesa para 8 con sillas (240 × 190)', 'short' => 'Mesa 8', 'group' => 'Estar y comedor', 'w' => 240, 'd' => 190, 'h' => 75],
            'sillon2' => ['name' => 'Sillón de 2 cuerpos (160 × 90)', 'short' => 'Sillón', 'group' => 'Estar y comedor', 'w' => 160, 'd' => 90, 'h' => 80, 'back' => true],
            'sillon3' => ['name' => 'Sillón de 3 cuerpos (210 × 90)', 'short' => 'Sillón', 'group' => 'Estar y comedor', 'w' => 210, 'd' => 90, 'h' => 80, 'back' => true],
            'mesada120' => ['name' => 'Mesada (120 × 60)', 'short' => 'Mesada', 'group' => 'Cocina y lavadero', 'w' => 120, 'd' => 60, 'h' => 90],
            'mesada180' => ['name' => 'Mesada (180 × 60)', 'short' => 'Mesada', 'group' => 'Cocina y lavadero', 'w' => 180, 'd' => 60, 'h' => 90],
            'isla' => ['name' => 'Isla (180 × 90)', 'short' => 'Isla', 'group' => 'Cocina y lavadero', 'w' => 180, 'd' => 90, 'h' => 90],
            'heladera' => ['name' => 'Heladera (70 × 70)', 'short' => 'Hel.', 'group' => 'Cocina y lavadero', 'w' => 70, 'd' => 70, 'h' => 180],
            'cocina' => ['name' => 'Cocina (60 × 60)', 'short' => 'Coc.', 'group' => 'Cocina y lavadero', 'w' => 60, 'd' => 60, 'h' => 90],
            'lavarropas' => ['name' => 'Lavarropas (60 × 60)', 'short' => 'Lav.', 'group' => 'Cocina y lavadero', 'w' => 60, 'd' => 60, 'h' => 85],
            'inodoro' => ['name' => 'Inodoro (40 × 65)', 'short' => 'Inod.', 'group' => 'Baño', 'w' => 40, 'd' => 65, 'h' => 40],
            'bidet' => ['name' => 'Bidet (40 × 60)', 'short' => 'Bidet', 'group' => 'Baño', 'w' => 40, 'd' => 60, 'h' => 40],
            'lavatorio' => ['name' => 'Lavatorio (50 × 45)', 'short' => 'Lavat.', 'group' => 'Baño', 'w' => 50, 'd' => 45, 'h' => 85],
            'ducha80' => ['name' => 'Ducha (80 × 80)', 'short' => 'Ducha', 'group' => 'Baño', 'w' => 80, 'd' => 80, 'h' => 10],
            'ducha90' => ['name' => 'Ducha (90 × 90)', 'short' => 'Ducha', 'group' => 'Baño', 'w' => 90, 'd' => 90, 'h' => 10],
            'banera' => ['name' => 'Bañera (170 × 70)', 'short' => 'Bañera', 'group' => 'Baño', 'w' => 170, 'd' => 70, 'h' => 55],
        ];
    }

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
            'PG250' => ['kind' => OpeningKind::Gate, 'label' => 'Portón 250 × 200', 'w' => 20, 'sill' => 0, 'h' => 8],
            'PG300' => ['kind' => OpeningKind::Gate, 'label' => 'Portón 300 × 200', 'w' => 24, 'sill' => 0, 'h' => 8],
        ];
    }

    /**
     * Carpinterías en medidas comerciales (ancho × alto en cm) con el vano modular que las contiene: el menor múltiplo
     * de 12,5 cm de ancho y de 25 cm de alto. Como todos los vanos rematan a 2,00 m, el antepecho sale del alto.
     * Son medidas habituales de catálogo, de REFERENCIA: cada fabricante tiene las suyas; se editan acá.
     *
     * @return list<array{id: string, kind: OpeningKind, label: string, cw: int, ch: int, w: int, sill: int, mode: string}> w en unidades de 12,5 cm; sill en hiladas
     */
    public static function commercialOpenings(): array
    {
        $n = static fn (float $v): string => str_replace('.', ',', (string) $v);
        $out = [];
        foreach ([
            ['P70', OpeningKind::Door, 'Puerta', 70, 200, 'swing'],
            ['P80', OpeningKind::Door, 'Puerta', 80, 200, 'swing'],
            ['P90', OpeningKind::Door, 'Puerta', 90, 200, 'swing'],
            ['P160', OpeningKind::Door, 'Puerta doble', 160, 200, 'swing'],
            ['VT60', OpeningKind::Window, 'Ventiluz', 60, 40, 'swing'],
            ['VT80', OpeningKind::Window, 'Ventiluz', 80, 40, 'swing'],
            ['V100x110', OpeningKind::Window, 'Ventana', 100, 110, 'slide'],
            ['V120x110', OpeningKind::Window, 'Ventana', 120, 110, 'slide'],
            ['V150x110', OpeningKind::Window, 'Ventana', 150, 110, 'slide'],
            ['V180x110', OpeningKind::Window, 'Ventana', 180, 110, 'slide'],
            ['V200x110', OpeningKind::Window, 'Ventana', 200, 110, 'slide'],
            ['V120x150', OpeningKind::Window, 'Ventana', 120, 150, 'slide'],
            ['V150x150', OpeningKind::Window, 'Ventana', 150, 150, 'slide'],
            ['B150', OpeningKind::Window, 'Puerta ventana', 150, 200, 'slide'],
            ['B180', OpeningKind::Window, 'Puerta ventana', 180, 200, 'slide'],
            ['B200', OpeningKind::Window, 'Puerta ventana', 200, 200, 'slide'],
            ['B240', OpeningKind::Window, 'Puerta ventana', 240, 200, 'slide'],
            ['PG240', OpeningKind::Gate, 'Portón', 240, 200, 'overhead'],
            ['PG300', OpeningKind::Gate, 'Portón', 300, 200, 'overhead'],
        ] as [$id, $kind, $name, $cw, $ch, $mode]) {
            $w = (int) ceil($cw / self::GRID_CM);
            $h = (int) ceil($ch / 25);
            $out[] = [
                'id' => $id, 'kind' => $kind,
                'label' => sprintf('%s %d × %d (vano %s × %d)', $name, $cw, $ch, $n($w * self::GRID_CM), $h * 25),
                'cw' => $cw, 'ch' => $ch, 'w' => $w, 'sill' => self::OPENING_TOP_COURSE - $h, 'mode' => $mode,
            ];
        }

        return $out;
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

    /**
     * Tipos de ambiente. El nombre de un ambiente es libre; el tipo es lo que usa la Revisión para dar recomendaciones
     * de uso y lo que agrupa los m² del Resumen. `minM2`: superficie útil de referencia; `window`: `luz` (conviene una
     * ventana), `ventilacion` (ventana o extractor) o null; `words`: comienzos de nombre con los que se deduce el tipo
     * cuando no se eligió (sin acentos y en minúsculas). Son RECOMENDACIONES, no normativa.
     *
     * @return array<string, array{label: string, minM2: float, window: ?string, words: list<string>}>
     */
    public static function roomTypes(): array
    {
        return [
            'estar_comedor' => ['label' => 'Estar-comedor', 'minM2' => 16.0, 'window' => 'luz', 'words' => ['estar-comedor', 'estar comedor', 'living comedor', 'living-comedor']],
            'estar' => ['label' => 'Estar', 'minM2' => 10.0, 'window' => 'luz', 'words' => ['estar', 'living', 'family']],
            'comedor' => ['label' => 'Comedor', 'minM2' => 8.0, 'window' => 'luz', 'words' => ['comedor', 'dining']],
            'cocina' => ['label' => 'Cocina', 'minM2' => 4.0, 'window' => 'ventilacion', 'words' => ['cocina', 'kitchen']],
            'dormitorio' => ['label' => 'Dormitorio', 'minM2' => 7.5, 'window' => 'luz', 'words' => ['dormitorio', 'habitacion', 'cuarto', 'suite', 'bed']],
            'bano' => ['label' => 'Baño', 'minM2' => 2.5, 'window' => 'ventilacion', 'words' => ['bano', 'bath', 'ensuite']],
            'toilette' => ['label' => 'Toilette', 'minM2' => 1.2, 'window' => 'ventilacion', 'words' => ['toilette', 'toilet', 'powder']],
            'lavadero' => ['label' => 'Lavadero', 'minM2' => 2.0, 'window' => 'ventilacion', 'words' => ['lavadero', 'laundry']],
            'escritorio' => ['label' => 'Escritorio', 'minM2' => 6.0, 'window' => 'luz', 'words' => ['escritorio', 'oficina', 'estudio', 'study']],
            'circulacion' => ['label' => 'Pasillo o hall', 'minM2' => 0.0, 'window' => null, 'words' => ['pasillo', 'hall', 'paso', 'entrada', 'recibidor']],
            'guardado' => ['label' => 'Vestidor o depósito', 'minM2' => 0.0, 'window' => null, 'words' => ['vestidor', 'placard', 'deposito', 'despensa', 'baulera']],
            'garaje' => ['label' => 'Garaje', 'minM2' => 12.5, 'window' => null, 'words' => ['garaje', 'garage', 'cochera']],
            'galeria' => ['label' => 'Galería o quincho', 'minM2' => 0.0, 'window' => null, 'words' => ['galeria', 'alfresco', 'quincho', 'porche', 'patio']],
            'otro' => ['label' => 'Otro', 'minM2' => 0.0, 'window' => null, 'words' => []],
        ];
    }

    /** Tipos que no cuentan como superficie habitable (se informan aparte en el Resumen y el Cómputo). */
    public const array NON_HABITABLE_ROOMS = ['garaje', 'galeria'];
    /** Tipos de servicio: llegar a ellos pasando por un dormitorio es normal (baño en suite, vestidor). */
    public const array SERVICE_ROOMS = ['bano', 'toilette', 'guardado', 'lavadero', 'galeria'];

    /** Tipo que corresponde a un nombre libre («Dormitorio principal» → dormitorio), o null si no se reconoce. */
    public static function roomTypeOf(string $name): ?string
    {
        $plain = mb_strtolower(trim(strtr($name, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n', 'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ú' => 'u', 'Ñ' => 'n'])));
        foreach (self::roomTypes() as $id => $type) {
            foreach ($type['words'] as $word) {
                if (str_starts_with($plain, $word)) {
                    return $id;
                }
            }
        }

        return null;
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
