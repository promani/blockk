<?php

declare(strict_types=1);

namespace App\Domain\Templates;

use App\Assistant\Store\KeyValueStore;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;

/**
 * Catálogo de tipologías modulares listas para usar. Todas las dimensiones van en la retícula de 12,5 cm
 * a ejes (pensadas en bloques de 62,5 cm; con Lika, 50 cm, el descarte sigue bajo el 4 %) y los vanos respetan las jambas mínimas. Las métricas (superficie,
 * bloques, descarte) se calculan con el mismo motor que el editor: no son datos cargados a mano.
 *
 * Además de las del código, hay modelos que se crean, editan y borran por la API de administración: se guardan en el
 * almacén clave-valor (Redis) y la Galería los muestra a todos junto a las demás.
 */
final class TemplateCatalog
{
    public const int MAX_CUSTOM = 100;
    private const string INDEX = 'gallery:index';
    private const int TTL = 10 * 365 * 86400;

    /** @var array<string, array<string, mixed>>|null */
    private ?array $custom = null;

    public function __construct(private readonly ProjectAnalyzer $analyzer = new ProjectAnalyzer(), private readonly ?KeyValueStore $store = null)
    {
    }

    public function name(string $slug): string
    {
        return $this->definitions()[$slug]['name'] ?? throw new \InvalidArgumentException("Plantilla desconocida: $slug");
    }

    public function isBuiltin(string $slug): bool
    {
        return isset($this->builtins()[$slug]);
    }

    /**
     * Modelos creados por la API: {slug, name, description, tags, project, updated}.
     *
     * @return array<string, array<string, mixed>>
     */
    public function customs(): array
    {
        if (null === $this->custom) {
            $this->custom = [];
            try {
                foreach ($this->store?->indexGet(self::INDEX, self::MAX_CUSTOM) ?? [] as $slug) {
                    $doc = $this->store->get("gallery:{$slug}");
                    if (null !== $doc) {
                        $this->custom[$slug] = $doc;
                    }
                }
            } catch (\Throwable) {
                // sin almacén disponible la Galería sigue mostrando las plantillas del código
            }
            ksort($this->custom);
        }

        return $this->custom;
    }

    /** Cambia cuando se crea, edita o borra un modelo: sirve para invalidar cachés de la Galería. */
    public function version(): string
    {
        return sha1(json_encode(array_map(static fn (array $d): array => [$d['slug'], $d['updated'] ?? 0], $this->customs()), JSON_THROW_ON_ERROR));
    }

    /**
     * @param array{slug: string, name: string, description: string, tags: list<string>, project: array<string, mixed>} $doc
     *
     * @throws \InvalidArgumentException si el slug es de una plantilla del código o se pasa del máximo
     */
    public function saveCustom(array $doc): void
    {
        if (null === $this->store) {
            throw new \LogicException('Sin almacén para guardar modelos.');
        }
        if ($this->isBuiltin($doc['slug'])) {
            throw new \InvalidArgumentException('Ese nombre es de una plantilla del código.');
        }
        if (!isset($this->customs()[$doc['slug']]) && count($this->customs()) >= self::MAX_CUSTOM) {
            throw new \InvalidArgumentException(sprintf('Se alcanzó el máximo de %d modelos.', self::MAX_CUSTOM));
        }
        $doc['updated'] = time();
        $this->store->set("gallery:{$doc['slug']}", $doc, self::TTL);
        $this->store->indexAdd(self::INDEX, $doc['slug'], (float) $doc['updated'], self::MAX_CUSTOM, self::TTL);
        $this->custom = null;
    }

    public function deleteCustom(string $slug): bool
    {
        if (null === $this->store || !isset($this->customs()[$slug])) {
            return false;
        }
        $this->store->delete("gallery:{$slug}");
        $this->store->indexRemove(self::INDEX, $slug);
        $this->custom = null;

        return true;
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
        $defs = $this->builtins();
        foreach ($this->customs() as $slug => $doc) {
            $defs[$slug] = ['name' => $doc['name'], 'description' => $doc['description'], 'tags' => $doc['tags'], 'build' => static fn (): array => $doc['project']];
        }

        return $defs;
    }

