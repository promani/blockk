<?php

declare(strict_types=1);

namespace App\Assistant\Store;

use Predis\Client;
use Predis\ClientInterface;

/** Redis (el del laboratorio): todas las claves llevan el prefijo del proyecto. */
final class RedisStore implements KeyValueStore
{
    private ClientInterface $redis;

    public function __construct(string $url, string $prefix, ?ClientInterface $client = null)
    {
        $this->redis = $client ?? new Client($url, ['prefix' => $prefix, 'timeout' => 3.0, 'read_write_timeout' => 5.0]);
    }

    public function get(string $key): ?array
    {
        $raw = $this->redis->get($key);
        if (!is_string($raw)) {
            return null;
        }
        $data = json_decode($raw, true);

        return is_array($data) ? $data : null;
    }

    public function set(string $key, array $value, int $ttl): void
    {
        $this->redis->setex($key, $ttl, json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    public function indexAdd(string $key, string $member, float $score, int $keep, int $ttl): void
    {
        $this->redis->zadd($key, [$member => $score]);
        $this->redis->zremrangebyrank($key, 0, -($keep + 1));
        $this->redis->expire($key, $ttl);
    }

    public function indexGet(string $key, int $limit): array
    {
        return array_values(array_map('strval', $this->redis->zrevrange($key, 0, $limit - 1)));
    }

    public function hit(string $key, int $window, int $limit): bool
    {
        $n = (int) $this->redis->incr($key);
        if (1 === $n) {
            $this->redis->expire($key, $window);
        }

        return $n <= $limit;
    }
}
