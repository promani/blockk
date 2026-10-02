<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Domain\Templates\TemplateCatalog;
use App\Houses\SavedHouses;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class HousesApiTest extends WebTestCase
{
    /** @return array<string, mixed> */
    private function call(KernelBrowser $client, string $method, string $url, ?array $body = null): array
    {
        $client->request($method, $url, server: ['CONTENT_TYPE' => 'application/json'], content: null === $body ? null : json_encode($body, JSON_THROW_ON_ERROR));

        return json_decode((string) $client->getResponse()->getContent(), true) ?? [];
    }

    /** @return array<string, mixed> */
    private function house(string $name = 'Casa de prueba'): array
    {
        return ['name' => $name] + (new TemplateCatalog())->project('casa-en-l');
    }

    public function testSaveListOpenUpdateAndDelete(): void
    {
        $client = static::createClient();
        $me = bin2hex(random_bytes(12));
        $other = bin2hex(random_bytes(12));

        self::assertSame([], $this->call($client, 'GET', "/api/houses?client={$me}")['casas']);

        // guardar: queda en «Mis casas» de este navegador, con su resumen y su miniatura
        $saved = $this->call($client, 'POST', '/api/houses', ['client' => $me, 'project' => $this->house()]);
        self::assertResponseStatusCodeSame(201);
        self::assertMatchesRegularExpression('/^[a-f0-9]{24}$/', $saved['id']);
        self::assertSame('Casa de prueba', $saved['name']);
        self::assertGreaterThan(0, $saved['summary']['bloques']);
        self::assertStringStartsWith('<svg', $saved['svg']);
        self::assertArrayNotHasKey('client', $saved);

        $mine = $this->call($client, 'GET', "/api/houses?client={$me}");
        self::assertSame([$saved['id']], array_column($mine['casas'], 'id'));
        self::assertArrayNotHasKey('project', $mine['casas'][0]);

        // otro navegador no la ve en su lista…
        self::assertSame([], $this->call($client, 'GET', "/api/houses?client={$other}")['casas']);

        // …pero con el enlace (el id) la abre, sin enterarse de quién es
        $open = $this->call($client, 'GET', "/api/houses/{$saved['id']}?client={$other}");
        self::assertResponseIsSuccessful();
        self::assertFalse($open['own']);
        self::assertSame('Casa de prueba', $open['project']['name']);
        self::assertNotEmpty($open['project']['levels'][0]['walls']);
        self::assertStringNotContainsString($me, (string) $client->getResponse()->getContent());
        self::assertTrue($this->call($client, 'GET', "/api/houses/{$saved['id']}?client={$me}")['own']);
        self::assertFalse($this->call($client, 'GET', "/api/houses/{$saved['id']}")['own']);

        // el dueño la actualiza con el mismo id
        $updated = $this->call($client, 'POST', '/api/houses', ['client' => $me, 'id' => $saved['id'], 'project' => $this->house('Casa renombrada')]);
        self::assertResponseStatusCodeSame(200);
        self::assertSame($saved['id'], $updated['id']);
        self::assertSame(['Casa renombrada'], array_column($this->call($client, 'GET', "/api/houses?client={$me}")['casas'], 'name'));

        // otro navegador que «guarda» con ese id se lleva una copia: la original no cambia
        $copy = $this->call($client, 'POST', '/api/houses', ['client' => $other, 'id' => $saved['id'], 'project' => $this->house('Copia ajena')]);
        self::assertResponseStatusCodeSame(201);
        self::assertNotSame($saved['id'], $copy['id']);
        self::assertSame('Casa renombrada', $this->call($client, 'GET', "/api/houses/{$saved['id']}")['name']);
        self::assertSame([$copy['id']], array_column($this->call($client, 'GET', "/api/houses?client={$other}")['casas'], 'id'));

        // borrar: sólo el dueño
        $this->call($client, 'DELETE', "/api/houses/{$saved['id']}?client={$other}");
        self::assertResponseStatusCodeSame(404);
        $this->call($client, 'GET', "/api/houses/{$saved['id']}");
        self::assertResponseIsSuccessful();
        $this->call($client, 'DELETE', "/api/houses/{$saved['id']}?client={$me}");
        self::assertResponseIsSuccessful();
        $this->call($client, 'GET', "/api/houses/{$saved['id']}");
        self::assertResponseStatusCodeSame(404);
        self::assertSame([], $this->call($client, 'GET', "/api/houses?client={$me}")['casas']);
    }

    public function testBadRequestsAreRejected(): void
    {
        $client = static::createClient();
        $me = bin2hex(random_bytes(12));

        $this->call($client, 'GET', '/api/houses');
        self::assertResponseStatusCodeSame(400);
        $this->call($client, 'GET', '/api/houses?client=no-es-un-id');
        self::assertResponseStatusCodeSame(400);
        $this->call($client, 'POST', '/api/houses', ['client' => 'x', 'project' => $this->house()]);
        self::assertResponseStatusCodeSame(400);
        $this->call($client, 'POST', '/api/houses', ['client' => $me]);
        self::assertResponseStatusCodeSame(400);
        $err = $this->call($client, 'POST', '/api/houses', ['client' => $me, 'project' => ['levels' => 'no']]);
        self::assertResponseStatusCodeSame(422);
        self::assertSame('invalid_project', $err['error']);
        $this->call($client, 'GET', '/api/houses/'.str_repeat('a', 24));
        self::assertResponseStatusCodeSame(404);
        $this->call($client, 'DELETE', '/api/houses/'.str_repeat('a', 24));
        self::assertResponseStatusCodeSame(400);
        self::assertSame([], $this->call($client, 'GET', "/api/houses?client={$me}")['casas']);
    }

    public function testThereIsAMaximumPerBrowser(): void
    {
        $client = static::createClient();
        $me = bin2hex(random_bytes(12));
        /** @var SavedHouses $houses */
        $houses = static::getContainer()->get(SavedHouses::class);
        $project = ['name' => 'Mínima', 'levels' => [['walls' => [['id' => 'w1', 'x1' => 8, 'y1' => 8, 'x2' => 40, 'y2' => 8, 't' => 20]]]]];
        $ids = [];
        for ($i = 0; $i < SavedHouses::MAX_PER_CLIENT; ++$i) {
            $ids[] = $houses->save($me, $project)['id'];
        }
        self::assertCount(SavedHouses::MAX_PER_CLIENT, array_unique($ids));

        $err = $this->call($client, 'POST', '/api/houses', ['client' => $me, 'project' => $project]);
        self::assertResponseStatusCodeSame(409);
        self::assertStringContainsString('máximo de 30 casas', $err['error']);

        // actualizar una existente sigue andando, y al borrar una se libera el lugar
        $this->call($client, 'POST', '/api/houses', ['client' => $me, 'id' => $ids[0], 'project' => $project]);
        self::assertResponseStatusCodeSame(200);
        $this->call($client, 'DELETE', "/api/houses/{$ids[1]}?client={$me}");
        $this->call($client, 'POST', '/api/houses', ['client' => $me, 'project' => $project]);
        self::assertResponseStatusCodeSame(201);
        self::assertCount(SavedHouses::MAX_PER_CLIENT, $this->call($client, 'GET', "/api/houses?client={$me}")['casas']);
    }

    public function testTheShortLinkOpensTheEditorWithTheHouse(): void
    {
        $client = static::createClient();
        $id = str_repeat('ab', 12);
        $client->request('GET', "/c/{$id}");
        self::assertResponseRedirects("/?casa={$id}");
    }
}
