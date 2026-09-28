<?php

declare(strict_types=1);

namespace App\Domain\Templates;

use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;

/**
 * Catálogo de tipologías modulares listas para usar. Todas las dimensiones son múltiplos del módulo
 * de 62,5 cm (5 unidades) a ejes, y los vanos respetan las jambas mínimas. Las métricas (superficie,
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
            'quincho-5x3-75' => [
                'name' => 'Quincho modular 5,00 × 3,75 m',
                'description' => 'Un solo ambiente de 8 × 6 módulos con portón doble y tres ventanas. Ideal para parrilla, taller o depósito.',
                'tags' => ['1 planta', 'Quincho'],
                'build' => fn (): array => (new TemplateBuilder('Quincho modular'))
                    ->room(0, 0, 0, 40, 30)
                    ->opening(0, 'P150', 'x', 30, 14)
                    ->opening(0, 'V125', 'x', 0, 15)
                    ->opening(0, 'V150', 'y', 40, 9)
                    ->opening(0, 'V100', 'y', 0, 11)
                    ->build(),
            ],
            'casa-minima' => [
                'name' => 'Casa mínima 1 dormitorio',
                'description' => 'Dormitorio, baño y estar-cocina en 7,50 × 6,25 m. Tabiques de 10 cm sobre muros portantes de 20 cm.',
                'tags' => ['1 planta', 'Vivienda mínima'],
                'build' => fn (): array => (new TemplateBuilder('Casa mínima'))
                    ->room(0, 0, 0, 60, 50)
                    ->wall(0, 30, 0, 30, 50, 10)
                    ->wall(0, 0, 25, 30, 25, 10)
                    ->opening(0, 'P100', 'x', 50, 40)
                    ->opening(0, 'V187', 'x', 0, 38)
                    ->opening(0, 'V125', 'x', 0, 10)
                    ->opening(0, 'V125', 'y', 60, 20)
                    ->opening(0, 'VT62', 'y', 0, 35)
                    ->opening(0, 'P87', 'y', 30, 8)
                    ->opening(0, 'P75', 'y', 30, 32)
                    ->build(),
            ],
            'vivienda-2-dormitorios' => [
                'name' => 'Vivienda 2 dormitorios (~60 m²)',
                'description' => 'Dos dormitorios y baño al norte, estar-comedor-cocina al sur en 9,38 × 6,88 m. Distribuidor por tabique de 10 cm.',
                'tags' => ['1 planta', 'Vivienda 60 m²'],
                'build' => fn (): array => (new TemplateBuilder('Vivienda 2 dormitorios'))
                    ->room(0, 0, 0, 75, 55)
                    ->wall(0, 0, 25, 75, 25, 10)
                    ->wall(0, 25, 0, 25, 25, 10)
                    ->wall(0, 40, 0, 40, 25, 10)
                    ->opening(0, 'P87', 'x', 25, 8)
                    ->opening(0, 'P75', 'x', 25, 30)
                    ->opening(0, 'P87', 'x', 25, 48)
                    ->opening(0, 'P100', 'x', 55, 30)
                    ->opening(0, 'V125', 'x', 0, 8)
                    ->opening(0, 'VT62', 'x', 0, 30)
                    ->opening(0, 'V125', 'x', 0, 52)
                    ->opening(0, 'V187', 'x', 55, 8)
                    ->opening(0, 'V150', 'x', 55, 50)
                    ->opening(0, 'V125', 'y', 0, 35)
                    ->opening(0, 'V125', 'y', 75, 35)
                    ->build(),
            ],
            'duplex-2-plantas' => [
                'name' => 'Dúplex 2 plantas',
                'description' => 'PB + PA de 7,50 × 5,00 m con muro portante central y entrepiso de tirantes de 3,75 m de luz. Hueco de escalera previsto.',
                'tags' => ['2 plantas', 'Dúplex', 'Luz libre modulada'],
                'build' => fn (): array => (new TemplateBuilder('Dúplex 2 plantas'))
                    ->room(0, 0, 0, 60, 40)
                    ->wall(0, 30, 0, 30, 40, 15)
                    ->opening(0, 'P100', 'x', 40, 10)
                    ->opening(0, 'V150', 'x', 40, 40)
                    ->opening(0, 'V125', 'x', 0, 8)
                    ->opening(0, 'V125', 'x', 0, 42)
                    ->opening(0, 'P100', 'y', 30, 20)
                    ->joists(0, 0, 30, 30, 'x')
                    ->joists(30, 0, 30, 40, 'x')
                    ->room(1, 0, 0, 60, 40)
                    ->wall(1, 30, 0, 30, 40, 15)
                    ->wall(1, 30, 15, 60, 15, 10)
                    ->opening(1, 'V125', 'x', 0, 8)
                    ->opening(1, 'V100', 'x', 0, 42)
                    ->opening(1, 'V150', 'x', 40, 8)
                    ->opening(1, 'V125', 'x', 40, 42)
                    ->opening(1, 'P87', 'y', 30, 22)
                    ->opening(1, 'P75', 'x', 15, 40)
                    ->build(),
            ],
            'vivienda-evolutiva' => [
                'name' => 'Vivienda evolutiva (PB + PA parcial)',
                'description' => 'Planta baja completa con muros y entrepiso preparados para crecer: la planta alta se construye hoy sobre la mitad izquierda y se amplía después.',
                'tags' => ['2 plantas', 'Vivienda evolutiva'],
                'build' => fn (): array => (new TemplateBuilder('Vivienda evolutiva'))
                    ->room(0, 0, 0, 60, 40)
                    ->wall(0, 30, 0, 30, 40, 15)
                    ->wall(0, 40, 0, 40, 20, 10)
                    ->wall(0, 40, 20, 60, 20, 10)
                    ->opening(0, 'P100', 'x', 40, 10)
                    ->opening(0, 'V150', 'x', 40, 42)
                    ->opening(0, 'V125', 'x', 0, 8)
                    ->opening(0, 'V100', 'x', 0, 46)
                    ->opening(0, 'P100', 'y', 30, 20)
                    ->opening(0, 'P75', 'y', 40, 6)
                    ->joists(0, 0, 30, 40, 'x')
                    ->wall(1, 0, 0, 30, 0, 20)
                    ->wall(1, 0, 0, 0, 40, 20)
                    ->wall(1, 0, 40, 30, 40, 20)
                    ->wall(1, 30, 0, 30, 40, 15)
                    ->opening(1, 'V125', 'x', 0, 8)
                    ->opening(1, 'V125', 'x', 40, 8)
                    ->opening(1, 'V100', 'y', 0, 16)
                    ->build(),
            ],
        ];
    }
}
