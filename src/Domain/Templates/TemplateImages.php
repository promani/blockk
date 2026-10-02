<?php

declare(strict_types=1);

namespace App\Domain\Templates;

use App\Domain\Hcca;

/**
 * Miniaturas pregeneradas de las plantillas (planta e isométrica con el dibujo del editor), en public/img/plantillas.
 * El nombre lleva un hash del proyecto, del sistema de bloques y de VERSION: si cambia la casa, las imágenes viejas
 * dejan de servir y `composer miniaturas` genera las nuevas. Subir VERSION cuando cambie el dibujo del editor.
 */
final class TemplateImages
{
    public const string VERSION = '10';
    public const string DIR = 'img/plantillas';
    public const array VIEWS = ['plan', 'iso'];

    public function __construct(private readonly string $publicDir = __DIR__.'/../../../public')
    {
    }

    /** @param array<string, mixed> $project */
    public static function hash(array $project): string
    {
        return substr(sha1(json_encode($project, JSON_THROW_ON_ERROR).'|'.Hcca::system()['id'].'|'.self::VERSION), 0, 10);
    }

    /**
     * @param array<string, mixed> $project
     *
     * @return array<string, string> vista → ruta pública
     */
    public static function paths(string $slug, array $project): array
    {
        $hash = self::hash($project);
        $out = [];
        foreach (self::VIEWS as $v) {
            $out[$v] = sprintf('%s/%s-%s-%s.webp', self::DIR, $slug, $hash, $v);
        }

        return $out;
    }

    /**
     * Rutas de las imágenes si están generadas y al día; si falta alguna, null (la Galería usa el SVG).
     *
     * @param array<string, mixed> $project
     *
     * @return array<string, string>|null
     */
    public function find(string $slug, array $project): ?array
    {
        $paths = self::paths($slug, $project);
        foreach ($paths as $p) {
            if (!is_file($this->publicDir.'/'.$p)) {
                return null;
            }
        }

        return $paths;
    }
}
