<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class AdminApiTest extends WebTestCase
{
    /** @return array<string, mixed> */
    private function call(KernelBrowser $client, string $method, string $url, ?array $body = null, ?string $token = 'token-de-prueba'): array
    {
        $server = ['CONTENT_TYPE' => 'application/json'] + (null === $token ? [] : ['HTTP_AUTHORIZATION' => "Bearer $token"]);
        $client->request($method, $url, server: $server, content: null === $body ? null : json_encode($body, JSON_THROW_ON_ERROR));

        return json_decode($client->getResponse()->getContent(), true) ?? [];
    }

    public function testRequiresTheToken(): void
    {
        $client = static::createClient();
        $this->call($client, 'GET', '/api/admin/ping', token: null);
        self::assertResponseStatusCodeSame(401);
        $this->call($client, 'POST', '/api/admin/casas', ['plantilla' => 'x'], 'otro');
        self::assertResponseStatusCodeSame(401);
        $this->call($client, 'GET', '/api/admin/ping');
        self::assertResponseIsSuccessful();
    }

    public function testCreatesAHouseFromAProgramAndOpensIt(): void
    {
        $client = static::createClient();
        $casa = $this->call($client, 'POST', '/api/admin/casas', ['nombre' => 'Casa API', 'programa' => ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio'], ['tipo' => 'dormitorio'], ['tipo' => 'bano'], ['tipo' => 'estar_comedor_cocina']]]]);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('Casa API', $casa['resumen']['nombre']);
        self::assertStringEndsWith('/abrir/'.$casa['id'], $casa['url']);

        $listed = $this->call($client, 'GET', '/api/admin/casas');
        self::assertSame([$casa['id']], array_slice(array_column($listed['casas'], 'id'), 0, 1));

        $public = $this->call($client, 'GET', '/api/casas/'.$casa['id'], token: null);
        self::assertResponseIsSuccessful();
        self::assertSame('Casa API', $public['project']['name']);

        $client->request('GET', '/abrir/'.$casa['id']);
        self::assertResponseIsSuccessful();
    }

    public function testCreatesFromATemplateAndRejectsBadInput(): void
    {
        $client = static::createClient();
        $slug = $this->call($client, 'GET', '/api/admin/ping')['plantillas'][0];
        $this->call($client, 'POST', '/api/admin/casas', ['plantilla' => $slug]);
        self::assertResponseStatusCodeSame(201);
        $this->call($client, 'POST', '/api/admin/casas', ['programa' => ['niveles' => 3, 'ambientes' => []]]);
        self::assertResponseStatusCodeSame(400);
        $this->call($client, 'POST', '/api/admin/casas', []);
        self::assertResponseStatusCodeSame(400);
        $this->call($client, 'GET', '/api/casas/'.str_repeat('a', 24), token: null);
        self::assertResponseStatusCodeSame(404);
    }
}
