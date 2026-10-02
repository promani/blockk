<?php

declare(strict_types=1);

namespace App\Tests\Assistant;

use App\Assistant\KimiClient;
use App\Assistant\LlmUnavailable;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

final class KimiClientTest extends TestCase
{
    #[Test]
    public function itSpeaksTheOpenAiCompatibleChatCompletionsApi(): void
    {
        $seen = [];
        $http = new MockHttpClient(static function (string $method, string $url, array $options) use (&$seen): MockResponse {
            $seen = ['method' => $method, 'url' => $url, 'headers' => $options['headers'], 'body' => json_decode($options['body'], true)];

            return new MockResponse('{"choices":[{"message":{"role":"assistant","content":"hola"}}]}');
        });
        $client = new KimiClient($http, ' sk-test ', 'kimi-x', 'https://api.moonshot.ai/v1/');
        $msg = $client->chat([['role' => 'user', 'content' => 'hola']], [['type' => 'function', 'function' => ['name' => 'f']]]);

        self::assertSame('hola', $msg['content']);
        self::assertSame('POST', $seen['method']);
        self::assertSame('https://api.moonshot.ai/v1/chat/completions', $seen['url']);
        self::assertContains('Authorization: Bearer sk-test', $seen['headers']);
        self::assertSame('kimi-x', $seen['body']['model']);
        self::assertSame('auto', $seen['body']['tool_choice']);
        self::assertSame('f', $seen['body']['tools'][0]['function']['name']);
    }

    #[Test]
    public function apiErrorsBecomeLlmUnavailable(): void
    {
        $http = new MockHttpClient(new MockResponse('{"error":{"message":"Invalid Authentication"}}', ['http_code' => 401]));
        $this->expectException(LlmUnavailable::class);
        $this->expectExceptionMessage('401: Invalid Authentication');
        (new KimiClient($http, 'k', 'm', 'https://x/v1'))->chat([], []);
    }

    #[Test]
    public function withoutKeyOrModelItIsDisabled(): void
    {
        $http = new MockHttpClient();
        self::assertFalse((new KimiClient($http, '', 'm', 'u'))->enabled());
        self::assertFalse((new KimiClient($http, 'k', ' ', 'u'))->enabled());
        self::assertTrue((new KimiClient($http, 'k', 'm', 'u'))->enabled());
    }

    #[Test]
    public function theLightModelUsesTheSameKeyAndEndpoint(): void
    {
        $seen = [];
        $http = new MockHttpClient(static function (string $method, string $url, array $options) use (&$seen): MockResponse {
            $seen[] = [$url, json_decode($options['body'], true)['model']];

            return new MockResponse('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}');
        });
        $client = new KimiClient($http, 'k', 'kimi-for-coding', 'https://api.moonshot.ai/v1', 'kimi-k2.6');
        self::assertTrue($client->hasLight());
        $client->chat([], [], KimiClient::LIGHT);
        $client->chat([], [], KimiClient::HEAVY);
        self::assertSame([['https://api.moonshot.ai/v1/chat/completions', 'kimi-k2.6'], ['https://api.moonshot.ai/v1/chat/completions', 'kimi-for-coding']], $seen);

        // sin modelo liviano, todo va al pesado
        self::assertFalse((new KimiClient($http, 'k', 'pesado', 'https://x/v1'))->hasLight());
    }

    #[Test]
    public function turnsWithAnImageGoToTheVisionModelWhenThereIsOne(): void
    {
        $seen = [];
        $http = new MockHttpClient(static function (string $method, string $url, array $options) use (&$seen): MockResponse {
            $body = json_decode($options['body'], true);
            $seen[] = [$body['model'], $body['thinking']['type'] ?? 'por defecto'];

            return new MockResponse('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}');
        });
        $plan = [['role' => 'user', 'content' => [['type' => 'text', 'text' => 'Calcá este plano.'], ['type' => 'image_url', 'image_url' => ['url' => 'data:image/png;base64,AAAA']]]]];
        $client = new KimiClient($http, 'k', 'pesado', 'https://x/v1', 'liviano', 'con-vista');
        $client->chat($plan, []);
        $client->chat([['role' => 'user', 'content' => 'hola']], []);
        (new KimiClient($http, 'k', 'pesado', 'https://x/v1'))->chat($plan, []);

        // con un plano no se razona: razonando, el modelo no llega a responder
        self::assertSame([['con-vista', 'disabled'], ['pesado', 'por defecto'], ['pesado', 'disabled']], $seen);
    }
}
