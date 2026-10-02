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

        $client->request('GET', '/api/assistant/status');
        self::assertTrue(json_decode($client->getResponse()->getContent(), true)['enabled']);

        // formulario inicial y primera casa: sin el modelo
        $conv = $this->post($client, '/api/assistant/conversations', ['client' => $browser, 'inicio' => ['tipo' => 'nueva']]);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(['pregunta'], array_column($conv['eventos'], 'tipo'));
        $conv = $this->post($client, "/api/assistant/conversations/{$conv['id']}/messages", ['client' => $browser, 'respuestas' => ['plantas' => ['1'], 'dormitorios' => ['2'], 'banos' => ['1'], 'cocina' => ['integrada'], 'techo' => ['dos_aguas']]]);
        self::assertResponseIsSuccessful();
        self::assertSame(['pregunta', 'usuario', 'casa'], array_column($conv['eventos'], 'tipo'));
        self::assertSame([], KimiMock::$requests);

        // un ajuste: una vuelta al modelo
        KimiMock::$queue = [ScriptedLlm::call('generar_casa', ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 3], ['tipo' => 'bano']]], 'c2')];
        $conv = $this->post($client, "/api/assistant/conversations/{$conv['id']}/messages", ['client' => $browser, 'texto' => 'uno más']);
        self::assertSame(['pregunta', 'usuario', 'casa', 'usuario', 'casa'], array_column($conv['eventos'], 'tipo'));
        self::assertSame(2, $conv['nuevos']);
        self::assertSame('kimi-test', KimiMock::$requests[0]['model']);
        self::assertSame('system', KimiMock::$requests[0]['messages'][0]['role']);


        $client->request('GET', "/api/assistant/designs/{$conv['id']}?client={$browser}");
        $design = json_decode($client->getResponse()->getContent(), true);
        self::assertCount(2, $design['project']['levels']);
        self::assertSame(1, $design['programa']['niveles']);

        // desde el editor: el proyecto viaja con el mensaje
        KimiMock::$queue = [ScriptedLlm::say('Listo.')];
        $design['project']['name'] = 'Renombrada en el editor';
        $conv = $this->post($client, '/api/assistant/conversations', ['client' => $browser, 'modo' => 'editor', 'inicio' => ['tipo' => 'proyecto', 'project' => $design['project'], 'programa' => $design['programa']], 'texto' => 'hola']);
        self::assertSame(['casa', 'usuario', 'asistente'], array_column($conv['eventos'], 'tipo'));
        self::assertStringContainsString('MODO EDITOR', end(KimiMock::$requests)['messages'][0]['content']);
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

    public function testAPlanImageIsCheckedBeforeItReachesTheModel(): void
    {
        $client = static::createClient();
        $browser = bin2hex(random_bytes(12));
        KimiMock::$requests = [];
        $png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

        foreach ([
            ['tipo' => 'application/pdf', 'datos' => $png],
            ['tipo' => 'image/png', 'datos' => base64_encode('esto no es una imagen')],
            ['tipo' => 'image/jpeg', 'datos' => $png],
            'plano.png',
        ] as $bad) {
            $this->post($client, '/api/assistant/conversations', ['client' => $browser, 'inicio' => ['tipo' => 'nueva'], 'adjunto' => $bad]);
            self::assertResponseStatusCodeSame(400);
        }
        self::assertSame([], KimiMock::$requests);

        KimiMock::$queue = [ScriptedLlm::call('calcar_plano', ['ambientes' => [['nombre' => 'Estar', 'x' => 0, 'y' => 0, 'ancho' => 5, 'fondo' => 4]]], 'p1')];
        $conv = $this->post($client, '/api/assistant/conversations', ['client' => $browser, 'inicio' => ['tipo' => 'nueva'], 'adjunto' => ['tipo' => 'image/png', 'datos' => $png]]);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(['usuario', 'casa'], array_column($conv['eventos'], 'tipo'));
        self::assertTrue($conv['eventos'][0]['adjunto']);
        self::assertSame('image_url', KimiMock::$requests[0]['messages'][1]['content'][1]['type']);
        self::assertStringNotContainsString($png, json_encode($conv), 'la imagen no vuelve en la respuesta');
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
