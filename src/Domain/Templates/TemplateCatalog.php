<?php

declare(strict_types=1);

namespace App\Domain\Templates;

use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;

/**
 * Catálogo de tipologías modulares listas para usar. Todas las dimensiones van en la retícula de 12,5 cm
 * a ejes (pensadas en bloques de 62,5 cm; con Lika, 50 cm, el descarte sigue bajo el 4 %) y los vanos respetan las jambas mínimas. Las métricas (superficie,
 * bloques, descarte) se calculan con el mismo motor que el editor: no son datos cargados a mano.
 */
final class TemplateCatalog
{
    public function __construct(private readonly ProjectAnalyzer $analyzer = new ProjectAnalyzer())
    {
    }

    /** @return list<array<string, mixed>> */
    public function all(): array
    {
        return array_map(fn (string $slug): array => $this->summary($slug), array_keys($this->definitions()));
    }

    /** @return list<string> */
    public function slugs(): array
    {
        return array_keys($this->definitions());
    }

    public function has(string $slug): bool
    {
        return isset($this->definitions()[$slug]);
    }

    /** @return array<string, mixed> proyecto en formato JSON del cliente */
    public function project(string $slug): array
    {
        $def = $this->definitions()[$slug] ?? throw new \InvalidArgumentException("Plantilla desconocida: $slug");

        return ($def['build'])();
    }

    /** @return array<string, mixed> */
    public function summary(string $slug): array
    {
        $def = $this->definitions()[$slug] ?? throw new \InvalidArgumentException("Plantilla desconocida: $slug");
        $result = $this->analyzer->analyze(ProjectFactory::fromArray($this->project($slug)));
        $t = $result['analysis']['telemetry'];
        $errors = count(array_filter($result['analysis']['issues'], static fn (array $i): bool => 'error' === $i['severity']));
        $tags = $def['tags'];
        if ($t['total']['scrapPct'] < 3.5) {
            $tags[] = 'Bajo descarte';
        }

        return [
            'slug' => $slug,
            'name' => $def['name'],
            'description' => $def['description'],
            'tags' => $tags,
            'levels' => $t['total']['levelsUsed'],
            'netM2' => $t['total']['netM2'],
            'grossM2' => $t['total']['grossM2'],
            'blocks' => $t['total']['blocks'],
            'pallets' => $t['total']['pallets'],
            'scrapPct' => $t['total']['scrapPct'],
            'cutBlocksPct' => $t['total']['cutBlocksPct'],
            'cost' => $t['total']['cost'],
            'currency' => $t['total']['currency'],
            'errors' => $errors,
            'project' => $result['project'],
        ];
    }

    /** @return array<string, array{name: string, description: string, tags: list<string>, build: \Closure}> */
    private function definitions(): array
    {
        return [
            'casa-en-l' => [
                'name' => 'Casa en L 3 dormitorios (~75 m²)',
                'description' => 'Cuerpo principal de 11,25 × 5,63 m con estar-comedor-cocina abierto al norte, dos dormitorios y baño, más un ala de 3,75 × 4,38 m con el dormitorio principal. Dos techos a dos aguas que se cruzan.',
                'tags' => ['1 planta', 'Vivienda en L', '3 dormitorios'],
                'build' => fn (): array => (new TemplateBuilder('Casa en L'))
                    ->room(0, 0, 0, 90, 45)
                    ->wall(0, 60, 45, 60, 80, 20)
                    ->wall(0, 60, 80, 90, 80, 20)
                    ->wall(0, 90, 45, 90, 80, 20)
                    ->wall(0, 30, 0, 30, 45, 10)
                    ->wall(0, 0, 25, 30, 25, 10)
                    ->wall(0, 45, 0, 45, 13, 10)
                    ->wall(0, 30, 13, 45, 13, 10)
                    ->opening(0, 'P100', 'x', 45, 40)
                    ->opening(0, 'P87', 'x', 45, 66)
                    ->opening(0, 'P75', 'y', 30, 16)
                    ->opening(0, 'P75', 'y', 30, 33)
                    ->opening(0, 'P75', 'x', 13, 36)
                    ->opening(0, 'V125', 'x', 0, 10)
                    ->opening(0, 'VT62', 'x', 0, 35)
                    ->opening(0, 'VG150', 'x', 0, 55)
                    ->opening(0, 'V125', 'x', 0, 72)
                    ->opening(0, 'V125', 'y', 0, 30)
                    ->opening(0, 'V150', 'y', 90, 16)
                    ->opening(0, 'V125', 'y', 90, 58)
                    ->opening(0, 'V125', 'x', 80, 70)
                    ->opening(0, 'V100', 'y', 60, 58)
                    ->roofPart(0, 0, 0, 90, 45, 'gable', 'x')
                    // El techo del ala entra en el cuerpo principal hasta que su cumbrera toca el faldón grande (limahoya): sin
                    // hastial de ese lado, que quedaría asomando sobre la cubierta.
                    ->roofPart(0, 60, 30, 30, 50, 'gable', 'y', more: ['gableA' => false])
                    ->build(),
            ],
            'vivienda-evolutiva' => [
                'name' => 'Vivienda evolutiva (PB + PA parcial)',
                'description' => 'Planta baja de 8,00 × 5,00 m con estar, cocina-comedor y baño; escalera en U y un dormitorio en la planta alta sobre la mitad izquierda, lista para ampliarse. La parte baja se cubre con un techo a un agua que apoya contra la pared de la planta alta.',
                'tags' => ['2 plantas', 'Vivienda evolutiva', 'Escalera en U'],
                'build' => fn (): array => (new TemplateBuilder('Vivienda evolutiva'))
                    ->room(0, 0, 0, 64, 40)
                    ->wall(0, 32, 0, 32, 40, 20)
                    ->wall(0, 48, 24, 64, 24, 10)
                    ->wall(0, 48, 24, 48, 40, 10)
                    ->opening(0, 'V150', 'x', 0, 8)
                    ->opening(0, 'V125', 'x', 0, 44)
                    ->opening(0, 'P100', 'x', 40, 36)
                    ->opening(0, 'VT62', 'x', 40, 54)
                    ->opening(0, 'V100', 'y', 0, 16)
                    ->opening(0, 'V100', 'y', 64, 8)
                    ->opening(0, 'P87', 'y', 32, 3)
                    ->opening(0, 'P75', 'y', 48, 28)
                    ->stair(0, 14, 12, 'N', 'U')
                    ->room(1, 0, 0, 32, 40)
                    ->opening(1, 'V125', 'x', 0, 10)
                    ->opening(1, 'V100', 'y', 0, 16)
                    ->opening(1, 'V100', 'x', 40, 4)
                    ->slab(1, 0, 0, 32, 40)
                    ->upper()
                    ->roofPart(1, 0, 0, 32, 40, 'gable', 'y', 30, '3x8')
                    ->roofPart(0, 32, 0, 32, 40, 'shed', 'E', 30, '3x10')
                    ->build(),
            ],
        ];
    }
}
