<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

use App\Domain\Hcca;
use App\Domain\Model\Axis;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\Level;
use App\Domain\Model\Opening;
use App\Domain\Model\UBeam;
use App\Domain\Model\Wall;

/**
 * Lleva un nivel a su forma canónica para que el resto del motor trabaje sobre un grafo limpio:
 *
 *  1. Sin solapes colineales (los muros ya existentes tienen prioridad sobre los nuevos).
 *  2. Todos los muros se tocan únicamente por sus extremos: se dividen en las intersecciones
 *     en T y en cruz (así cada nodo tiene hasta 4 brazos: E, O, N, S).
 *  3. Tramos colineales consecutivos del mismo espesor y sin ramificaciones se fusionan en un
 *     único muro (una sola hilada continua, sin juntas verticales alineadas).
 *
 * Los vanos y vigas U se reubican en el tramo que los contiene; si quedan partidos se descartan.
 * La función es pura: devuelve un nuevo Level. Lanza InvalidProjectException si las intersecciones generarían
 * más tramos que el presupuesto de complejidad (se corta antes de materializarlos).
 *
 * Los mapas internos tienen la forma id_viejo => [[id_nuevo, desde_viejo, largo, desde_nuevo], …]: el tramo
 * [desde_viejo, desde_viejo + largo) del muro viejo pasa a ocupar [desde_nuevo, desde_nuevo + largo) del nuevo.
 */
final class WallNormalizer
{
    public function normalize(Level $level): NormalizationResult
    {
        $walls = array_values(array_filter($level->walls, static fn (Wall $w): bool => $w->isValid()));
        $openings = $level->openings;
        $ubeams = $level->ubeams;
        $dropped = 0;

        [$walls, $map] = $this->resolveOverlaps($walls);
        [$openings, $ubeams, $d] = $this->remap($openings, $ubeams, $map);
        $dropped += $d;

        [$walls, $map] = $this->splitAtJunctions($walls);
        [$openings, $ubeams, $d] = $this->remap($openings, $ubeams, $map);
        $dropped += $d;

        do {
            [$walls, $map, $merged] = $this->mergeStraight($walls);
            if ($merged) {
                [$openings, $ubeams, $d] = $this->remap($openings, $ubeams, $map);
                $dropped += $d;
            }
        } while ($merged);

        $notices = [];
        if ($dropped > 0) {
            $notices[] = sprintf('Se descartaron %d abertura(s)/viga(s) U que quedaron partidas o sin muro de apoyo.', $dropped);
        }

        return new NormalizationResult($level->withStructure($walls, $openings, $ubeams), $notices);
    }

    /**
     * @param list<Wall> $walls
     *
     * @return array{list<Wall>, array<string, list<array{string, int, int, int}>>}
     */
    private function resolveOverlaps(array $walls): array
    {
        $accepted = []; // "axis:line" => list<array{int, int}> intervalos ya ocupados
        $out = [];
        $map = [];
        $usedIds = array_fill_keys(array_map(static fn (Wall $w): string => $w->id, $walls), true);

        foreach ($walls as $w) {
            $key = $w->axis()->value.':'.$w->lineU();
            $free = [[$w->startU(), $w->endU()]];
            foreach ($accepted[$key] ?? [] as [$as, $ae]) {
                $next = [];
                foreach ($free as [$fs, $fe]) {
                    if ($ae <= $fs || $as >= $fe) {
                        $next[] = [$fs, $fe];
                        continue;
                    }
                    if ($fs < $as) {
                        $next[] = [$fs, $as];
                    }
                    if ($ae < $fe) {
                        $next[] = [$ae, $fe];
                    }
                }
                $free = $next;
            }
            $map[$w->id] = [];
            foreach ($free as $k => [$fs, $fe]) {
                $piece = $w->withRange($fs, $fe);
                if ($k > 0) {
                    $piece = $piece->withId($this->uniqueId($w->id, $k, $usedIds));
                }
                $out[] = $piece;
                $accepted[$key][] = [$fs, $fe];
                $map[$w->id][] = [$piece->id, $fs - $w->startU(), $fe - $fs, 0];
            }
        }

        return [$out, $map];
    }

