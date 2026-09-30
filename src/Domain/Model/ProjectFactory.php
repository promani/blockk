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
            lotW: $this->intInRange($lot['w'] ?? 24, 4, 100, 'lot.w'),
            lotD: $this->intInRange($lot['d'] ?? 20, 4, 100, 'lot.d'),
            upper: (bool) ($data['upper'] ?? false) || !$levels[1]->isEmpty(),
            roofs: $this->roofs($data, $levels),
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
                $this->intInRange($w['h'] ?? Hcca::COURSES, 1, Hcca::MAX_WALL_COURSES, "$path.walls[$i].h"),
                isset($w['crown']) ? (bool) $w['crown'] : null,
            );
            if (!$wall->isValid()) {
                $this->errors[] = "$path.walls[$i]: el muro debe ser recto, ortogonal y con longitud > 0";
                continue;
            }
            $walls[] = $wall;
        }

        $openings = [];
        foreach ($this->list($d['openings'] ?? [], Hcca::MAX_OPENINGS_PER_LEVEL, "$path.openings") as $i => $o) {
            $openings[] = $this->opening($o, "$path.openings[$i]", $ids);
        }
        $ubeams = [];
        foreach ($this->list($d['ubeams'] ?? [], Hcca::MAX_UBEAMS_PER_LEVEL, "$path.ubeams") as $i => $u) {
            $ubeams[] = new UBeam(
                $this->id($u['id'] ?? null, "$path.ubeams[$i].id", $ids),
                $this->string($u['wall'] ?? '', 40, "$path.ubeams[$i].wall"),
                $this->intInRange($u['pos'] ?? 0, 0, Hcca::MAX_COORD_UNITS, "$path.ubeams[$i].pos"),
                $this->intInRange($u['len'] ?? 5, 1, 400, "$path.ubeams[$i].len"),
                $this->intInRange($u['course'] ?? Hcca::OPENING_TOP_COURSE, 0, Hcca::REGULAR_COURSES - 1, "$path.ubeams[$i].course"),
            );
        }
        $timber = [];
        foreach ($this->list($d['timber'] ?? [], Hcca::MAX_TIMBER_PER_LEVEL, "$path.timber") as $i => $t) {
            $timber[] = $this->timber($t, "$path.timber[$i]", $ids);
        }

        $slabs = [];
        foreach ($this->list($d['slabs'] ?? [], Hcca::MAX_SLABS_PER_LEVEL, "$path.slabs") as $i => $sl) {
            $slabs[] = new Slab(
                $this->id($sl['id'] ?? null, "$path.slabs[$i].id", $ids),
                $this->coord($sl['x'] ?? null, "$path.slabs[$i].x"),
                $this->coord($sl['y'] ?? null, "$path.slabs[$i].y"),
                $this->intInRange($sl['w'] ?? 8, 2, Hcca::MAX_BBOX_UNITS, "$path.slabs[$i].w"),
                $this->intInRange($sl['h'] ?? 8, 2, Hcca::MAX_BBOX_UNITS, "$path.slabs[$i].h"),
                $this->intInRange($sl['thickness'] ?? 12, 8, 25, "$path.slabs[$i].thickness"),
            );
        }
        $stairs = [];
        foreach ($this->list($d['stairs'] ?? [], Hcca::MAX_STAIRS_PER_LEVEL, "$path.stairs") as $i => $st) {
            $stairs[] = new Stair(
                $this->id($st['id'] ?? null, "$path.stairs[$i].id", $ids),
                $this->coord($st['x'] ?? null, "$path.stairs[$i].x"),
                $this->coord($st['y'] ?? null, "$path.stairs[$i].y"),
                in_array($st['dir'] ?? 'N', ['N', 'E', 'S', 'W'], true) ? $st['dir'] : 'N',
                in_array($st['shape'] ?? 'straight', ['straight', 'L', 'U'], true) ? $st['shape'] : 'straight',
                $this->intInRange($st['w'] ?? 8, 7, 16, "$path.stairs[$i].w"),
                $this->intInRange($st['tread'] ?? 28, 25, 32, "$path.stairs[$i].tread"),
                'left' === ($st['turn'] ?? 'right') ? 'left' : 'right',
            );
        }

        return new Level($walls, $openings, $ubeams, $timber, $slabs, $stairs);
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
            $this->intInRange($t['w'] ?? 8, 2, Hcca::MAX_BBOX_UNITS, "$path.w"),
            $this->intInRange($t['h'] ?? 8, 2, Hcca::MAX_BBOX_UNITS, "$path.h"),
            Axis::tryFrom((string) ($t['dir'] ?? 'x')) ?? Axis::X,
            $section,
            $this->intInRange($t['spacing'] ?? 40, Hcca::JOIST_MIN_SPACING_CM, Hcca::JOIST_MAX_SPACING_CM, "$path.spacing"),
        );
    }

    /**
     * Techos rectangulares (`roofs`). Los proyectos guardados con el formato anterior (`roof` único) se convierten en un techo
     * que cubre la caja envolvente del último nivel con muros.
     *
     * @param array<string, mixed> $data
     * @param list<Level>          $levels
     *
     * @return list<RoofPart>
     */
    private function roofs(array $data, array $levels): array
    {
        if (!array_key_exists('roofs', $data)) {
            $legacy = is_array($data['roof'] ?? null) ? $data['roof'] : [];
            $type = RoofType::tryFrom((string) ($legacy['type'] ?? 'none')) ?? RoofType::None;
            $top = isset($levels[1]) && !$levels[1]->isEmpty() ? 1 : 0;
            $walls = ($levels[$top] ?? new Level())->walls;
            if (RoofType::None === $type || [] === $walls) {
                return [];
            }
            $legacy += ['id' => 'r1', 'level' => $top, 'type' => $type->value];
            $legacy['x'] = min(array_map(static fn (Wall $w): int => $w->x1, $walls));
            $legacy['y'] = min(array_map(static fn (Wall $w): int => $w->y1, $walls));
            $legacy['w'] = max(array_map(static fn (Wall $w): int => $w->x2, $walls)) - $legacy['x'];
            $legacy['h'] = max(array_map(static fn (Wall $w): int => $w->y2, $walls)) - $legacy['y'];

            return [$this->roofPart($legacy, 'roof', $seen)];
        }
        $list = $this->list($data['roofs'], Hcca::MAX_ROOFS, 'roofs');
        $seen = [];
        $out = [];
        foreach ($list as $i => $r) {
            $out[] = $this->roofPart($r, "roofs[$i]", $seen);
        }

        return $out;
    }

    /** @param array<string, mixed> $r @param array<string, true>|null $seen */
    private function roofPart(array $r, string $path, ?array &$seen): RoofPart
    {
        $seen ??= [];
        $type = RoofType::tryFrom((string) ($r['type'] ?? 'gable')) ?? RoofType::Gable;
        if (RoofType::None === $type) {
            $type = RoofType::Gable;
        }
        $dir = (string) ($r['dir'] ?? '');
        $dir = RoofType::Shed === $type
            ? (in_array($dir, ['N', 'S', 'E', 'W'], true) ? $dir : 'S')
            : (in_array($dir, ['x', 'y'], true) ? $dir : 'x');
        $section = (string) ($r['section'] ?? '3x8');
        if (!isset(Hcca::timberSections()[$section])) {
            $this->errors[] = "$path.section desconocida";
            $section = '3x8';
        }
        $gableT = (int) ($r['gableT'] ?? 20);

        return new RoofPart(
            $this->id($r['id'] ?? null, "$path.id", $seen),
            $this->intInRange($r['level'] ?? 0, 0, Hcca::MAX_LEVELS - 1, "$path.level"),
            $this->coord($r['x'] ?? null, "$path.x"),
            $this->coord($r['y'] ?? null, "$path.y"),
            $this->intInRange($r['w'] ?? 8, 2, Hcca::MAX_BBOX_UNITS, "$path.w"),
            $this->intInRange($r['h'] ?? 8, 2, Hcca::MAX_BBOX_UNITS, "$path.h"),
            $type,
            $dir,
            $this->intInRange($r['slope'] ?? 30, 10, 100, "$path.slope"),
            $this->intInRange($r['overhang'] ?? 40, 0, 100, "$path.overhang"),
            $section,
            $this->intInRange($r['spacing'] ?? 50, Hcca::JOIST_MIN_SPACING_CM, Hcca::JOIST_MAX_SPACING_CM, "$path.spacing"),
            (bool) ($r['gableA'] ?? true),
            (bool) ($r['gableB'] ?? true),
            in_array($gableT, RoofPart::GABLE_THICKNESSES, true) ? $gableT : 20,
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
    private function list(mixed $value, int $max, string $path): array
    {
        if (!is_array($value)) {
            return [];
        }
        if (count($value) > $max) {
            $this->errors[] = "$path: demasiados elementos (máx. $max por nivel)";
            $value = array_slice($value, 0, $max);
        }

        return array_values(array_filter($value, is_array(...)));
    }

    /** @param array<string, true> $seen */
    private function id(mixed $value, string $path, array &$seen): string
    {
        $id = is_string($value) || is_int($value) ? (string) $value : '';
        if (!preg_match('/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/', $id)) {
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
        if (!in_array($cm, Hcca::thicknesses(), true)) {
            $this->errors[] = "$path: espesor no permitido (usar ".implode(' / ', array_map(static fn (float $t): string => str_replace('.', ',', (string) $t), Hcca::thicknesses())).' cm)';
            $cm = 20.0;
        }

        return Hcca::cmToTicks($cm);
    }

    private function thicknessCm(mixed $v): float
    {
        $cm = is_numeric($v) ? (float) $v : 20.0;

        return in_array($cm, Hcca::thicknesses(), true) ? $cm : 20.0;
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
