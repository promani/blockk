<?php

declare(strict_types=1);

namespace App\Tests\Support;

use Symfony\Component\HttpClient\Response\MockResponse;

/** Fábrica de respuestas del HttpClient en el entorno de test: simula la API de Kimi con un guion estático. */
final class KimiMock
{
    /** @var list<array<string, mixed>> mensajes del asistente a devolver */
    public static array $queue = [];

    /** @var list<array<string, mixed>> cuerpos recibidos */
    public static array $requests = [];

    /** @param array<string, mixed> $options */
    public function __invoke(string $method, string $url, array $options = []): MockResponse
    {
        self::$requests[] = json_decode((string) ($options['body'] ?? '{}'), true);
        $message = array_shift(self::$queue) ?? ['role' => 'assistant', 'content' => 'Listo.'];

        return new MockResponse(json_encode(['choices' => [['message' => $message, 'finish_reason' => 'stop']]], JSON_THROW_ON_ERROR), ['http_code' => 200, 'response_headers' => ['content-type' => 'application/json']]);
    }
}
