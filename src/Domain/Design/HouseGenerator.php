<?php

declare(strict_types=1);

namespace App\Domain\Design;

use App\Domain\Templates\TemplateBuilder;

/**
 * Arma una casa válida a partir de un programa (ambientes por nivel, techo). Es determinista: el mismo programa da la
 * misma casa, así que «agregar un dormitorio» es volver a generar con el programa cambiado.
 *
 * Esquema (unidades de 12,5 cm, el norte arriba):
 *
 *     x=0        Wl                               W
 *     ┌──────────┬────────┬────────┬─────────────┐ y=0
 *     │          │ dorm.  │ dorm.  │ dorm. ppal. │      banda norte (dormitorios: sol de invierno)
 *     │  estar   ├────────┴────────┴─────────────┤ y=dN
 *     │ comedor      pasillo (abierto al estar)  │
 *     │ cocina   ├──────┬──────┬─────────────────┤ y=dN+H
 *     │ (escal.) │ baño │ lav. │   dormitorio    │      banda sur (servicios)
 *     └──────────┴──────┴──────┴─────────────────┘ y=D
 *
 * En dos niveles el Nivel 2 repite el esqueleto (muros exteriores sobre los exteriores, pasillo sobre pasillo): el
 * bloque izquierdo es un hall con la llegada de la escalera en U y las bandas llevan los ambientes de arriba. El piso
 * del Nivel 2 es una losa por ambiente de abajo (luces ≤ 4 m).
 */
final class HouseGenerator
{
    public const float M2_PER_UNIT2 = 0.015625; // (12,5 cm)²

    /** Tipos de ambiente de banda: nombre, m² por defecto, ancho mínimo (u), banda preferida, puerta y ventana. */
    public const array TYPES = [
        'dormitorio' => ['Dormitorio', 10.5, 22, 'N', 'P87', 'V125'],
        'dormitorio_principal' => ['Dormitorio principal', 13.0, 26, 'N', 'P87', 'V150'],
        'escritorio' => ['Escritorio', 8.0, 20, 'N', 'P87', 'V125'],
        'cocina' => ['Cocina', 8.0, 20, 'S', 'P87', 'V125'],
        'bano' => ['Baño', 4.5, 13, 'S', 'P75', 'VT62'],
        'toilette' => ['Toilette', 2.5, 12, 'S', 'P75', 'VT62'],
        'lavadero' => ['Lavadero', 4.0, 12, 'S', 'P75', 'VT62'],
        'deposito' => ['Depósito', 3.5, 12, 'S', 'P75', 'VT62'],
        'libre' => ['Ambiente libre', 6.0, 14, 'N', 'P87', 'V125'],
    ];

    /** Tipos que van al bloque del estar (Nivel 1) y no a una banda. */
    public const array LIVING_TYPES = ['estar', 'comedor', 'estar_comedor', 'estar_comedor_cocina'];

    private const int DEPTH_N = 30;   // 3,75 m
    private const int DEPTH_S = 28;   // 3,50 m
    private const int HALL = 9;       // 1,125 m entre ejes
    private const int MAX_W = 176;    // 22 m
    private const int MAX_BAND_ROOMS = 8;

