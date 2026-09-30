<?php

declare(strict_types=1);

namespace App\Tests\Assistant;

use App\Assistant\Store\RedisStore;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Contra un Redis real si hay REDIS_TEST_URL (p. ej. redis://127.0.0.1:6379); si no, se omite. */
final class RedisStoreTest extends TestCase
{
    private RedisStore $store;

    protected function setUp(): void
    {
        $url = getenv('REDIS_TEST_URL');
        if (false === $url || '' === $url) {
            self::markTestSkipped('Sin REDIS_TEST_URL.');
        }
        $this->store = new RedisStore($url, 'blockk-test:'.bin2hex(random_bytes(4)).':');
    }

    #[Test]
    public function documentsIndexesAndCounters(): void
    {
        self::assertNull($this->store->get('a'));
        $this->store->set('a', ['x' => 'ñ', 'n' => [1, 2]], 60);
        self::assertSame(['x' => 'ñ', 'n' => [1, 2]], $this->store->get('a'));

        foreach (['p' => 1.0, 'q' => 3.0, 'r' => 2.0, 's' => 4.0] as $m => $score) {
            $this->store->indexAdd('i', $m, $score, 3, 60);
        }
        self::assertSame(['s', 'q', 'r'], $this->store->indexGet('i', 10));
        self::assertSame(['s'], $this->store->indexGet('i', 1));

        self::assertTrue($this->store->hit('c', 60, 2));
        self::assertTrue($this->store->hit('c', 60, 2));
        self::assertFalse($this->store->hit('c', 60, 2));
    }
}
