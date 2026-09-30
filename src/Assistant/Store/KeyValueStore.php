<?php

declare(strict_types=1);

namespace App\Assistant\Store;

/** Almacenamiento mínimo del asistente: documentos JSON con vencimiento, índices ordenados y contadores de uso. */
interface KeyValueStore
{
    /** @return array<string, mixed>|null */
    public function get(string $key): ?array;

    /** @param array<string, mixed> $value */
    public function set(string $key, array $value, int $ttl): void;

    /** Agrega (o actualiza el puntaje de) `$member` en el índice `$key`, conservando los `$keep` de mayor puntaje. */
    public function indexAdd(string $key, string $member, float $score, int $keep, int $ttl): void;

    /** @return list<string> miembros del índice, de mayor a menor puntaje */
    public function indexGet(string $key, int $limit): array;

    /** Suma un uso al contador `$key` (ventana de `$window` segundos). Devuelve false si ya se superó `$limit`. */
    public function hit(string $key, int $window, int $limit): bool;
}