    /**
     * @param list<Wall> $walls
     *
     * @return array{list<Wall>, array<string, list<array{string, int, int, int}>>}
     */
    private function splitAtJunctions(array $walls): array
    {
        $splits = [];
        $pieces = count($walls);
        foreach ($walls as $w) {
            foreach ($walls as $v) {
                if ($w === $v || $w->axis() === $v->axis()) {
                    continue;
                }
                // Punto de cruce de las dos rectas soporte, si cae dentro de ambos segmentos.
                [$cx, $cy] = Axis::X === $w->axis() ? [$v->lineU(), $w->lineU()] : [$w->lineU(), $v->lineU()];
                if ($cx < $w->x1 || $cx > $w->x2 || $cy < $w->y1 || $cy > $w->y2
                    || $cx < $v->x1 || $cx > $v->x2 || $cy < $v->y1 || $cy > $v->y2) {
                    continue;
                }
                $along = Axis::X === $w->axis() ? $cx : $cy;
                if ($along > $w->startU() && $along < $w->endU() && !isset($splits[$w->id][$along])) {
                    $splits[$w->id][$along] = true;
                    if (++$pieces > Hcca::MAX_SEGMENTS_PER_LEVEL) {
                        // Se corta antes de materializar los tramos: una rejilla densa explotaría en memoria.
                        throw new InvalidProjectException([sprintf('El proyecto es demasiado complejo (más de %d tramos de muro por nivel tras dividir las intersecciones).', Hcca::MAX_SEGMENTS_PER_LEVEL)]);
                    }
                }
            }
        }

        $usedIds = array_fill_keys(array_map(static fn (Wall $w): string => $w->id, $walls), true);
        $out = [];
        $map = [];
        foreach ($walls as $w) {
            $cuts = array_keys($splits[$w->id] ?? []);
            sort($cuts);
            $bounds = [$w->startU(), ...$cuts, $w->endU()];
            $map[$w->id] = [];
            for ($k = 0; $k < count($bounds) - 1; ++$k) {
                $piece = $w->withRange($bounds[$k], $bounds[$k + 1]);
                if ($k > 0) {
                    $piece = $piece->withId($this->uniqueId($w->id, $k, $usedIds));
                }
                $out[] = $piece;
                $map[$w->id][] = [$piece->id, $bounds[$k] - $w->startU(), $bounds[$k + 1] - $bounds[$k], 0];
            }
        }

        return [$out, $map];
    }

    /**
     * Fusiona UN par de muros colineales (misma línea, mismo espesor) que se tocan en un nodo donde
     * no llega ningún otro muro. Se llama en bucle hasta que no haya más fusiones.
     *
     * @param list<Wall> $walls
     *
     * @return array{list<Wall>, array<string, list<array{string, int, int, int}>>, bool}
     */
    private function mergeStraight(array $walls): array
    {
        $arms = [];
        foreach ($walls as $w) {
            $arms["{$w->x1},{$w->y1}"][] = $w;
            $arms["{$w->x2},{$w->y2}"][] = $w;
        }
        foreach ($arms as $pair) {
            if (2 !== count($pair)) {
                continue;
            }
            [$a, $b] = $pair;
            if ($a->id === $b->id || $a->axis() !== $b->axis() || $a->lineU() !== $b->lineU() || !$a->sameSection($b)) {
                continue;
            }
            [$first, $second] = $a->startU() <= $b->startU() ? [$a, $b] : [$b, $a];
            if ($first->endU() !== $second->startU()) {
                continue;
            }
            $merged = $first->withRange($first->startU(), $second->endU());
            $map = [];
            $out = [];
            foreach ($walls as $w) {
                if ($w->id === $second->id) {
                    // Todo el muro viejo pasa a ocupar el final del fusionado (desde_nuevo = largo del primero).
                    $map[$w->id] = [[$first->id, 0, $second->lengthU(), $first->lengthU()]];
                    continue;
                }
                $out[] = $w->id === $first->id ? $merged : $w;
                $map[$w->id] = [[$w->id, 0, $w->lengthU(), 0]];
            }

            return [$out, $map, true];
        }

        return [$walls, [], false];
    }

    /**
     * Reubica vanos y vigas U según el mapa de tramos; los que no caben en un único tramo se descartan.
     *
     * @param list<Opening>                                     $openings
     * @param list<UBeam>                                       $ubeams
     * @param array<string, list<array{string, int, int, int}>> $map
     *
     * @return array{list<Opening>, list<UBeam>, int}
     */
    private function remap(array $openings, array $ubeams, array $map): array
    {
        $dropped = 0;
        $place = static function (string $wallId, int $pos, int $span) use ($map): ?array {
            foreach ($map[$wallId] ?? [] as [$newId, $oldStart, $length, $newStart]) {
                if ($pos >= $oldStart && $pos + $span <= $oldStart + $length) {
                    return [$newId, $pos - $oldStart + $newStart];
                }
            }

            return null;
        };

        $newOpenings = [];
        foreach ($openings as $o) {
            $p = $place($o->wallId, $o->pos, $o->w);
            if (null === $p) {
                ++$dropped;
                continue;
            }
            $newOpenings[] = $o->withPlacement($p[0], $p[1]);
        }
        $newBeams = [];
        foreach ($ubeams as $u) {
            $p = $place($u->wallId, $u->pos, $u->len);
            if (null === $p) {
                ++$dropped;
                continue;
            }
            $newBeams[] = $u->withPlacement($p[0], $p[1]);
        }

        return [$newOpenings, $newBeams, $dropped];
    }

    /** @param array<string, true> $used */
    private function uniqueId(string $base, int $k, array &$used): string
    {
        do {
            $id = "$base.$k";
            ++$k;
        } while (isset($used[$id]));
        $used[$id] = true;

        return $id;
    }
}
