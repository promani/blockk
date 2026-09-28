<?php

declare(strict_types=1);

namespace App\Domain\Model;

use App\Domain\Hcca;

/**
 * Hidrata y valida un Project desde el JSON del cliente. Es la frontera de confianza:
 * todo lo que entra al motor pasa por acá (tipos, rangos, presets conocidos, límites de tamaño).
 */
final class ProjectFactory
{
    /** @var list<string> */
    private array $errors = [];

    /** @param array<string, mixed> $data */
    public static function fromArray(array $data): Project
    {
        return (new self())->build($data);
    }

    /** @param array<string, mixed> $data */
    private function build(array $data): Project
    {
        $levelsData = $data['levels'] ?? [];
        if (!is_array($levelsData) || !array_is_list($levelsData)) {
            $this->errors[] = 'levels debe ser una lista';
            $levelsData = [];
        }
        if (count($levelsData) > Hcca::MAX_LEVELS) {
            $this->errors[] = 'Límite estructural: la mampostería autoportante HCCA admite como máximo 2 niveles (PB + PA <= 6,00 m).';
            $levelsData = array_slice($levelsData, 0, Hcca::MAX_LEVELS);
        }

        $levels = [];
        foreach ($levelsData as $i => $levelData) {
            $levels[] = $this->level(is_array($levelData) ? $levelData : [], "levels[$i]");
        }
        while (count($levels) < Hcca::MAX_LEVELS) {
            $levels[] = new Level();
        }

        $settings = $this->settings(is_array($data['settings'] ?? null) ? $data['settings'] : []);
        $lot = is_array($data['lot'] ?? null) ? $data['lot'] : [];

        $project = new Project(
            name: $this->string($data['name'] ?? 'Proyecto sin título', 120, 'name'),
            levels: $levels,
            settings: $settings,
            north: $this->intInRange($data['north'] ?? 0, 0, 359, 'north') % 360,
            latitude: $this->floatInRange($data['lat'] ?? -34.6, -66.0, 66.0, 'lat'),
            lotW: $this->intInRange($lot['w'] ?? 24, 4, 200, 'lot.w'),
            lotD: $this->intInRange($lot['d'] ?? 20, 4, 200, 'lot.d'),
        );

        if ([] !== $this->errors) {
            throw new InvalidProjectException($this->errors);
        }

        return $project;
    }

    /** @param array<string, mixed> $d */
    private function level(array $d, string $path): Level
    {
        $walls = [];
        $ids = [];
        $wallsData = is_array($d['walls'] ?? null) ? $d['walls'] : [];
        if (count($wallsData) > Hcca::MAX_WALLS_PER_LEVEL) {
            $this->errors[] = "$path.walls: demasiados muros (máx. ".Hcca::MAX_WALLS_PER_LEVEL.')';
            $wallsData = array_slice($wallsData, 0, Hcca::MAX_WALLS_PER_LEVEL);
        }
        foreach ($wallsData as $i => $w) {
            if (!is_array($w)) {
                $this->errors[] = "$path.walls[$i] inválido";
                continue;
            }
            $id = $this->id($w['id'] ?? null, "$path.walls[$i].id", $ids);
            $t = $this->thickness($w['t'] ?? 20, "$path.walls[$i].t");
            $wall = Wall::between(
                $id,
                $this->coord($w['x1'] ?? null, "$path.walls[$i].x1"),
                $this->coord($w['y1'] ?? null, "$path.walls[$i].y1"),
                $this->coord($w['x2'] ?? null, "$path.walls[$i].x2"),
                $this->coord($w['y2'] ?? null, "$path.walls[$i].y2"),
                $t,
            );
            if (!$wall->isValid()) {
                $this->errors[] = "$path.walls[$i]: el muro debe ser recto, ortogonal y con longitud > 0";
                continue;
            }
            $walls[] = $wall;
        }

        $openings = [];
        foreach ($this->list($d['openings'] ?? []) as $i => $o) {
            $openings[] = $this->opening($o, "$path.openings[$i]", $ids);
        }
        $ubeams = [];
        foreach ($this->list($d['ubeams'] ?? []) as $i => $u) {
            $ubeams[] = new UBeam(
                $this->id($u['id'] ?? null, "$path.ubeams[$i].id", $ids),
                $this->string($u['wall'] ?? '', 40, "$path.ubeams[$i].wall"),
                $this->intInRange($u['pos'] ?? 0, 0, Hcca::MAX_COORD_UNITS, "$path.ubeams[$i].pos"),
                $this->intInRange($u['len'] ?? 5, 1, 400, "$path.ubeams[$i].len"),
                $this->intInRange($u['course'] ?? Hcca::OPENING_TOP_COURSE, 0, Hcca::REGULAR_COURSES - 1, "$path.ubeams[$i].course"),
            );
        }
        $timber = [];
        foreach ($this->list($d['timber'] ?? []) as $i => $t) {
            $timber[] = $this->timber($t, "$path.timber[$i]", $ids);
        }

        return new Level($walls, $openings, $ubeams, $timber);
    }

