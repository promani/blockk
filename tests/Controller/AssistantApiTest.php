<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Tests\Support\KimiMock;
use App\Tests\Support\ScriptedLlm;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class AssistantApiTest extends WebTestCase
{
    /** @return array<string, mixed> */
    private function post(KernelBrowser $client, string $url, array $body): array
    {
        $client->request('POST', $url, server: ['CONTENT_TYPE' => 'application/json'], content: json_encode($body, JSON_THROW_ON_ERROR));

        return json_decode($client->getResponse()->getContent(), true) ?? [];
    }

    public function testAFullConversationThroughTheApi(): void
    {
        $client = static::createClient();
        $browser = bin2hex(random_bytes(12));
        KimiMock::$requests = [];
        KimiMock::$queue = [ScriptedLlm::ask('¿Cuántos dormitorios?', ['d2' => 'Dos', 'd3' => 'Tres'])];

        $client->request('GET', '/api/assistant/status');
        self::assertTrue(json_decode($client->getResponse()->getContent(), true)['enabled']);

        $conv = $this->post($client, '/api/assistant/conversations', ['client' => $browser, 'inicio' => ['tipo' => 'nueva']]);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(['usuario', 'pregunta'], array_column($conv['eventos'], 'tipo'));
        self::assertSame('kimi-test', KimiMock::$requests[0]['model']);
        self::assertSame('system', KimiMock::$requests[0]['messages'][0]['role']);

        KimiMock::$queue = [
            ScriptedLlm::call('generar_casa', ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 3], ['tipo' => 'bano']]], 'c2'),
            ScriptedLlm::say('Te armé una casa de 3 dormitorios.'),
        ];
        $conv = $this->post($client, "/api/assistant/conversations/{$conv['id']}/messages", ['client' => $browser, 'opciones' => ['d3']]);
        self::assertResponseIsSuccessful();
        self::assertSame(['usuario', 'pregunta', 'usuario', 'casa', 'asistente'], array_column($conv['eventos'], 'tipo'));
        self::assertSame(3, $conv['nuevos']);
        self::assertSame($conv['id'], $conv['diseno']['id']);

        $client->request('GET', "/api/assistant/designs?client={$browser}");
        $designs = json_decode($client->getResponse()->getContent(), true)['designs'];
        self::assertCount(1, $designs);
        self::assertStringStartsWith('<svg', $designs[0]['svg']);

        $client->request('GET', "/api/assistant/designs/{$conv['id']}?client={$browser}");
        self::assertResponseIsSuccessful();
        self::assertCount(2, json_decode($client->getResponse()->getContent(), true)['project']['levels']);

        $client->request('GET', "/api/assistant/conversations/{$conv['id']}?client={$browser}");
        self::assertCount(5, json_decode($client->getResponse()->getContent(), true)['eventos']);
    }

    public function testConversationsBelongToTheirBrowser(): void
    {
        $client = static::createClient();
        KimiMock::$queue = [ScriptedLlm::say('Hola')];
        $conv = $this->post($client, '/api/assistant/conversations', ['client' => str_repeat('a', 24), 'inicio' => ['tipo' => 'nueva']]);

        $client->request('GET', "/api/assistant/conversations/{$conv['id']}?client=".str_repeat('b', 24));
        self::assertResponseStatusCodeSame(404);
        $this->post($client, "/api/assistant/conversations/{$conv['id']}/messages", ['client' => str_repeat('b', 24), 'texto' => 'hola']);
        self::assertResponseStatusCodeSame(404);
        $client->request('GET', "/api/assistant/designs/{$conv['id']}?client=".str_repeat('b', 24));
        self::assertResponseStatusCodeSame(404);
    }

    public function testBadRequestsAreRejected(): void
    {
        $client = static::createClient();
        $this->post($client, '/api/assistant/conversations', ['client' => 'x', 'inicio' => ['tipo' => 'nueva']]);
        self::assertResponseStatusCodeSame(400);
        $err = $this->post($client, '/api/assistant/conversations', ['client' => str_repeat('c', 24), 'inicio' => ['tipo' => 'proyecto', 'project' => ['levels' => 'no']]]);
        self::assertResponseStatusCodeSame(422);
        self::assertSame('invalid_project', $err['error']);
        $this->post($client, '/api/assistant/conversations', ['client' => str_repeat('c', 24), 'inicio' => ['tipo' => 'plantilla', 'slug' => 'nope']]);
        self::assertResponseStatusCodeSame(400);
    }
}
