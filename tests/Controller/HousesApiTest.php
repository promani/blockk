<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Assistant\Store\KeyValueStore;
use App\Domain\Design\HouseDescriber;
use App\Domain\ProjectAnalyzer;
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

        // …ni la abre aunque conozca el id: para ese navegador no existe
        $this->call($client, 'GET', "/api/houses/{$saved['id']}?client={$other}");
        self::assertResponseStatusCodeSame(404);
        $this->call($client, 'GET', "/api/houses/{$saved['id']}");
        self::assertResponseStatusCodeSame(404);

        // el dueño la abre con su proyecto, sin que la respuesta lleve su id de navegador
        $open = $this->call($client, 'GET', "/api/houses/{$saved['id']}?client={$me}");
        self::assertResponseIsSuccessful();
        self::assertSame('Casa de prueba', $open['project']['name']);
        self::assertNotEmpty($open['project']['levels'][0]['walls']);
        self::assertStringNotContainsString($me, (string) $client->getResponse()->getContent());

        // el dueño la actualiza con el mismo id
        $updated = $this->call($client, 'POST', '/api/houses', ['client' => $me, 'id' => $saved['id'], 'project' => $this->house('Casa renombrada')]);
        self::assertResponseStatusCodeSame(200);
        self::assertSame($saved['id'], $updated['id']);
        self::assertSame(['Casa renombrada'], array_column($this->call($client, 'GET', "/api/houses?client={$me}")['casas'], 'name'));

        // otro navegador que «guarda» con ese id se lleva una copia: la original no cambia
        $copy = $this->call($client, 'POST', '/api/houses', ['client' => $other, 'id' => $saved['id'], 'project' => $this->house('Copia ajena')]);
        self::assertResponseStatusCodeSame(201);
        self::assertNotSame($saved['id'], $copy['id']);
        self::assertSame('Casa renombrada', $this->call($client, 'GET', "/api/houses/{$saved['id']}?client={$me}")['name']);
        self::assertSame([$copy['id']], array_column($this->call($client, 'GET', "/api/houses?client={$other}")['casas'], 'id'));

        // borrar: sólo el dueño
        $this->call($client, 'DELETE', "/api/houses/{$saved['id']}?client={$other}");
        self::assertResponseStatusCodeSame(404);
        $this->call($client, 'GET', "/api/houses/{$saved['id']}?client={$me}");
        self::assertResponseIsSuccessful();
        $this->call($client, 'DELETE', "/api/houses/{$saved['id']}?client={$me}");
        self::assertResponseIsSuccessful();
        $this->call($client, 'GET', "/api/houses/{$saved['id']}?client={$me}");
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

    public function testOnlyTheOwnerRenamesAHouse(): void
    {
        $client = static::createClient();
        $me = bin2hex(random_bytes(12));
        $other = bin2hex(random_bytes(12));
        $id = $this->call($client, 'POST', '/api/houses', ['client' => $me, 'project' => $this->house()])['id'];

        $this->call($client, 'PATCH', "/api/houses/{$id}", ['client' => $other, 'name' => 'Robada']);
        self::assertResponseStatusCodeSame(404);
        $this->call($client, 'PATCH', "/api/houses/{$id}", ['client' => $me, 'name' => '   ']);
        self::assertResponseStatusCodeSame(400);

        $card = $this->call($client, 'PATCH', "/api/houses/{$id}", ['client' => $me, 'name' => '  Casa de la abuela  ']);
        self::assertResponseIsSuccessful();
        self::assertSame('Casa de la abuela', $card['name']);
        self::assertArrayNotHasKey('client', $card);
        $house = $this->call($client, 'GET', "/api/houses/{$id}?client={$me}");
        self::assertSame('Casa de la abuela', $house['name']);
        self::assertSame('Casa de la abuela', $house['project']['name'], 'el proyecto guardado también cambia de nombre');
        self::assertStringStartsWith('<svg', $house['svg']);
    }

    public function testATransferCodeCopiesTheHousesOnceToAnotherBrowser(): void
    {
        $client = static::createClient();
        $me = bin2hex(random_bytes(12));
        $other = bin2hex(random_bytes(12));

        $this->call($client, 'POST', '/api/houses/transfer', ['client' => $me]);
        self::assertResponseStatusCodeSame(400, 'sin casas no hay nada que llevar');

        $first = $this->call($client, 'POST', '/api/houses', ['client' => $me, 'project' => $this->house('Primera')])['id'];
        $this->call($client, 'POST', '/api/houses', ['client' => $me, 'project' => $this->house('Segunda')]);
        $transfer = $this->call($client, 'POST', '/api/houses/transfer', ['client' => $me]);
        self::assertResponseStatusCodeSame(201);
        self::assertMatchesRegularExpression('/^[a-f0-9]{32}$/', $transfer['codigo']);
        self::assertSame(2, $transfer['casas']);
        self::assertSame(SavedHouses::TRANSFER_TTL, $transfer['venceEn']);
        self::assertStringNotContainsString($me, (string) $client->getResponse()->getContent(), 'el código no revela de qué navegador son');

        // el otro navegador lo canjea: recibe copias con ids nuevos
        $claimed = $this->call($client, 'POST', "/api/houses/transfer/{$transfer['codigo']}", ['client' => $other]);
        self::assertResponseIsSuccessful();
        self::assertSame(['copiadas' => 2, 'omitidas' => 0], $claimed);
        self::assertStringNotContainsString($me, (string) $client->getResponse()->getContent());
        $copies = $this->call($client, 'GET', "/api/houses?client={$other}")['casas'];
        self::assertEqualsCanonicalizing(['Primera', 'Segunda'], array_column($copies, 'name'));
        self::assertNotContains($first, array_column($copies, 'id'));

        // las originales siguen en su lugar y son independientes de las copias
        self::assertCount(2, $this->call($client, 'GET', "/api/houses?client={$me}")['casas']);
        $this->call($client, 'DELETE', "/api/houses/{$copies[0]['id']}?client={$other}");
        self::assertCount(2, $this->call($client, 'GET', "/api/houses?client={$me}")['casas']);

        // un solo uso, y un código inventado no existe
        $this->call($client, 'POST', "/api/houses/transfer/{$transfer['codigo']}", ['client' => $other]);
        self::assertResponseStatusCodeSame(404);
        $this->call($client, 'POST', '/api/houses/transfer/'.str_repeat('ab', 16), ['client' => $other]);
        self::assertResponseStatusCodeSame(404);

        // canjearlo en el mismo navegador no duplica nada
        $again = $this->call($client, 'POST', '/api/houses/transfer', ['client' => $me])['codigo'];
        self::assertSame(['copiadas' => 0, 'omitidas' => 2], $this->call($client, 'POST', "/api/houses/transfer/{$again}", ['client' => $me]));
    }

    public function testATransferRespectsTheLimitAndExpiresSoon(): void
    {
        // almacén en memoria que anota con qué vencimiento se guarda cada clave
        $store = new class implements KeyValueStore {
            /** @var array<string, array<string, mixed>> */
            public array $docs = [];
            /** @var array<string, int> */
            public array $ttl = [];
            /** @var array<string, array<string, float>> */
            public array $index = [];

            public function get(string $key): ?array
            {
                return $this->docs[$key] ?? null;
            }

            public function set(string $key, array $value, int $ttl): void
            {
                $this->docs[$key] = $value;
                $this->ttl[$key] = $ttl;
            }

            public function delete(string $key): void
            {
                unset($this->docs[$key]);
            }

            public function indexRemove(string $key, string $member): void
            {
                unset($this->index[$key][$member]);
            }

            public function indexAdd(string $key, string $member, float $score, int $keep, int $ttl): void
            {
                $this->index[$key][$member] = $score;
            }

            public function indexGet(string $key, int $limit): array
            {
                $index = $this->index[$key] ?? [];
                arsort($index);

                return array_map('strval', array_slice(array_keys($index), 0, $limit));
            }

            public function hit(string $key, int $window, int $limit): bool
            {
                return true;
            }
        };
        $houses = new SavedHouses($store, new ProjectAnalyzer(), new HouseDescriber());
        $from = str_repeat('a', 24);
        $to = str_repeat('b', 24);
        $project = ['name' => 'Chica', 'levels' => [['walls' => [['id' => 'w1', 'x1' => 0, 'y1' => 0, 'x2' => 16, 'y2' => 0, 't' => 20]]]]];
        for ($i = 0; $i < 3; ++$i) {
            $houses->save($from, $project);
        }
        for ($i = 0; $i < SavedHouses::MAX_PER_CLIENT - 2; ++$i) {
            $houses->save($to, $project);
        }

        $code = $houses->transfer($from)['code'];
        self::assertSame(900, $store->ttl["transfer:{$code}"], 'el código dura 15 minutos');
        self::assertSame(['ids'], array_keys($store->docs["transfer:{$code}"]), 'guarda qué casas, no de quién son');

        self::assertSame(['copied' => 2, 'skipped' => 1], $houses->claim($code, $to), 'entran las que caben hasta el máximo');
        self::assertCount(SavedHouses::MAX_PER_CLIENT, $houses->list($to));
        self::assertNull($houses->claim($code, $to));

        // vencido: el almacén ya no lo tiene
        $expired = $houses->transfer($from)['code'];
        $store->delete("transfer:{$expired}");
        self::assertNull($houses->claim($expired, $to));
    }
}