    /** @param array<string, mixed> $o @param array<string, true> $ids */
    private function opening(array $o, string $path, array &$ids): Opening
    {
        $presets = Hcca::openingPresets();
        $preset = $this->string($o['preset'] ?? '', 12, "$path.preset");
        $base = $presets[$preset] ?? null;
        $kind = OpeningKind::tryFrom((string) ($o['kind'] ?? $base['kind']->value ?? '')) ?? OpeningKind::Window;
        $sill = $this->intInRange($o['sill'] ?? $base['sill'] ?? 4, 0, 7, "$path.sill");

        return new Opening(
            id: $this->id($o['id'] ?? null, "$path.id", $ids),
            wallId: $this->string($o['wall'] ?? '', 40, "$path.wall"),
            pos: $this->intInRange($o['pos'] ?? 0, 0, Hcca::MAX_COORD_UNITS, "$path.pos"),
            w: $this->intInRange($o['w'] ?? $base['w'] ?? 8, 2, 40, "$path.w"),
            sill: $sill,
            // Todos los vanos rematan en la hilada 9 (2,00 m): la altura se deduce del antepecho.
            h: Hcca::OPENING_TOP_COURSE - $sill,
            kind: $kind,
            preset: isset($presets[$preset]) ? $preset : '',
            flip: (bool) ($o['flip'] ?? false),
        );
    }

    /** @param array<string, mixed> $t @param array<string, true> $ids */
    private function timber(array $t, string $path, array &$ids): TimberElement
    {
        $id = $this->id($t['id'] ?? null, "$path.id", $ids);
        $section = (string) ($t['section'] ?? '3x8');
        if (!isset(Hcca::timberSections()[$section])) {
            $this->errors[] = "$path.section desconocida";
            $section = '3x8';
        }
        if (($t['kind'] ?? 'joists') === 'beam') {
            $beam = new TimberBeam(
                $id,
                $this->coord($t['x1'] ?? null, "$path.x1"),
                $this->coord($t['y1'] ?? null, "$path.y1"),
                $this->coord($t['x2'] ?? null, "$path.x2"),
                $this->coord($t['y2'] ?? null, "$path.y2"),
                $section,
            );
            if ($beam->x1 !== $beam->x2 && $beam->y1 !== $beam->y2 || 0 === $beam->lengthU()) {
                $this->errors[] = "$path: la viga debe ser ortogonal y de longitud > 0";
            }

            return $beam;
        }

        return new JoistField(
            $id,
            $this->coord($t['x'] ?? null, "$path.x"),
            $this->coord($t['y'] ?? null, "$path.y"),
            $this->intInRange($t['w'] ?? 8, 2, Hcca::MAX_COORD_UNITS, "$path.w"),
            $this->intInRange($t['h'] ?? 8, 2, Hcca::MAX_COORD_UNITS, "$path.h"),
            Axis::tryFrom((string) ($t['dir'] ?? 'x')) ?? Axis::X,
            $section,
            $this->intInRange($t['spacing'] ?? 40, Hcca::JOIST_MIN_SPACING_CM, Hcca::JOIST_MAX_SPACING_CM, "$path.spacing"),
        );
    }

