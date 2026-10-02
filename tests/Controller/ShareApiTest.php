<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Tests\Support\Fixtures;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** Enlaces para compartir: se crean, se leen y quien tiene el enlace guarda cambios. */
final class ShareApiTest extends WebTestCase
{
    /** @param array<string, mixed> $body */
    private function send(KernelBrowser $c, string $method, string $url, array $body = []): array
    {
        $c->request($method, $url, [], [], ['CONTENT_TYPE' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR));

        return json_decode((string) $c->getResponse()->getContent(), true) ?? [];
    }

    public function testCreateReadAndEditByLink(): void
    {
        $client = static::createClient();
        $project = Fixtures::room()->build();

        $created = $this->send($client, 'POST', '/api/compartidos', ['project' => $project]);
        self::assertResponseStatusCodeSame(201);
        self::assertMatchesRegularExpression('/^[a-f0-9]{32}$/', $created['id']);
        self::assertStringContainsString('?compartido='.$created['id'], $created['url']);

        $client->request('GET', '/api/compartidos/'.$created['id']);
        $read = json_decode((string) $client->getResponse()->getContent(), true);
        self::assertEquals($project['levels'][0]['walls'], $read['project']['levels'][0]['walls']);
        self::assertSame(1, $read['version']);

        // Otra persona con el enlace cambia el nombre: queda guardado y sube la versión.
        $project['name'] = 'Editado por otro';
        $saved = $this->send($client, 'PUT', '/api/compartidos/'.$created['id'], ['project' => $project]);
        self::assertResponseIsSuccessful();
        self::assertSame(2, $saved['version']);
        $client->request('GET', '/api/compartidos/'.$created['id']);
        self::assertSame('Editado por otro', json_decode((string) $client->getResponse()->getContent(), true)['project']['name']);
    }

    public function testUnknownLinksAndInvalidProjectsAreRejected(): void
    {
        $client = static::createClient();
        $client->request('GET', '/api/compartidos/'.str_repeat('0', 32));
        self::assertResponseStatusCodeSame(404);
        $client->request('GET', '/api/compartidos/no-es-un-id');
        self::assertResponseStatusCodeSame(404);
        $this->send($client, 'PUT', '/api/compartidos/'.str_repeat('0', 32), ['project' => Fixtures::room()->build()]);
        self::assertResponseStatusCodeSame(404);

        $bad = Fixtures::room()->build();
        $bad['levels'][0]['walls'][0]['t'] = 13;
        $this->send($client, 'POST', '/api/compartidos', ['project' => $bad]);
        self::assertResponseStatusCodeSame(422);
        $this->send($client, 'POST', '/api/compartidos', ['nada' => 1]);
        self::assertResponseStatusCodeSame(400);
    }
}