    /** @return array<string, array{name: string, description: string, tags: list<string>, build: \Closure}> */
    private function builtins(): array
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
            'casa-doble-planta-garaje' => [
                'name' => 'Casa de dos plantas con garaje (~234 m²)',
                'description' => 'Planta baja de 9,00 × 14,00 m: cocina, estar y comedor abiertos al norte, sala de cine, despensa, garaje con puerta doble, hall de entrada con escalera en U, lavabo, lavadero y escritorio, más un alfresco techado sobre tres pilares. Arriba, tres dormitorios (el principal con vestidor y baño en suite), baño, placards y un estar de distribución. Las puertas abren hacia adentro de cada ambiente.',
                'tags' => ['2 plantas', 'Vivienda familiar', '3 dormitorios', 'Garaje'],
                'build' => fn (): array => (new TemplateBuilder('Casa de dos plantas con garaje'))
                    ->shift(0, 20)   // lugar al norte para el alfresco
                    ->room(0, 0, 0, 72, 112, 20)
                    ->wall(0, 32, 32, 32, 112, 20)
                    ->wall(0, 0, 32, 32, 32, 10)
                    ->wall(0, 0, 44, 32, 44, 10)
                    ->wall(0, 18, 32, 18, 44, 10)
                    ->wall(0, 0, 68, 32, 68, 20)
                    ->wall(0, 62, 58, 62, 84, 10)
                    ->wall(0, 62, 58, 72, 58, 10)
                    ->wall(0, 62, 70, 72, 70, 10)
                    ->wall(0, 46, 84, 72, 84, 10)
                    ->wall(0, 46, 84, 46, 112, 10)
                    ->opening(0, 'V150', 'x', 0, 8)
                    ->opening(0, 'P150', 'x', 0, 40)                // estar → alfresco
                    ->opening(0, 'VG150', 'x', 0, 56)
                    ->opening(0, 'V100', 'y', 0, 12)
                    ->opening(0, 'VT62', 'y', 0, 35)
                    ->opening(0, 'V100', 'y', 0, 52)
                    ->opening(0, 'V125', 'y', 72, 8)
                    ->opening(0, 'V100', 'y', 72, 40)
                    ->opening(0, 'VT62', 'y', 72, 61)
                    ->opening(0, 'VT62', 'y', 72, 74)
                    ->opening(0, 'V125', 'y', 72, 90)
                    ->opening(0, 'V125', 'x', 112, 56)
                    ->opening(0, 'P87', 'x', 112, 36, flip: true)   // entrada: abre hacia adentro
                    ->opening(0, 'P150', 'x', 112, 8, flip: true)    // puerta doble del garaje
                    ->opening(0, 'P75', 'x', 32, 6)                 // despensa
                    ->opening(0, 'P75', 'y', 32, 35, flip: true)    // depósito
                    ->opening(0, 'P87', 'y', 32, 47, flip: true)    // sala de cine
                    ->opening(0, 'P87', 'y', 32, 96)                // garaje → hall
                    ->opening(0, 'P75', 'y', 62, 61)                // lavabo
                    ->opening(0, 'P75', 'y', 62, 74)                // lavadero
                    ->opening(0, 'P75', 'y', 46, 90)                // escritorio
                    ->stair(0, 46, 58, 'N', 'U')
                    ->column(0, 34, -18, 25)                          // alfresco: tres pilares sostienen el techo
                    ->column(0, 52, -18, 25)
                    ->column(0, 70, -18, 25)
                    ->label(0, 14, 14, 'Cocina')
                    ->label(0, 52, 16, 'Estar')
                    ->label(0, 46, 44, 'Comedor')
                    ->label(0, 9, 38, 'Despensa')
                    ->label(0, 25, 38, 'Depósito')
                    ->label(0, 16, 56, 'Sala de cine')
                    ->label(0, 16, 90, 'Garaje')
                    ->label(0, 38, 90, 'Hall')
                    ->label(0, 66, 64, 'Lavabo')
                    ->label(0, 66, 77, 'Lavadero')
                    ->label(0, 59, 98, 'Escritorio')
                    ->label(0, 52, -10, 'Alfresco')
                    ->upper()
                    ->room(1, 0, 0, 72, 112, 20)
                    ->wall(1, 0, 26, 72, 26, 10)
                    ->wall(1, 28, 0, 28, 26, 10)
                    ->wall(1, 36, 0, 36, 26, 10)
                    ->wall(1, 44, 0, 44, 26, 10)
                    ->wall(1, 0, 36, 28, 36, 10)
                    ->wall(1, 0, 54, 28, 54, 10)
                    ->wall(1, 0, 70, 28, 70, 10)
                    ->wall(1, 0, 88, 28, 88, 10)
                    ->wall(1, 28, 36, 28, 112, 10)
                    ->opening(1, 'V125', 'x', 0, 8)
                    ->opening(1, 'V125', 'x', 0, 52)
                    ->opening(1, 'V100', 'y', 72, 8)
                    ->opening(1, 'VT62', 'y', 0, 39)
                    ->opening(1, 'VT62', 'y', 0, 75)
                    ->opening(1, 'V100', 'y', 0, 92)
                    ->opening(1, 'V150', 'x', 112, 8)
                    ->opening(1, 'V150', 'y', 72, 40)
                    ->opening(1, 'V187', 'x', 112, 44)
                    ->opening(1, 'P75', 'x', 26, 8, flip: true)    // dormitorio 2
                    ->opening(1, 'P75', 'x', 26, 58, flip: true)   // dormitorio 3
                    ->opening(1, 'P75', 'y', 28, 8, flip: true)    // placard del dormitorio 2
                    ->opening(1, 'P75', 'y', 44, 8)                // placard del dormitorio 3
                    ->opening(1, 'P75', 'x', 36, 8)                // baño
                    ->opening(1, 'P75', 'x', 70, 8, flip: true)    // vestidor
                    ->opening(1, 'P75', 'x', 88, 8)                // baño en suite → dormitorio principal
                    ->opening(1, 'P87', 'y', 28, 94, flip: true)   // dormitorio principal
                    ->slab(1, 0, 0, 32, 112)
                    ->slab(1, 32, 0, 20, 112)
                    ->slab(1, 52, 0, 20, 112)
                    ->label(1, 12, 12, 'Dormitorio 2')
                    ->label(1, 31, 12, 'Placard')
                    ->label(1, 39, 12, 'Placard')
                    ->label(1, 58, 12, 'Dormitorio 3')
                    ->label(1, 12, 30, 'Pasillo')
                    ->label(1, 12, 44, 'Baño')
                    ->label(1, 12, 62, 'Vestidor')
                    ->label(1, 12, 78, 'Baño en suite')
                    ->label(1, 12, 100, 'Dormitorio principal')
                    ->label(1, 54, 46, 'Estar')
                    ->roofPart(1, 0, 0, 72, 112, 'gable', 'y', 30, '3x12')
                    ->roofPart(0, 32, -20, 40, 20, 'shed', 'N', 30, '3x8', more: ['gableA' => false, 'gableB' => false])
                    ->build(),
            ],
        ];
    }
}
