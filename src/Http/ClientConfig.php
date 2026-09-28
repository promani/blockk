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
            'blockL' => 62.5,
            'blockH' => 25,
            'courses' => Hcca::COURSES,
            'crownCourse' => Hcca::CROWN_COURSE,
            'levelHeight' => Hcca::LEVEL_HEIGHT_CM,
            'maxLevels' => Hcca::MAX_LEVELS,
            'maxHeight' => Hcca::MAX_TOTAL_HEIGHT_CM,
            'thicknesses' => Hcca::THICKNESSES_CM,
            'loadBearingMin' => Hcca::LOAD_BEARING_MIN_T / Hcca::TICKS_PER_CM,
            'openingTopCourse' => Hcca::OPENING_TOP_COURSE,
            'lintelBearing' => Hcca::LINTEL_BEARING / Hcca::TICKS_PER_CM,
            'presets' => array_map(
                static fn (array $p): array => ['kind' => $p['kind']->value, 'label' => $p['label'], 'w' => $p['w'], 'sill' => $p['sill'], 'h' => $p['h']],
                Hcca::openingPresets(),
            ),
            'timberSections' => Hcca::timberSections(),
            'joistBearing' => Hcca::JOIST_BEARING_CM,
            'levelNames' => Project::LEVEL_NAMES,
            'levelShort' => Project::LEVEL_SHORT,
            'kinds' => array_map(static fn (OpeningKind $k): string => $k->value, OpeningKind::cases()),
        ];
    }

    public static function json(): string
    {
        return json_encode(self::toArray(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