    /**
     * @param array<string, mixed> $program {nombre?, niveles: 1|2, ambientes: list<{tipo, nivel?, m2?}>, techo?: dos_aguas|un_agua}
     *
     * @return array{project: array<string, mixed>, rooms: list<array<string, mixed>>, program: array<string, mixed>}
     *
     * @throws \InvalidArgumentException con un mensaje para el usuario si el programa no es construible
     */
    public function generate(array $program): array
    {
        $program = $this->normalize($program);
        $levels = $program['niveles'];

        // Bloque del estar (Nivel 1): superficie pedida + comedor y cocina integrados.
        $livingM2 = 0.0;
        $livingParts = [];
        foreach ($program['ambientes'] as $a) {
            if (1 === $a['nivel'] && in_array($a['tipo'], self::LIVING_TYPES, true)) {
                $livingM2 += $a['m2'] ?? match ($a['tipo']) {
                    'comedor' => 10.0,
                    'estar_comedor_cocina' => 28.0,
                    'estar_comedor' => 24.0,
                    default => 18.0,
                };
                $livingParts[] = $a['tipo'];
            }
        }
        $kitchenApart = array_any($program['ambientes'], static fn (array $a): bool => 'cocina' === $a['tipo'] && 1 === $a['nivel']);
        if ([] === $livingParts) {
            $livingM2 = $kitchenApart ? 22.0 : 28.0;
        }
        $D = self::DEPTH_N + self::HALL + self::DEPTH_S;
        $Wl = max(26, min(32, (int) ceil($livingM2 / ($D * self::M2_PER_UNIT2))));

        // Bandas por nivel.
        $bands = [];
        for ($l = 1; $l <= $levels; ++$l) {
            $rooms = array_values(array_filter($program['ambientes'], static fn (array $a): bool => $a['nivel'] === $l && isset(self::TYPES[$a['tipo']])));
            if (count($rooms) > 2 * self::MAX_BAND_ROOMS) {
                throw new \InvalidArgumentException(sprintf('Demasiados ambientes en el Nivel %d (máximo %d además del estar).', $l, 2 * self::MAX_BAND_ROOMS));
            }
            $bands[$l] = $this->assignBands($rooms);
        }
        $Wr = 0;
        foreach ($bands as $b) {
            $Wr = max($Wr, $this->bandWidth($b['N']), $this->bandWidth($b['S']));
        }
        $Wr = max($Wr, 24);
        foreach ($bands as $l => $b) {
            $bands[$l]['N'] = $this->pad($b['N'], $Wr, 'N');
            $bands[$l]['S'] = $this->pad($b['S'], $Wr, 'S');
        }
        $W = $Wl + $Wr;
        if ($W > self::MAX_W) {
            throw new \InvalidArgumentException(sprintf('La casa quedaría de %s m de largo: son demasiados ambientes para una sola tira. Probá repartirlos en dos niveles o sacar alguno.', $this->m($W)));
        }

        $shed = 'un_agua' === $program['techo'];
        $b = new TemplateBuilder($program['nombre']);
        $rooms = [];
        $yS = self::DEPTH_N + self::HALL;
        for ($l = 1; $l <= $levels; ++$l) {
            $li = $l - 1;
            // En el Nivel 1 el pasillo es portante (apoya losas y el Nivel 2); a un agua también arriba (apoya el faldón).
            $inner = 1 === $l || $shed ? 15 : 10;
            $b->room($li, 0, 0, $W, $D, 20)
                ->wall($li, $Wl, 0, $Wl, self::DEPTH_N, $inner)
                ->wall($li, $Wl, $yS, $Wl, $D, $inner)
                ->wall($li, $Wl, self::DEPTH_N, $W, self::DEPTH_N, $inner)
                ->wall($li, $Wl, $yS, $W, $yS, $inner);

            // Bloque izquierdo
            $leftName = 1 === $l ? $this->livingName($livingParts, $kitchenApart) : 'Hall / estar íntimo';
            if ($shed) {
                // Muro portante bajo el cambio de faldón, con una puerta doble entre las dos mitades del bloque.
                $b->wall($li, 0, $yS, $Wl, $yS, 15)->opening($li, 'P150', 'x', $yS, intdiv($Wl - 12, 2));
                $rooms[] = $this->room($l, 1 === $l ? 'Estar' : 'Hall / estar íntimo', 1 === $l ? 'estar' : 'hall', 0, 0, $Wl, $yS);
                $rooms[] = $this->room($l, 1 === $l ? ($kitchenApart ? 'Comedor' : 'Comedor-cocina') : 'Hall de escalera', 1 === $l ? 'comedor' : 'hall', 0, $yS, $Wl, $D - $yS);
            } else {
                $rooms[] = $this->room($l, $leftName, 1 === $l ? 'estar' : 'hall', 0, 0, $Wl, $D);
            }
            $rooms[] = $this->room($l, 'Pasillo', 'pasillo', $Wl, self::DEPTH_N, $W - $Wl, self::HALL);
            $big = $Wl >= 27 ? 'VG150' : 'V150';
            $b->opening($li, 1 === $l ? $big : 'V150', 'x', 0, intdiv($Wl - 12, 2));
            $b->opening($li, 'V125', 'y', 0, 10);
            if (1 === $l) {
                $b->opening($li, 'P100', 'y', 0, $D - 14);
            }
            $b->opening($li, 'V100', 'x', $D, $levels > 1 ? 3 : intdiv($Wl - 8, 2));

            // Bandas
            foreach (['N' => [0, self::DEPTH_N, self::DEPTH_N], 'S' => [$yS, $D, $yS]] as $side => [$y0, $y1, $doorLine]) {
                $x = $Wl;
                $list = $bands[$l][$side];
                foreach ($list as $i => $r) {
                    $w = $r['w'];
                    $spec = self::TYPES[$r['tipo']];
                    if ($i > 0) {
                        $b->wall($li, $x, $y0, $x, $y1, 10);
                    }
                    $b->opening($li, $spec[4], 'x', $doorLine, $x + 3);
                    $window = $this->fitWindow($spec[5], $w);
                    $ow = $this->presetWidth($window);
                    $b->opening($li, $window, 'x', 'N' === $side ? 0 : $D, $x + intdiv($w - $ow, 2));
                    if ($i === count($list) - 1 && 'N' === $spec[3] && 'N' === $side) {
                        $b->opening($li, 'V100', 'y', $W, $y0 + intdiv($y1 - $y0 - 8, 2)); // ventana extra al este
                    }
                    $rooms[] = $this->room($l, $r['nombre'], $r['tipo'], $x, $y0, $w, $y1 - $y0);
                    $x += $w;
                }
            }
        }

        if (2 === $levels) {
            $b->stair(0, $Wl - 17, $D - 27, 'N', 'U')->upper();
            foreach ($rooms as $r) {
                if (1 === $r['nivel']) {
                    $b->slab(1, $r['rect'][0], $r['rect'][1], $r['rect'][2], $r['rect'][3]);
                }
            }
        }
        if ('un_agua' !== $program['techo']) {
            $alongX = $W >= $D;
            $b->roofPart($levels - 1, 0, 0, $W, $D, 'gable', $alongX ? 'x' : 'y', 30, self::section(($alongX ? $D : $W) / 2));
        } else {
            // A un agua, 8 m de luz no los cubre ningún cabio: dos faldones escalonados que apoyan en el muro del pasillo.
            $b->roofPart($levels - 1, 0, 0, $W, $yS, 'shed', 'S', 30, self::section($yS))
                ->roofPart($levels - 1, 0, $yS, $W, $D - $yS, 'shed', 'S', 30, self::section($D - $yS));
        }

        foreach ($rooms as $r) {
            // el tipo de ambiente sale del tipo del programa o, en el bloque del estar, de su nombre
            $type = ['dormitorio_principal' => 'dormitorio', 'deposito' => 'guardado', 'pasillo' => 'circulacion', 'hall' => 'circulacion', 'libre' => ''][$r['tipo']]
                ?? (isset(\App\Domain\Hcca::roomTypes()[$r['tipo']]) && 'estar' !== $r['tipo'] ? $r['tipo'] : (\App\Domain\Hcca::roomTypeOf($r['nombre']) ?? ''));
            $b->label($r['nivel'] - 1, $r['rect'][0] + intdiv($r['rect'][2], 2), $r['rect'][1] + intdiv($r['rect'][3], 2), $r['nombre'], $type);
        }

        $project = $b->build();
        $project['lot'] = ['w' => max(24, (int) ceil($W * 0.125) + 8), 'd' => max(20, (int) ceil($D * 0.125) + 8)];

        return ['project' => $project, 'rooms' => $rooms, 'program' => $program];
    }

