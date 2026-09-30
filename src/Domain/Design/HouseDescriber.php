<?php

declare(strict_types=1);

namespace App\Domain\Design;

use App\Domain\Hcca;

/**
 * Resumen compacto de una casa analizada, en metros y con los ids del proyecto: lo que el asistente «ve» para
 * explicarla y editarla, y las métricas de la tarjeta de la Galería.
 */
final class HouseDescriber
{
    /**
     * Totales, ambientes y observaciones (sin geometría).
     *
     * @param array{project: array<string, mixed>, analysis: array<string, mixed>} $result salida de ProjectAnalyzer::analyze
     * @param list<array<string, mixed>>                                          $names  ambientes con nombre del generador
     *
     * @return array<string, mixed>
     */
    public function summary(array $result, array $names = []): array
    {
        $a = $result['analysis'];
        $t = $a['telemetry']['total'];

        return [
            'nombre' => (string) ($result['project']['name'] ?? ''),
            'niveles' => $t['levelsUsed'],
            'superficieUtilM2' => $t['netM2'],
            'superficieCubiertaM2' => $t['grossM2'],
            'bloques' => $t['blocks'],
            'pallets' => $t['pallets'],
            'costoReferencia' => $t['cost'],
            'moneda' => $t['currency'],
            'ambientes' => $this->rooms($a, $names),
            'observaciones' => array_values(array_map(
                static fn (array $i): array => ['severidad' => $i['severity'], 'codigo' => $i['code'], 'mensaje' => $i['message'], 'ref' => $i['ref'] ?? null],
                array_filter($a['issues'], static fn (array $i): bool => 'info' !== $i['severity']),
            )),
        ];
    }

    /**
     * Todo lo anterior más muros, vanos y techos, para editar.
     *
     * @param array{project: array<string, mixed>, analysis: array<string, mixed>} $result
     * @param list<array<string, mixed>>                                          $names
     *
     * @return array<string, mixed>
     */
    public function describe(array $result, array $names = []): array
    {
        $p = $result['project'];
        $a = $result['analysis'];
        $out = $this->summary($result, $names);
        $out['lote'] = $p['lot'] ?? null;
        $out['norte'] = sprintf('a %d° del «arriba» del plano, en sentido horario (0 = arriba, 90 = derecha); x crece hacia la derecha e y hacia abajo. Coordenadas en metros.', (int) ($p['north'] ?? 0));
        $out['muros'] = [];
        $out['vanos'] = [];
        foreach ($p['levels'] as $li => $level) {
            $info = $a['levels'][$li]['walls'] ?? [];
            if ($li > 0 && !($p['upper'] ?? false)) {
                continue;
            }
            foreach ($level['walls'] as $w) {
                $ext = $info[$w['id']]['ext'] ?? null;
                $out['muros'][] = [
                    'id' => $w['id'],
                    'nivel' => $li + 1,
                    'desde' => [$this->m($w['x1']), $this->m($w['y1'])],
                    'hasta' => [$this->m($w['x2']), $this->m($w['y2'])],
                    'largo' => $this->m(abs($w['x2'] - $w['x1']) + abs($w['y2'] - $w['y1'])),
                    'espesorCm' => $w['t'],
                    'exterior' => is_array($ext) ? $this->facing($ext, (int) ($p['north'] ?? 0)) : null,
                ];
            }
            foreach ($level['openings'] as $o) {
                $out['vanos'][] = ['id' => $o['id'], 'nivel' => $li + 1, 'muro' => $o['wall'], 'tipo' => $o['preset'] ?? $o['kind'], 'desdeInicioDelMuro' => $this->m($o['pos']), 'ancho' => $this->m($o['w'])];
            }
        }
        $out['techos'] = array_map(static fn (array $r): array => ['id' => $r['id'], 'tipo' => 'shed' === $r['type'] ? 'un_agua' : 'dos_aguas', 'pendiente' => $r['slope'] ?? 30], $p['roofs'] ?? []);

        return $out;
    }

    /**
     * @param array<string, mixed>       $a
     * @param list<array<string, mixed>> $names
     *
     * @return list<array<string, mixed>>
     */
    private function rooms(array $a, array $names): array
    {
        $out = [];
        foreach ($a['levels'] as $li => $level) {
            foreach ($level['rooms'] ?? [] as $room) {
                $label = [];
                foreach ($names as $n) {
                    if ($n['nivel'] !== $li + 1) {
                        continue;
                    }
                    [$x, $y, $w, $h] = $n['rect'];
                    $cx = $x + $w / 2;
                    $cy = $y + $h / 2;
                    foreach ($room['fill'] ?? [] as [$fx, $fy, $fw, $fh]) {
                        if ($cx > $fx && $cx < $fx + $fw && $cy > $fy && $cy < $fy + $fh) {
                            $label[] = $n['nombre'];
                            break;
                        }
                    }
                }
                $b = $room['bbox'];
                $out[] = [
                    'id' => sprintf('N%d-A%d', $li + 1, $room['id']),
                    'nivel' => $li + 1,
                    'nombre' => [] !== $label ? implode(' + ', array_unique($label)) : null,
                    'm2' => $room['netM2'],
                    'caja' => [$this->m($b['x']), $this->m($b['y']), $this->m($b['w']), $this->m($b['h'])],
                ];
            }
        }

        // Sin nombres (plantillas, proyectos dibujados a mano): se infieren por tamaño, para que se pueda hablar de ellos.
        foreach ($out as $k => $r) {
            if (null !== $r['nombre']) {
                continue;
            }
            $sameLevel = array_filter($out, static fn (array $o): bool => $o['nivel'] === $r['nivel']);
            $largest = max(array_column($sameLevel, 'm2'));
            $out[$k]['nombre'] = match (true) {
                $r['m2'] === $largest && $r['m2'] >= 12 => 1 === $r['nivel'] ? 'Estar-comedor (probable)' : 'Hall o estar (probable)',
                $r['m2'] < 6.5 => 'Baño o servicio (probable)',
                default => 'Dormitorio (probable)',
            };
        }

        return $out;
    }

    /** @param array{0: int|float, 1: int|float} $ext */
    private function facing(array $ext, int $north): string
    {
        $bearing = rad2deg(atan2((float) $ext[0], -(float) $ext[1]));
        $rel = fmod(fmod($bearing - $north, 360) + 360, 360);

        return ['N', 'E', 'S', 'O'][((int) round($rel / 90)) % 4];
    }

    private function m(int|float $units): float
    {
        return round($units * Hcca::GRID_CM / 100, 3);
    }
}
