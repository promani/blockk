<?php

declare(strict_types=1);

namespace App\Domain\Bom;

use App\Domain\Cutting\CutPlan;
use App\Domain\Cutting\CutPlanner;
use App\Domain\Geometry\NodeType;
use App\Domain\Geometry\Topology;
use App\Domain\Hcca;
use App\Domain\Masonry\CourseModel;
use App\Domain\Masonry\PieceKind;
use App\Domain\Model\Project;
use App\Domain\Timber\TimberPlan;

/**
 * Cómputo métrico y despiece constructivo (BOM).
 *
 * Cada nivel se computa por separado (informativo) y el TOTAL de obra vuelve a optimizar los cortes
 * con todas las piezas juntas, de modo que los remanentes también se reaprovechan entre niveles.
 * Todas las cantidades salen del despiece real (pieza por pieza), no de superficies estimadas.
 */
final class BomCalculator
{
    private const float BLOCK_M3_FACTOR = 0.625 * 0.25; // m² de la cara de un bloque; × espesor (m) = m³

    /**
     * @param list<CourseModel> $models      despiece por nivel
     * @param list<Topology>    $topologies  topología por nivel (mismo orden)
     *
     * @return array<string, mixed>
     */
    public function calculate(Project $project, array $models, array $topologies, TimberPlan $timber, array $extras = []): array
    {
        $pct = $project->settings->reservePct;
        $levels = [];
        // Piezas de los hastiales de bloque de los techos: entran al despiece del nivel donde apoyan y al total.
        $gables = $extras['gables'] ?? [];
        foreach ($models as $i => $model) {
            $levels[] = $this->scope([$model], [$topologies[$i]], $pct, !$project->level($i)->isEmpty(), array_values(array_filter($gables, static fn (array $g): bool => $g['level'] === $i)));
        }
        $used = array_values(array_filter($models, static fn (CourseModel $m, int $i): bool => !$project->level($i)->isEmpty(), ARRAY_FILTER_USE_BOTH));
        $usedTopo = array_values(array_filter($topologies, static fn (Topology $t, int $i): bool => !$project->level($i)->isEmpty(), ARRAY_FILTER_USE_BOTH));
        $total = $this->scope($used, $usedTopo, $pct, [] !== $used || [] !== $gables, $gables);

        $lines = $this->lines($total, $timber, $project, $extras);
        $cost = array_sum(array_map(static fn (array $l): float => $l['subtotal'], $lines));

        return [
            'reservePct' => $pct,
            'currency' => $project->settings->currency,
            'levels' => $levels,
            'total' => $total,
            'timber' => $timber->bom,
            'lines' => $lines,
            'totalCost' => round($cost, 2),
            'comparison' => $this->comparison($total),
        ];
    }

