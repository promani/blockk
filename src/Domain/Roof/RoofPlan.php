<?php

declare(strict_types=1);

namespace App\Domain\Roof;

final readonly class RoofPlan
{
    /**
     * @param list<array{id: string, level: int, type: string, geometry: array<string, mixed>, bom: array<string, mixed>, issues: list<array<string, mixed>>}> $parts
     * @param list<array<string, mixed>>                                                                                                                       $issues
     */
    public function __construct(public array $parts = [], public array $issues = [])
    {
    }

    /** Totales de todos los techos (para el cómputo y la telemetría). @return array<string, mixed> */
    public function bom(): array
    {
        $t = ['raftersCount' => 0, 'ridgeMl' => 0.0, 'battenMl' => 0.0, 'coverM2' => 0.0, 'gableMasonryM2' => 0.0, 'rafters' => [], 'ridge' => [], 'gableByThickness' => []];
        foreach ($this->parts as $p) {
            $b = $p['bom'];
            $t['raftersCount'] += $b['raftersCount'];
            $t['ridgeMl'] += $b['ridgeMl'];
            $t['battenMl'] += $b['battenMl'];
            $t['coverM2'] += $b['coverM2'];
            $t['gableMasonryM2'] += $b['gableMasonryM2'];
            if ($b['raftersCount'] > 0) {
                $key = $b['section'].'@'.$b['raftersCommercialCm'];
                $t['rafters'][$key] = ['section' => $b['section'], 'lengthCm' => $b['raftersCommercialCm'], 'count' => ($t['rafters'][$key]['count'] ?? 0) + $b['raftersCount']];
            }
            if ($b['ridgeMl'] > 0) {
                $t['ridge'][$b['section']] = ($t['ridge'][$b['section']] ?? 0.0) + $b['ridgeMl'];
            }
            foreach ($b['gableByThickness'] as $th => $m2) {
                $t['gableByThickness'][$th] = ($t['gableByThickness'][$th] ?? 0.0) + $m2;
            }
        }
        $t['ridgeMl'] = round($t['ridgeMl'], 2);
        $t['battenMl'] = round($t['battenMl'], 1);
        $t['coverM2'] = round($t['coverM2'], 2);
        $t['gableMasonryM2'] = round($t['gableMasonryM2'], 2);
        $t['rafters'] = array_values($t['rafters']);

        return $t;
    }

    /**
     * Piezas de bloque de los hastiales habilitados, para sumarlas al despiece: [nivel de apoyo, espesor en ticks, largos en ticks].
     *
     * @return list<array{level: int, t: int, pieces: list<int>}>
     */
    public function gablePieces(): array
    {
        $out = [];
        foreach ($this->parts as $p) {
            foreach ($p['geometry']['gables'] ?? [] as $g) {
                if ($g['enabled'] && [] !== $g['pieces']) {
                    $out[] = ['level' => $p['level'], 't' => (int) round($g['thickness'] * 20), 'pieces' => $g['pieces']];
                }
            }
        }

        return $out;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['parts' => $this->parts, 'issues' => $this->issues, 'bom' => $this->bom()];
    }
}
