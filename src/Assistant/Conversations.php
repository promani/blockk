<?php

declare(strict_types=1);

namespace App\Assistant;

use App\Assistant\Store\KeyValueStore;

/**
 * Conversaciones y diseños guardados. Sin login: cada navegador tiene un id de cliente aleatorio y sólo ve lo suyo.
 */
final class Conversations
{
    public const int TTL = 60 * 86400; // 60 días

    public function __construct(private readonly KeyValueStore $store)
    {
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(12));
    }

    public static function validClient(string $client): bool
    {
        return 1 === preg_match('/^[a-f0-9]{16,64}$/', $client);
    }

    /** @return array<string, mixed>|null */
    public function find(string $id, string $client): ?array
    {
        if (1 !== preg_match('/^[a-f0-9]{24}$/', $id)) {
            return null;
        }
        $conv = $this->store->get("conv:{$id}");

        return null !== $conv && ($conv['client'] ?? null) === $client ? $conv : null;
    }

    /** @param array<string, mixed> $conv */
    public function save(array $conv): void
    {
        $conv['updated'] = time();
        $this->store->set("conv:{$conv['id']}", $conv, self::TTL);
    }

    /** @param array<string, mixed> $design {id, client, nombre, resumen, svg, project} */
    public function saveDesign(array $design): void
    {
        $design['updated'] = time();
        $this->store->set("design:{$design['id']}", $design, self::TTL);
    }

    /** @return array<string, mixed>|null */
    public function design(string $id, string $client): ?array
    {
        if (1 !== preg_match('/^[a-f0-9]{24}$/', $id)) {
            return null;
        }
        $d = $this->store->get("design:{$id}");

        return null !== $d && ($d['client'] ?? null) === $client ? $d : null;
    }

    /** Límite de uso: true si todavía hay cupo. */
    public function allow(string $key, int $window, int $limit): bool
    {
        return $this->store->hit("rl:{$key}", $window, $limit);
    }
}