    /**
     * @param list<CourseModel> $models
     * @param list<Topology>    $topologies
     *
     * @return array<string, mixed>
     */
    /** @param list<array{level: int, t: int, pieces: list<int>}> $gables */
    private function scope(array $models, array $topologies, int $reservePct, bool $used, array $gables = []): array
    {
        /** @var array<string, array{kind: PieceKind, t: int, full: int, cuts: list<int>, groups: array<int, list<int>>, lengthTicks: int}> $stats */
        $stats = [];
        $areaByT = []; // ticks² de cara de muro por espesor
        $levelingM3 = 0.0;
        $concreteM3 = 0.0;
        $d8M = 0.0;
        $d10M = 0.0;
        $pieceCount = 0;
        $cutPieceCount = 0;

        foreach ($models as $mi => $model) {
            foreach ($model->pieces() as [$course, $run, $piece]) {
                $key = $piece->kind->value.':'.$run->t;
                $stats[$key] ??= ['kind' => $piece->kind, 't' => $run->t, 'full' => 0, 'cuts' => [], 'groups' => [], 'lengthTicks' => 0];
                $len = $piece->length();
                ++$pieceCount;
                $stats[$key]['lengthTicks'] += $len;
                if ($piece->isFull()) {
                    ++$stats[$key]['full'];
                } else {
                    $stats[$key]['cuts'][] = $len;
                    $stats[$key]['groups'][$mi][] = $len;
                    ++$cutPieceCount;
                }
                $areaByT[$run->t] = ($areaByT[$run->t] ?? 0) + $len * Hcca::BLOCK_H;
                if (0 === $course) {
                    $levelingM3 += ($len / 2000) * ($run->t / 2000) * (Hcca::LEVELING_THICKNESS_CM / 100);
                }
                if (PieceKind::U === $piece->kind) {
                    $concreteM3 += ($len / 2000) * (Hcca::uChannelWidthCm($run->t) / 100) * (Hcca::U_CHANNEL_DEPTH_CM / 100);
                    if ('crown' === $piece->role) {
                        $d10M += 2 * $len / 2000;
                    } else {
                        $d8M += 2 * $len / 2000;
                    }
                }
            }
        }

        foreach ($gables as $g) {
            $key = PieceKind::Block->value.':'.$g['t'];
            $stats[$key] ??= ['kind' => PieceKind::Block, 't' => $g['t'], 'full' => 0, 'cuts' => [], 'groups' => [], 'lengthTicks' => 0];
            foreach ($g['pieces'] as $len) {
                ++$pieceCount;
                $stats[$key]['lengthTicks'] += $len;
                $areaByT[$g['t']] = ($areaByT[$g['t']] ?? 0) + $len * Hcca::BLOCK_H;
                if ($len >= Hcca::BLOCK_L) {
                    ++$stats[$key]['full'];
                } else {
                    $stats[$key]['cuts'][] = $len;
                    $stats[$key]['groups']['roof'.$g['level']][] = $len;
                    ++$cutPieceCount;
                }
            }
        }

        ksort($stats);
        $blocks = [];
        $stock = 0;
        $cutBlocks = 0;
        $scrapTicks = 0;
        $noReuse = 0;
        foreach ($stats as $key => $s) {
            // Los remanentes se reaprovechan entre niveles, pero nunca a costa de usar más bloques que por separado.
            $plan = CutPlanner::planBest(array_values($s['groups']));
            $item = $this->blockItem($key, $s, $plan, $reservePct);
            $blocks[] = $item;
            $stock += $item['stock'];
            $cutBlocks += $plan->blocks();
            $scrapTicks += $plan->scrapTicks();
            $noReuse += $s['full'] + count($s['cuts']);
        }

        $adhesiveKg = 0.0;
        $wallAreaM2 = 0.0;
        $quickStock = 0;
        foreach ($areaByT as $t => $ticks2) {
            $m2 = $ticks2 / 4_000_000;
            $wallAreaM2 += $m2;
            $adhesiveKg += $m2 * Hcca::adhesiveRate($t);
            $quickStock += (int) ceil($m2 / self::BLOCK_M3_FACTOR * 1.05);
        }
        $levelingKg = $levelingM3 * Hcca::LEVELING_DENSITY;

        $wallLengthTicks = 0;
        $anchors = 0;
        foreach ($topologies as $topo) {
            foreach ($topo->level->walls as $w) {
                $wallLengthTicks += $w->lengthTicks();
            }
            $anchors += $topo->count(NodeType::Tee) * Hcca::ANCHORS_PER_TEE + $topo->count(NodeType::Cross) * Hcca::ANCHORS_PER_CROSS;
        }

        return [
            'used' => $used,
            'wallLengthM' => round($wallLengthTicks / 2000, 2),
            'wallAreaM2' => round($wallAreaM2, 2),
            'blocks' => $blocks,
            'mortar' => [
                'adhesiveKg' => round($adhesiveKg, 1),
                'adhesiveBags' => (int) ceil($adhesiveKg / Hcca::BAG_KG),
                'levelingKg' => round($levelingKg, 1),
                'levelingBags' => (int) ceil($levelingKg / Hcca::BAG_KG),
            ],
            'concreteM3' => round($concreteM3, 2),
            'rebar' => [
                'd8M' => round($d8M, 1),
                'd8Kg' => round($d8M * Hcca::REBAR8_KG_M, 1),
                'd10M' => round($d10M, 1),
                'd10Kg' => round($d10M * Hcca::REBAR10_KG_M, 1),
            ],
            'anchors' => $anchors,
            'pieces' => ['total' => $pieceCount, 'cut' => $cutPieceCount, 'cutPct' => $pieceCount > 0 ? round(100 * $cutPieceCount / $pieceCount, 1) : 0.0],
            'stock' => $stock,
            'cutBlocks' => $cutBlocks,
            'cutBlocksPct' => $stock > 0 ? round(100 * $cutBlocks / $stock, 1) : 0.0,
            'scrapPct' => $stock > 0 ? round(100 * $scrapTicks / ($stock * Hcca::BLOCK_L), 2) : 0.0,
            'noReuseStock' => $noReuse,
            'quickStock' => $quickStock,
        ];
    }