    /**
     * Valida y completa el programa (tipos conocidos, niveles 1–2, m² razonables).
     *
     * @param array<string, mixed> $program
     *
     * @return array{nombre: string, niveles: int, techo: string, ambientes: list<array{tipo: string, nivel: int, m2?: float}>}
     */
    public function normalize(array $program): array
    {
        $levels = (int) ($program['niveles'] ?? 1);
        if ($levels < 1 || $levels > 2) {
            throw new \InvalidArgumentException('La casa puede tener 1 o 2 niveles.');
        }
        $list = [];
        foreach ((array) ($program['ambientes'] ?? []) as $a) {
            if (!is_array($a)) {
                continue;
            }
            $tipo = $this->canonicalType((string) ($a['tipo'] ?? ''));
            if (null === $tipo) {
                throw new \InvalidArgumentException(sprintf('Tipo de ambiente desconocido: «%s». Usá: %s.', (string) ($a['tipo'] ?? ''), implode(', ', [...self::LIVING_TYPES, ...array_keys(self::TYPES)])));
            }
            $nivel = (int) ($a['nivel'] ?? 1);
            if ($nivel < 1 || $nivel > $levels) {
                throw new \InvalidArgumentException(sprintf('El ambiente «%s» está en el Nivel %d pero la casa tiene %d nivel(es).', $tipo, $nivel, $levels));
            }
            if (2 === $nivel && in_array($tipo, self::LIVING_TYPES, true)) {
                $tipo = 'libre'; // un estar arriba es un ambiente de banda
            }
            $cantidad = max(1, min(8, (int) ($a['cantidad'] ?? 1)));
            $item = ['tipo' => $tipo, 'nivel' => $nivel];
            if (isset($a['m2']) && is_numeric($a['m2'])) {
                $item['m2'] = max(2.0, min(60.0, (float) $a['m2']));
            }
            for ($i = 0; $i < $cantidad; ++$i) {
                $list[] = $item;
            }
        }
        if ([] === array_filter($list, static fn (array $a): bool => isset(self::TYPES[$a['tipo']]) && 1 === $a['nivel']) && 1 === $levels && [] === $list) {
            throw new \InvalidArgumentException('El programa no tiene ambientes.');
        }
        for ($l = 2; $l <= $levels; ++$l) {
            if ([] === array_filter($list, static fn (array $a): bool => $a['nivel'] === $l)) {
                throw new \InvalidArgumentException(sprintf('El Nivel %d no tiene ambientes.', $l));
            }
        }
        $roof = (string) ($program['techo'] ?? 'dos_aguas');
        $name = trim((string) ($program['nombre'] ?? ''));
        if ('' === $name) {
            $beds = count(array_filter($list, static fn (array $a): bool => str_starts_with($a['tipo'], 'dormitorio')));
            $name = sprintf('Casa de %d dormitorio%s%s', $beds, 1 === $beds ? '' : 's', 2 === $levels ? ' en 2 plantas' : '');
        }

        return ['nombre' => mb_substr($name, 0, 80), 'niveles' => $levels, 'techo' => in_array($roof, ['dos_aguas', 'un_agua'], true) ? $roof : 'dos_aguas', 'ambientes' => $list];
    }

