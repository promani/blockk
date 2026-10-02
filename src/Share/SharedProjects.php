<?php

declare(strict_types=1);

namespace App\Share;

use App\Assistant\Store\KeyValueStore;

/**
 * Proyectos compartidos por enlace: el identificador (32 hexadecimales al azar) es la única credencial y quien lo tiene
 * puede ver y editar. Cada guardado sube la versión y renueva el vencimiento.
 */
final class SharedProjects
{
    /** Vencimiento desde el último guardado. */
    public const int TTL = 180 * 86400;

    public function __construct(private readonly KeyValueStore $store)
    {
    }

    public static function validId(string $id): bool
    {
        return 1 === preg_match('/^[a-f0-9]{32}$/', $id);
    }

    /** @param array<string, mixed> $project */
    public function create(array $project): string
    {
        $id = bin2hex(random_bytes(16));
        $this->store->set("share:{$id}", ['project' => $project, 'version' => 1, 'updated' => time()], self::TTL);

        return $id;
    }

    /** @return array{project: array<string, mixed>, version: int, updated: int}|null */
    public function get(string $id): ?array
    {
        if (!self::validId($id)) {
            return null;
        }
        $doc = $this->store->get("share:{$id}");

        return null === $doc ? null : ['project' => $doc['project'], 'version' => (int) $doc['version'], 'updated' => (int) $doc['updated']];
    }

    /**
     * Reemplaza el proyecto (gana el último que guarda). Devuelve la versión nueva o null si el enlace no existe.
     *
     * @param array<string, mixed> $project
     *
     * @return array{version: int, updated: int}|null
     */
    public function save(string $id, array $project): ?array
    {
        $doc = $this->get($id);
        if (null === $doc) {
            return null;
        }
        $saved = ['version' => $doc['version'] + 1, 'updated' => time()];
        $this->store->set("share:{$id}", ['project' => $project] + $saved, self::TTL);

        return $saved;
    }

    /** Límite de uso (por IP, por hora). */
    public function allow(string $key, int $limit): bool
    {
        return $this->store->hit("rl:share:{$key}", 3600, $limit);
    }
}