    /** @param array<string, mixed> $s */
    private function settings(array $s): Settings
    {
        $prices = [];
        $known = Hcca::defaultPrices();
        foreach (is_array($s['prices'] ?? null) ? $s['prices'] : [] as $key => $value) {
            if (isset($known[$key]) && is_numeric($value) && $value >= 0 && $value < 1.0e9) {
                $prices[$key] = (float) $value;
            }
        }
        $currency = preg_replace('/[^A-Za-z$€£ ]/u', '', $this->string($s['currency'] ?? 'USD', 8, 'settings.currency')) ?: 'USD';

        return new Settings(
            defaultThicknessCm: $this->thicknessCm($s['defaultT'] ?? 20),
            reservePct: $this->intInRange($s['reservePct'] ?? 3, 0, 30, 'settings.reservePct'),
            currency: $currency,
            prices: $prices,
        );
    }

    /** @return array<int, array<string, mixed>> */
    private function list(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(array_slice($value, 0, 4000), is_array(...)));
    }

    /** @param array<string, true> $seen */
    private function id(mixed $value, string $path, array &$seen): string
    {
        $id = is_string($value) || is_int($value) ? (string) $value : '';
        if (!preg_match('/^[A-Za-z0-9_.-]{1,40}$/', $id)) {
            $this->errors[] = "$path inválido";

            return 'invalid';
        }
        if (isset($seen[$id])) {
            $this->errors[] = "$path duplicado ($id)";
        }
        $seen[$id] = true;

        return $id;
    }

    private function coord(mixed $v, string $path): int
    {
        return $this->intInRange($v, -Hcca::MAX_COORD_UNITS, Hcca::MAX_COORD_UNITS, $path);
    }

    private function thickness(mixed $v, string $path): int
    {
        $cm = is_numeric($v) ? (float) $v : 0.0;
        if (!in_array($cm, Hcca::THICKNESSES_CM, true)) {
            $this->errors[] = "$path: espesor no permitido (usar 7,5 / 10 / 15 / 20 cm)";
            $cm = 20.0;
        }

        return Hcca::cmToTicks($cm);
    }

    private function thicknessCm(mixed $v): float
    {
        $cm = is_numeric($v) ? (float) $v : 20.0;

        return in_array($cm, Hcca::THICKNESSES_CM, true) ? $cm : 20.0;
    }

    private function intInRange(mixed $v, int $min, int $max, string $path): int
    {
        if (is_float($v) && floor($v) === $v) {
            $v = (int) $v;
        }
        if (!is_int($v)) {
            $this->errors[] = "$path debe ser un entero";

            return $min;
        }
        if ($v < $min || $v > $max) {
            $this->errors[] = "$path fuera de rango [$min, $max]";

            return max($min, min($max, $v));
        }

        return $v;
    }

    private function floatInRange(mixed $v, float $min, float $max, string $path): float
    {
        if (!is_int($v) && !is_float($v)) {
            $this->errors[] = "$path debe ser numérico";

            return $min;
        }
        if ($v < $min || $v > $max) {
            $this->errors[] = "$path fuera de rango [$min, $max]";

            return max($min, min($max, (float) $v));
        }

        return (float) $v;
    }

    private function string(mixed $v, int $maxLen, string $path): string
    {
        if (!is_string($v)) {
            $this->errors[] = "$path debe ser texto";

            return '';
        }

        return mb_substr(trim($v), 0, $maxLen);
    }
}