    private function canonicalType(string $t): ?string
    {
        $t = strtolower(trim(strtr($t, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n', ' ' => '_', '-' => '_'])));
        $alias = [
            'bano' => 'bano', 'banio' => 'bano', 'toilet' => 'toilette', 'toilette' => 'toilette', 'dormitorio' => 'dormitorio',
            'habitacion' => 'dormitorio', 'cuarto' => 'dormitorio', 'dormitorio_principal' => 'dormitorio_principal', 'suite' => 'dormitorio_principal',
            'principal' => 'dormitorio_principal', 'escritorio' => 'escritorio', 'oficina' => 'escritorio', 'estudio' => 'escritorio',
            'cocina' => 'cocina', 'lavadero' => 'lavadero', 'deposito' => 'deposito', 'baulera' => 'deposito', 'libre' => 'libre',
            'playroom' => 'libre', 'sala_de_juegos' => 'libre', 'estar' => 'estar', 'living' => 'estar', 'comedor' => 'comedor',
            'estar_comedor' => 'estar_comedor', 'living_comedor' => 'estar_comedor', 'estar_comedor_cocina' => 'estar_comedor_cocina',
            'living_comedor_cocina' => 'estar_comedor_cocina',
        ];

        return $alias[$t] ?? null;
    }

    /**
     * Reparte los ambientes en banda norte y sur equilibrando largos.
     *
     * @param list<array<string, mixed>> $rooms
     *
     * @return array{N: list<array<string, mixed>>, S: list<array<string, mixed>>}
     */
    private function assignBands(array $rooms): array
    {
        $N = [];
        $S = [];
        foreach ($rooms as $r) {
            $spec = self::TYPES[$r['tipo']];
            $item = ['tipo' => $r['tipo'], 'nombre' => $spec[0], 'm2' => $r['m2'] ?? $spec[1]];
            if ('N' === $spec[3]) {
                $N[] = $item;
            } else {
                $S[] = $item;
            }
        }
        $sized = function (array $list, int $depth): array {
            foreach ($list as $k => $r) {
                $list[$k]['w'] = max($this->minWidth($r['tipo']), (int) ceil($r['m2'] / ($depth * self::M2_PER_UNIT2)));
            }

            return $list;
        };
        $N = $sized($N, self::DEPTH_N);
        $S = $sized($S, self::DEPTH_S);

        // Si la banda norte queda mucho más larga, bajan dormitorios al sur (los más chicos primero).
        for ($guard = 0; $guard < 16; ++$guard) {
            $diff = $this->bandWidth($N) - $this->bandWidth($S);
            $movable = array_filter($N, static fn (array $r): bool => 'dormitorio_principal' !== $r['tipo']);
            if ([] === $movable || count($N) <= 1) {
                break;
            }
            uasort($movable, static fn (array $a, array $b): int => $a['w'] <=> $b['w']);
            $k = array_key_first($movable);
            if ($diff <= $N[$k]['w']) {
                break;
            }
            $moved = $N[$k];
            unset($N[$k]);
            $N = array_values($N);
            $moved['w'] = max($this->minWidth($moved['tipo']), (int) ceil($moved['m2'] / (self::DEPTH_S * self::M2_PER_UNIT2)));
            $S[] = $moved;
        }
        if (count($N) > self::MAX_BAND_ROOMS || count($S) > self::MAX_BAND_ROOMS) {
            throw new \InvalidArgumentException('Demasiados ambientes para un nivel: repartilos en dos niveles o sacá alguno.');
        }
        // Orden: al norte el principal al fondo (este); al sur la cocina junto al estar, después servicios y dormitorios.
        usort($N, static fn (array $a, array $b): int => ('dormitorio_principal' === $a['tipo']) <=> ('dormitorio_principal' === $b['tipo']));
        $rank = ['cocina' => 0, 'lavadero' => 1, 'bano' => 2, 'toilette' => 2, 'deposito' => 3];
        usort($S, static fn (array $a, array $b): int => ($rank[$a['tipo']] ?? 4) <=> ($rank[$b['tipo']] ?? 4));

        return ['N' => $N, 'S' => $S];
    }

    /** @param list<array<string, mixed>> $list */
    private function bandWidth(array $list): int
    {
        return array_sum(array_column($list, 'w'));
    }

    /**
     * Estira la banda hasta el ancho común: crecen primero dormitorios y escritorios; si la banda está vacía, un ambiente libre.
     *
     * @param list<array<string, mixed>> $list
     *
     * @return list<array<string, mixed>>
     */
    private function pad(array $list, int $width, string $side): array
    {
        $extra = $width - $this->bandWidth($list);
        if ($extra <= 0) {
            return $list;
        }
        if ([] === $list || ($extra >= $this->minWidth('libre') && !array_any($list, static fn (array $r): bool => in_array($r['tipo'], ['dormitorio', 'dormitorio_principal', 'escritorio', 'libre', 'cocina'], true)))) {
            $list[] = ['tipo' => 'N' === $side ? 'libre' : 'deposito', 'nombre' => 'N' === $side ? 'Ambiente libre' : 'Depósito', 'm2' => 0, 'w' => $extra];
            if ('deposito' === $list[array_key_last($list)]['tipo'] && $extra >= 20) {
                $list[array_key_last($list)]['tipo'] = 'libre';
                $list[array_key_last($list)]['nombre'] = 'Ambiente libre';
            }

            return $list;
        }
        $grow = array_keys(array_filter($list, static fn (array $r): bool => in_array($r['tipo'], ['dormitorio', 'dormitorio_principal', 'escritorio', 'libre', 'cocina'], true)));
        if ([] === $grow) {
            $grow = array_keys($list);
        }
        // Reparto parejo entre los que crecen.
        $each = intdiv($extra, count($grow));
        $rest = $extra - $each * count($grow);
        foreach ($grow as $i => $k) {
            $list[$k]['w'] += $each + ($i < $rest ? 1 : 0);
        }

        return $list;
    }

    /** @param list<string> $parts */
    private function livingName(array $parts, bool $kitchenApart): string
    {
        if ($kitchenApart) {
            return in_array('comedor', $parts, true) || in_array('estar_comedor', $parts, true) || [] === $parts ? 'Estar-comedor' : 'Estar';
        }

        return 'Estar-comedor-cocina';
    }

    /** Sección de cabio más chica que cubre una luz horizontal de `$units` a 50 cm (misma regla que RoofPlanner). */
    public static function section(int|float $units): string
    {
        foreach (\App\Domain\Hcca::timberSections() as $key => $spec) {
            if ($spec['maxSpanCm'] * (40 / 50) ** (1 / 3) >= $units * 12.5) {
                return $key;
            }
        }

        return '3x12';
    }

    /** Ancho mínimo (u): el del tipo, y que entren la puerta y la ventana con jambas de ≥ 25 cm a cada lado. */
    private function minWidth(string $type): int
    {
        $spec = self::TYPES[$type];

        return max($spec[2], $this->presetWidth($spec[4]) + 6, $this->presetWidth('VT62' === $spec[5] ? 'VT62' : 'V62') + 6);
    }

    /** La ventana del tipo, o la más grande que entre en un ambiente de `$w` unidades de ancho. */
    private function fitWindow(string $preset, int $w): string
    {
        $fits = fn (string $p): bool => $this->presetWidth($p) + 6 <= $w && $this->presetWidth($p) <= 0.6 * $w; // jambas y ≤ 60 % del tramo
        if ($fits($preset)) {
            return $preset;
        }
        foreach (['V125', 'V100', 'V62', 'VT62'] as $p) {
            if ($fits($p)) {
                return $p;
            }
        }

        return 'VT62';
    }

    private function presetWidth(string $preset): int
    {
        return (int) \App\Domain\Hcca::openingPresets()[$preset]['w'];
    }

    /** @return array<string, mixed> */
    private function room(int $level, string $name, string $type, int $x, int $y, int $w, int $h): array
    {
        return ['nivel' => $level, 'nombre' => $name, 'tipo' => $type, 'rect' => [$x, $y, $w, $h], 'medidas' => sprintf('%s × %s m', $this->m($w), $this->m($h)), 'm2' => round($w * $h * self::M2_PER_UNIT2, 1)];
    }

    private function m(int $units): string
    {
        return rtrim(rtrim(number_format($units * 0.125, 2, ',', ''), '0'), ',');
    }
}
