<?php

declare(strict_types=1);

namespace App\Http;

use App\Domain\Hcca;
use App\Domain\Model\OpeningKind;
use App\Domain\Model\Project;

/** Constantes constructivas que el cliente necesita para dibujar y validar en vivo (única fuente: Hcca). */
final class ClientConfig
{
    /** @return array<string, mixed> */
    public static function toArray(): array
    {
        return [
            'grid' => Hcca::GRID_CM,
            'blockL' => Hcca::blockLCm(),
            'blockUnits' => Hcca::blockUnits(),
            'blockSystem' => ['id' => Hcca::system()['id'], 'name' => Hcca::system()['name'], 'label' => Hcca::system()['label']],
            'blockH' => 25,
            'courses' => Hcca::COURSES,
            'crownCourse' => Hcca::CROWN_COURSE,
            'levelHeight' => Hcca::LEVEL_HEIGHT_CM,
            'maxLevels' => Hcca::MAX_LEVELS,
            'maxHeight' => Hcca::MAX_TOTAL_HEIGHT_CM,
            'thicknesses' => Hcca::thicknesses(),
            'loadBearingMin' => Hcca::LOAD_BEARING_MIN_T / Hcca::TICKS_PER_CM,
            'openingTopCourse' => Hcca::OPENING_TOP_COURSE,
            'lintelBearing' => Hcca::LINTEL_BEARING / Hcca::TICKS_PER_CM,
            'presets' => array_map(
                static fn (array $p): array => ['kind' => $p['kind']->value, 'label' => $p['label'], 'w' => $p['w'], 'sill' => $p['sill'], 'h' => $p['h']],
                Hcca::openingPresets(),
            ),
            'commercial' => array_map(
                static fn (array $c): array => ['kind' => $c['kind']->value] + $c,
                Hcca::commercialOpenings(),
            ),
            'columnSizes' => Hcca::COLUMN_SIZES_CM,
            'timberSections' => Hcca::timberSections(),
            'joistBearing' => Hcca::JOIST_BEARING_CM,
            'levelNames' => Project::LEVEL_NAMES,
            'levelShort' => Project::LEVEL_SHORT,
            'kinds' => array_map(static fn (OpeningKind $k): string => $k->value, OpeningKind::cases()),
        ];
    }

    /**
     * Datos del sistema de bloques para el catálogo técnico (textos ya formateados).
     *
     * @return array<string, mixed>
     */
    public static function catalog(): array
    {
        $sys = Hcca::system();
        $n = static fn (float $v): string => str_replace('.', ',', rtrim(rtrim(number_format($v, 2, '.', ''), '0'), '.'));
        $ts = Hcca::thicknesses();

        return [
            'id' => $sys['id'],
            'name' => $sys['name'],
            'label' => $sys['label'],
            'L' => $n(Hcca::blockLCm()),
            'half' => $n(Hcca::blockLCm() / 2),
            'thicknesses' => array_map(static fn (float $t): array => ['v' => $t, 'text' => $n($t)], $ts),
            'bearing' => implode(' y ', array_map($n, array_filter($ts, static fn (float $t): bool => $t * Hcca::TICKS_PER_CM >= Hcca::LOAD_BEARING_MIN_T))),
            'partition' => implode(' y ', array_map($n, array_filter($ts, static fn (float $t): bool => $t * Hcca::TICKS_PER_CM < Hcca::LOAD_BEARING_MIN_T))),
            'u' => implode(' / ', array_map(static fn (float $t): string => 'U'.$n($t), $sys['uThicknesses'])),
            'pallet' => implode(' · ', array_map(static fn (int $t, int $q): string => sprintf('%d u (%s cm)', $q, $n($t / Hcca::TICKS_PER_CM)), array_keys($sys['pallet']), $sys['pallet'])),
            'perM2' => $n(1 / (Hcca::blockLCm() / 100 * 0.25)),
        ];
    }

    public static function json(): string
    {
        return json_encode(self::toArray(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