    /**
     * @param array{kind: PieceKind, t: int, full: int, cuts: list<int>, groups: array<int, list<int>>, lengthTicks: int} $s
     *
     * @return array<string, mixed>
     */
    private function blockItem(string $key, array $s, CutPlan $plan, int $reservePct): array
    {
        $tCm = Hcca::ticksToCm($s['t']);
        $isU = PieceKind::U === $s['kind'];
        $stock = $s['full'] + $plan->blocks();
        $reserve = (int) ceil($stock * $reservePct / 100);
        $order = $stock + $reserve;
        $unitM3 = self::BLOCK_M3_FACTOR * $tCm / 100;
        $capacity = Hcca::palletCapacity($isU ? 'U' : 'B', $s['t']);
        $label = $isU
            ? sprintf('Bloque U HCCA 62,5 × 25 × %s cm (dinteles y encadenado)', $this->num($tCm))
            : sprintf('%s HCCA 62,5 × 25 × %s cm', $tCm >= 15 ? 'Bloque portante' : 'Tabique', $this->num($tCm));

        return [
            'code' => ($isU ? 'U' : 'B').$this->num($tCm),
            'kind' => $s['kind']->value,
            'tCm' => $tCm,
            'label' => $label,
            'pieces' => $s['full'] + count($s['cuts']),
            'full' => $s['full'],
            'cutPieces' => count($s['cuts']),
            'cutBlocks' => $plan->blocks(),
            'stock' => $stock,
            'reserve' => $reserve,
            'order' => $order,
            'unitM3' => round($unitM3, 5),
            'volumeM3' => round($order * $unitM3, 2),
            'pallets' => [
                'capacity' => $capacity,
                'full' => intdiv($order, $capacity),
                'loose' => $order % $capacity,
                'total' => (int) ceil($order / $capacity),
            ],
            'scrapPct' => $plan->blocks() > 0 ? round(100 * $plan->scrapTicks() / $plan->stockTicks(), 2) : 0.0,
            'patterns' => array_slice($plan->patterns(), 0, 12),
        ];
    }

