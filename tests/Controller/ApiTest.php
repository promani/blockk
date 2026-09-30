<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Tests\Support\Fixtures;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class ApiTest extends WebTestCase
{
    /** @return array<string, mixed> */
    private function post(\Symfony\Bundle\FrameworkBundle\KernelBrowser $client, string $url, string|array $body): array
    {
        $client->request('POST', $url, server: ['CONTENT_TYPE' => 'application/json'], content: is_array($body) ? json_encode($body, JSON_THROW_ON_ERROR) : $body);

        return json_decode($client->getResponse()->getContent(), true) ?? [];
    }

    public function testPagesRender(): void
    {
        $client = static::createClient();
        foreach (['/' => 'Editor', '/computo' => 'Cómputo', '/galeria' => 'Galería', '/catalogo' => 'Catálogo'] as $url => $needle) {
            $client->request('GET', $url);
            self::assertResponseIsSuccessful("GET $url");
            self::assertStringContainsString($needle, $client->getResponse()->getContent());
        }
    }

    public function testResponsesCarrySecurityHeaders(): void
    {
        $client = static::createClient();
        $client->request('GET', '/');
        $h = $client->getResponse()->headers;

        self::assertSame('nosniff', $h->get('X-Content-Type-Options'));
        self::assertSame('DENY', $h->get('X-Frame-Options'));
        self::assertStringContainsString("frame-ancestors 'none'", $h->get('Content-Security-Policy'));
        self::assertStringContainsString("object-src 'none'", $h->get('Content-Security-Policy'));
    }

    public function testEditorPageEmbedsTheConstructionConfig(): void
    {
        $client = static::createClient();
        $crawler = $client->request('GET', '/');

        $config = json_decode($crawler->filter('#blockk-config')->text(), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(2, $config['maxLevels']);
        self::assertSame(12, $config['courses']);
        self::assertSame(600, $config['maxHeight']);
        self::assertArrayHasKey('P100', $config['presets']);
    }

    public function testGalleryShowsTemplatesComputedByTheEngine(): void
    {
        $client = static::createClient();
        $crawler = $client->request('GET', '/galeria');

        self::assertGreaterThanOrEqual(5, $crawler->filter('.tcard')->count());
        self::assertGreaterThanOrEqual(5, $crawler->filter('.tcard svg')->count());
        self::assertStringContainsString('Descarte', $client->getResponse()->getContent());
    }

    public function testAnalyzeReturnsNormalizedProjectAndFullAnalysis(): void
    {
        $client = static::createClient();
        $data = Fixtures::room()->wall(0, 20, 0, 20, 30, 10.0)->opening(0, 'P100', 'x', 30, 24)->build();
        $json = $this->post($client, '/api/analyze', $data);

        self::assertResponseIsSuccessful();
        self::assertCount(7, $json['project']['levels'][0]['walls'], 'El tabique divide los muros norte y sur: 4 + 2 + 1 = 7');
        $a = $json['analysis'];
        self::assertCount(12, $a['levels'][0]['courses']);
        self::assertSame(2, $a['telemetry']['levels'][0]['rooms']);
        self::assertSame(12, $a['telemetry']['levels'][0]['courses']['total']);
        self::assertArrayHasKey('total', $a['bom']);
        self::assertNotEmpty($a['bom']['lines']);
        self::assertLessThan(4.0, $a['telemetry']['total']['scrapPct']);
        foreach ($a['levels'][0]['walls'] as $info) {
            self::assertArrayHasKey('slots', $info);
        }
    }

    public function testAnalyzeRejectsInvalidProjectsWith422(): void
    {
        $client = static::createClient();
        $json = $this->post($client, '/api/analyze', ['levels' => [['walls' => [['id' => 'w1', 'x1' => 0, 'y1' => 0, 'x2' => 5, 'y2' => 5, 't' => 20]]]]]);

        self::assertResponseStatusCodeSame(422);
        self::assertSame('invalid_project', $json['error']);
        self::assertNotEmpty($json['details']);
    }

    public function testAnalyzeRejectsAThirdLevel(): void
    {
        $client = static::createClient();
        $data = Fixtures::room()->build();
        $data['levels'][] = ['walls' => []];
        $json = $this->post($client, '/api/analyze', $data);

        self::assertResponseStatusCodeSame(422);
        self::assertStringContainsString('2 niveles', implode(' ', $json['details']));
    }

    public function testAnalyzeRejectsProjectsOverTheComplexityBudget(): void
    {
        $walls = [];
        for ($i = 0; $i <= 40; ++$i) { // rejilla de 41 × 41 líneas: > 800 tramos tras dividir en cruces
            $walls[] = ['id' => "v$i", 'x1' => $i * 4, 'y1' => 0, 'x2' => $i * 4, 'y2' => 160, 't' => 20];
            $walls[] = ['id' => "h$i", 'x1' => 0, 'y1' => $i * 4, 'x2' => 160, 'y2' => $i * 4, 't' => 20];
        }
        $client = static::createClient();
        $json = $this->post($client, '/api/analyze', ['levels' => [['walls' => $walls]]]);

        self::assertResponseStatusCodeSame(422);
        self::assertStringContainsString('demasiado complejo', implode(' ', $json['details']));
    }

    public function testAnalyzeRejectsFootprintsLargerThanTheBudget(): void
    {
        // Dos muros de 1 módulo en extremos opuestos del rango: la grilla de ambientes ocuparía gigas de memoria.
        $client = static::createClient();
        $json = $this->post($client, '/api/analyze', ['levels' => [['walls' => [
            ['id' => 'a', 'x1' => -1000, 'y1' => -1000, 'x2' => -999, 'y2' => -1000, 't' => 20],
            ['id' => 'b', 'x1' => 1000, 'y1' => 999, 'x2' => 1000, 'y2' => 1000, 't' => 20],
        ]]]]);

        self::assertResponseStatusCodeSame(422);
        self::assertStringContainsString('superficie demasiado grande', implode(' ', $json['details']));
    }

    public function testNumericWallIdsAreRejectedInsteadOfCrashingTheSuggester(): void
    {
        $client = static::createClient();
        $data = Fixtures::room()->build();
        $data['levels'][0]['walls'][0]['id'] = '1';
        $this->post($client, '/api/suggest', $data);

        self::assertResponseStatusCodeSame(422);
    }

    public function testAnalyzeRejectsGarbageAndOversizedBodies(): void
    {
        $client = static::createClient();
        $this->post($client, '/api/analyze', '{no es json');
        self::assertResponseStatusCodeSame(400);

        $this->post($client, '/api/analyze', '"solo un string"');
        self::assertResponseStatusCodeSame(400);

        $this->post($client, '/api/analyze', str_repeat('a', 1_600_000));
        self::assertResponseStatusCodeSame(413);
    }

    public function testSuggestReturnsBioclimaticWindows(): void
    {
        $client = static::createClient();
        $json = $this->post($client, '/api/suggest', Fixtures::room()->build());

        self::assertResponseIsSuccessful();
        $types = array_column($json['suggestions'], 'type');
        self::assertContains('solar', $types);
        self::assertContains('cross', $types);
    }

    public function testSolarPathAndValidation(): void
    {
        $client = static::createClient();
        $client->request('GET', '/api/solar?lat=-34.6&season=winter');
        self::assertResponseIsSuccessful();
        $json = json_decode($client->getResponse()->getContent(), true);
        self::assertSame('Invierno (21 jun)', $json['label']);
        self::assertCount(53, $json['path']);

        $client->request('GET', '/api/solar?lat=999&season=winter');
        self::assertResponseStatusCodeSame(400);
        $client->request('GET', '/api/solar?lat=-34&season=otoño');
        self::assertResponseStatusCodeSame(400);
    }

    public function testTemplatesEndpoints(): void
    {
        $client = static::createClient();
        $client->request('GET', '/api/templates');
        self::assertResponseIsSuccessful();
        $list = json_decode($client->getResponse()->getContent(), true);
        self::assertGreaterThanOrEqual(5, count($list));
        self::assertArrayNotHasKey('project', $list[0]);

        $client->request('GET', '/api/templates/'.$list[0]['slug']);
        self::assertResponseIsSuccessful();
        self::assertArrayHasKey('levels', json_decode($client->getResponse()->getContent(), true));

        $client->request('GET', '/api/templates/no-existe');
        self::assertResponseStatusCodeSame(404);
    }

    public function testQuickPanelCalculator(): void
    {
        $client = static::createClient();
        $client->request('GET', '/api/calc/panel?length=5&height=2.75&t=20&openings=0&waste=5');
        self::assertResponseIsSuccessful();
        // Lika: 13,75 m² × 8 bloques/m² + 5 %
        self::assertSame(116, json_decode($client->getResponse()->getContent(), true)['blocks']);

        $client->request('GET', '/api/calc/panel?length=5&height=2.75&t=13');
        self::assertResponseStatusCodeSame(400);
    }

    public function testThumbnailEndpointReturnsSvg(): void
    {
        $client = static::createClient();
        $this->post($client, '/api/thumbnail', Fixtures::room()->build());

        self::assertResponseIsSuccessful();
        self::assertStringContainsString('image/svg+xml', $client->getResponse()->headers->get('Content-Type'));
    }
}
