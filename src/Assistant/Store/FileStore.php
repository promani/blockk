<?php

declare(strict_types=1);

namespace App\Assistant\Store;

/** Respaldo en archivos (desarrollo y tests, o si no hay REDIS_URL): un JSON por clave en var/assistant. */
final class FileStore implements KeyValueStore
{
    public function __construct(private readonly string $dir)
    {
    }

    public function get(string $key): ?array
    {
        $entry = $this->read($key);

        return is_array($entry['value'] ?? null) ? $entry['value'] : null;
    }

    public function set(string $key, array $value, int $ttl): void
    {
        $this->write($key, ['value' => $value, 'expires' => time() + $ttl]);
    }

    public function indexAdd(string $key, string $member, float $score, int $keep, int $ttl): void
    {
        $index = $this->read($key)['value'] ?? [];
        $index[$member] = $score;
        arsort($index);
        $this->write($key, ['value' => array_slice($index, 0, $keep, true), 'expires' => time() + $ttl]);
    }

    public function indexGet(string $key, int $limit): array
    {
        $index = $this->read($key)['value'] ?? [];
        arsort($index);

        return array_map('strval', array_slice(array_keys($index), 0, $limit));
    }

    public function hit(string $key, int $window, int $limit): bool
    {
        $entry = $this->read($key);
        $n = (int) ($entry['value']['n'] ?? 0) + 1;
        $this->write($key, ['value' => ['n' => $n], 'expires' => $entry['expires'] ?? time() + $window]);

        return $n <= $limit;
    }

    /** @return array{value?: mixed, expires?: int}|null */
    private function read(string $key): ?array
    {
        $file = $this->file($key);
        if (!is_file($file)) {
            return null;
        }
        $entry = json_decode((string) file_get_contents($file), true);
        if (!is_array($entry) || ($entry['expires'] ?? 0) < time()) {
            @unlink($file);

            return null;
        }

        return $entry;
    }

    /** @param array<string, mixed> $entry */
    private function write(string $key, array $entry): void
    {
        if (!is_dir($this->dir)) {
            mkdir($this->dir, 0o775, true);
        }
        file_put_contents($this->file($key), json_encode($entry, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), LOCK_EX);
    }

    private function file(string $key): string
    {
        return $this->dir.'/'.sha1($key).'.json';
    }
}