    /**
     * Líneas comerciales valorizadas (precios editables de referencia).
     *
     * @param array<string, mixed> $total
     * @param array<string, array<string, mixed>> $extras cantidades de escaleras, losas y techo
     *
     * @return list<array<string, mixed>>
     */
    private function lines(array $total, TimberPlan $timber, Project $project, array $extras = []): array
    {
        $prices = $project->settings->effectivePrices();
        $lines = [];
        $add = static function (string $group, string $code, string $desc, string $unit, float|int $qty, float $unitPrice, string $note = '') use (&$lines): void {
            // El precio unitario se cotiza en centavos y el subtotal se calcula con ese mismo valor:
            // así cantidad × precio unitario coincide siempre con lo que el usuario ve en la planilla.
            $unitPrice = round($unitPrice, 2);
            $lines[] = [
                'group' => $group,
                'code' => $code,
                'desc' => $desc,
                'unit' => $unit,
                'qty' => $qty,
                'unitPrice' => $unitPrice,
                'subtotal' => round($qty * $unitPrice, 2),
                'note' => $note,
            ];
        };

        foreach ($total['blocks'] as $b) {
            $priceM3 = 'U' === $b['kind'] ? $prices['ublock_m3'] : $prices['block_m3'];
            $p = $b['pallets'];
            $note = sprintf('%d pallet(s) completo(s)%s · %s m³', $p['full'], $p['loose'] > 0 ? " + {$p['loose']} u sueltas" : '', $this->fmt($b['volumeM3']));
            $add('Mampostería HCCA', $b['code'], $b['label'], 'u', $b['order'], $priceM3 * $b['unitM3'], $note);
        }
        $m = $total['mortar'];
        if ($m['adhesiveBags'] > 0) {
            $add('Morteros', 'MAD', 'Mortero adhesivo de junta delgada (bolsa 25 kg)', 'bolsa', $m['adhesiveBags'], $prices['adhesive_bag'], $this->fmt($m['adhesiveKg']).' kg (2–3 mm, llana dentada)');
            $add('Morteros', 'MNI', 'Mortero cementicio de nivelación 1.ª hilada (bolsa 25 kg)', 'bolsa', $m['levelingBags'], $prices['leveling_bag'], $this->fmt($m['levelingKg']).' kg');
        }
        if ($total['concreteM3'] > 0) {
            $add('Hormigón y armadura', 'HOR', 'Hormigón in situ para relleno de bloques U', 'm³', max(0.01, $total['concreteM3']), $prices['concrete_m3']);
            $add('Hormigón y armadura', 'HD8', 'Hierro Ø8 mm (dinteles y vigas U)', 'kg', $total['rebar']['d8Kg'], $prices['rebar8_kg'], $this->fmt($total['rebar']['d8M']).' m');
            $add('Hormigón y armadura', 'HD10', 'Hierro Ø10 mm (encadenado superior)', 'kg', $total['rebar']['d10Kg'], $prices['rebar10_kg'], $this->fmt($total['rebar']['d10M']).' m');
        }
        if ($total['anchors'] > 0) {
            $add('Accesorios', 'ANC', 'Anclaje metálico (planchuela) para encuentros en T / cruz', 'u', $total['anchors'], $prices['anchor_u'], 'uno cada 2 hiladas');
        }

        foreach ($timber->bom['pieces'] ?? [] as $section => $byLength) {
            $priceM = $prices['timber_'.$section.'_m'];
            foreach ($byLength as $lengthCm => $qty) {
                $add('Estructura de madera', 'T'.$section.'-'.$lengthCm, 'Tirante '.Hcca::timberSections()[$section]['label'].' de '.$this->fmt($lengthCm / 100).' m', 'u', $qty, $priceM * $lengthCm / 100);
            }
        }
        foreach ($timber->bom['cenefaMl'] ?? [] as $section => $ml) {
            if ($ml > 0) {
                $add('Estructura de madera', 'CEN-'.$section, 'Cenefa perimetral '.$section.' (cierre de tirantes)', 'm', (float) ceil($ml), $prices['timber_'.$section.'_m']);
            }
        }
        if (($timber->bom['osbSheets'] ?? 0) > 0) {
            $add('Estructura de madera', 'OSB', 'Placa de entrepiso OSB 18 mm 1,22 × 2,44 m', 'placa', $timber->bom['osbSheets'], $prices['osb_sheet'], $this->fmt($timber->bom['osbM2']).' m² + 10 %');
        }
        if (($timber->bom['elasticBandMl'] ?? 0) > 0) {
            $add('Estructura de madera', 'BEL', 'Banda elástica de apoyo de tirantes', 'm', $timber->bom['elasticBandMl'], $prices['elastic_band_m']);
        }
        if (($timber->bom['plates'] ?? 0) > 0) {
            $add('Estructura de madera', 'PLR', 'Placa de reparto de carga bajo apoyo de viga', 'u', $timber->bom['plates'], $prices['plate_u']);
        }

        $st = $extras['stairs'] ?? [];
        if (($st['steps'] ?? 0) > 0) {
            $add('Escaleras', 'ESC', 'Peldaños de escalera (hormigón/madera, ref.)', 'u', $st['steps'], $prices['stair_step_u'], 'altura 3,00 m entre pisos');
        }
        if (($st['landingM2'] ?? 0) > 0) {
            $add('Escaleras', 'DES', 'Descansos de escalera', 'm²', $st['landingM2'], $prices['stair_landing_m2']);
        }
        $sl = $extras['slabs'] ?? [];
        if (($sl['areaM2'] ?? 0) > 0) {
            $add('Losa de piso', 'LHO', 'Hormigón de losa', 'm³', max(0.01, $sl['concreteM3']), $prices['concrete_m3'], $this->fmt($sl['areaM2']).' m²');
            $add('Losa de piso', 'LML', 'Malla electrosoldada (+10 % solape)', 'm²', $sl['meshM2'], $prices['mesh_m2']);
            $add('Losa de piso', 'LEN', 'Encofrado de losa', 'm²', $sl['formworkM2'], $prices['formwork_m2']);
        }
        $rf = $extras['roof'] ?? [];
        foreach ($rf['rafters'] ?? [] as $r) {
            $add('Techo', 'CAB-'.$r['section'].'-'.$r['lengthCm'], 'Cabios '.Hcca::timberSections()[$r['section']]['label'].' de '.$this->fmt($r['lengthCm'] / 100).' m', 'u', $r['count'], $prices['timber_'.$r['section'].'_m'] * $r['lengthCm'] / 100);
        }
        foreach ($rf['ridge'] ?? [] as $section => $ml) {
            $add('Techo', 'CUM-'.$section, 'Cumbrera '.Hcca::timberSections()[$section]['label'], 'm', (float) ceil($ml), $prices['timber_'.$section.'_m']);
        }
        if (($rf['battenMl'] ?? 0) > 0) {
            $add('Techo', 'CLA', 'Clavaderas / correas (40 cm)', 'm', (float) ceil($rf['battenMl']), $prices['batten_m']);
            $add('Techo', 'CUB', 'Cubierta (chapa o teja, ref.)', 'm²', $rf['coverM2'], $prices['roof_cover_m2']);
        }

        return $lines;
    }

    /**
     * Comparativas de referencia: sin reaprovechar remanentes y cómputo rápido por superficie (+5 %).
     *
     * @param array<string, mixed> $total
     *
     * @return array<string, mixed>
     */
    private function comparison(array $total): array
    {
        return [
            'engineStock' => $total['stock'],
            'noReuseStock' => $total['noReuseStock'],
            'savedBlocks' => $total['noReuseStock'] - $total['stock'],
            'savedPct' => $total['noReuseStock'] > 0 ? round(100 * ($total['noReuseStock'] - $total['stock']) / $total['noReuseStock'], 1) : 0.0,
            'quickAreaStock' => $total['quickStock'],
        ];
    }

    private function num(float $v): string
    {
        return rtrim(rtrim(number_format($v, 1, '.', ''), '0'), '.');
    }

    private function fmt(float|int $v): string
    {
        return number_format((float) $v, 2, ',', '.');
    }
}
