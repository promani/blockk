<?php

declare(strict_types=1);

namespace App\Assistant\Store;

final class StoreFactory
{
    public static function create(string $redisUrl, string $prefix, string $fallbackDir): KeyValueStore
    {
        return '' !== trim($redisUrl) ? new RedisStore($redisUrl, $prefix) : new FileStore($fallbackDir);
    }
}
