<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class AdminApiTest extends WebTestCase
{
    private const array PROGRAMA = ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio'], ['tipo' => 'dormitorio'], ['tipo' => 'bano'], ['tipo' => 'estar_comedor_cocina']]];

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
        $this->call($client, 'POST', '/api/admin/galeria', ['nombre' => 'x', 'programa' => self::PROGRAMA], 'otro');
        self::assertResponseStatusCodeSame(401);
        $this->call($client, 'DELETE', '/api/admin/galeria/casa-en-l', token: null);
        self::assertResponseStatusCodeSame(401);
        $this->call($client, 'GET', '/api/admin/ping');
        self::assertResponseIsSuccessful();
    }

    public function testCreateEditAndDeleteAGalleryModel(): void
    {
        $client = static::createClient();
        $slug = 'casa-de-prueba-api';
        $this->call($client, 'DELETE', "/api/admin/galeria/$slug");

        // alta: aparece en la Galería para cualquiera, con su API pública de plantillas
        $res = $this->call($client, 'POST', '/api/admin/galeria', ['nombre' => 'Casa de prueba API', 'etiquetas' => ['1 planta', 'Prueba'], 'programa' => self::PROGRAMA]);
        self::assertResponseStatusCodeSame(201);
        self::assertSame($slug, $res['slug']);
        $client->request('GET', '/api/templates');
        $names = array_column(json_decode($client->getResponse()->getContent(), true), 'name', 'slug');
        self::assertSame('Casa de prueba API', $names[$slug]);
        $client->request('GET', "/api/templates/$slug");
        self::assertResponseIsSuccessful();
        $client->request('GET', '/galeria');
        self::assertStringContainsString('Casa de prueba API', $client->getResponse()->getContent());

        // mismo nombre: conflicto
        $this->call($client, 'POST', '/api/admin/galeria', ['nombre' => 'Casa de prueba API', 'programa' => self::PROGRAMA]);
        self::assertResponseStatusCodeSame(409);

        // edición de datos y del dibujo
        $this->call($client, 'PUT', "/api/admin/galeria/$slug", ['nombre' => 'Casa renombrada', 'descripcion' => 'Una descripción.']);
        self::assertResponseIsSuccessful();
        $shown = $this->call($client, 'GET', "/api/admin/galeria/$slug");
        self::assertSame('Casa renombrada', $shown['nombre']);
        self::assertSame('Una descripción.', $shown['descripcion']);
        self::assertSame(['1 planta', 'Prueba'], array_slice($shown['etiquetas'], 0, 2));
        $client->request('GET', '/galeria');
        self::assertStringContainsString('Casa renombrada', $client->getResponse()->getContent());
        $this->call($client, 'PUT', "/api/admin/galeria/$slug", ['programa' => ['niveles' => 2, 'ambientes' => [...self::PROGRAMA['ambientes'], ['tipo' => 'dormitorio', 'nivel' => 2]]]]);
        self::assertResponseIsSuccessful();

        // baja
        $this->call($client, 'DELETE', "/api/admin/galeria/$slug");
        self::assertResponseIsSuccessful();
        $client->request('GET', "/api/templates/$slug");
        self::assertResponseStatusCodeSame(404);
        $this->call($client, 'DELETE', "/api/admin/galeria/$slug");
        self::assertResponseStatusCodeSame(404);
    }

    public function testBuiltInTemplatesAreProtectedButCanBeCloned(): void
    {
        $client = static::createClient();
        $this->call($client, 'PUT', '/api/admin/galeria/casa-en-l', ['nombre' => 'x']);
        self::assertResponseStatusCodeSame(403);
        $this->call($client, 'DELETE', '/api/admin/galeria/casa-en-l');
        self::assertResponseStatusCodeSame(403);
        $this->call($client, 'POST', '/api/admin/galeria', ['nombre' => 'Casa en L', 'plantilla' => 'casa-en-l']);
        self::assertResponseStatusCodeSame(409);

        $this->call($client, 'DELETE', '/api/admin/galeria/clon-de-la-l');
        $this->call($client, 'POST', '/api/admin/galeria', ['nombre' => 'Clon de la L', 'plantilla' => 'casa-en-l']);
        self::assertResponseStatusCodeSame(201);
        $this->call($client, 'DELETE', '/api/admin/galeria/clon-de-la-l');
        self::assertResponseIsSuccessful();
    }

    public function testRejectsBadInput(): void
    {
        $client = static::createClient();
        $this->call($client, 'POST', '/api/admin/galeria', ['programa' => self::PROGRAMA]);
        self::assertResponseStatusCodeSame(400);
        $this->call($client, 'POST', '/api/admin/galeria', ['nombre' => 'Sin dibujo']);
        self::assertResponseStatusCodeSame(400);
        $this->call($client, 'POST', '/api/admin/galeria', ['nombre' => 'Mala', 'programa' => ['niveles' => 3, 'ambientes' => []]]);
        self::assertResponseStatusCodeSame(400);
        $this->call($client, 'PUT', '/api/admin/galeria/no-existe', ['nombre' => 'x']);
        self::assertResponseStatusCodeSame(404);
    }
}
