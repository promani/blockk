<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateThumbnail;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class TemplateCatalogTest extends TestCase
{
    #[Test]
    public function everyTemplateIsStructurallyValidAndMeetsTheWasteTarget(): void
    {
        $catalog = new TemplateCatalog();
        $all = $catalog->all();

        self::assertGreaterThanOrEqual(5, count($all));
        foreach ($all as $t) {
            self::assertSame(0, $t['errors'], "{$t['slug']}: no debe tener errores de validación constructiva");
            self::assertLessThan(4.0, $t['scrapPct'], "{$t['slug']}: descarte < 4 % (KPI del producto)");
            self::assertGreaterThan(0, $t['blocks']);
            self::assertContains('Bajo descarte', $t['tags']);
        }
    }

    #[Test]
    public function coversTheRequestedTypologies(): void
    {
        $tags = array_merge(...array_column((new TemplateCatalog())->all(), 'tags'));

        foreach (['1 planta', '2 plantas', 'Vivienda evolutiva', 'Quincho', 'Dúplex', 'Luz libre modulada'] as $expected) {
            self::assertContains($expected, $tags);
        }
    }

    #[Test]
    public function twoLevelTemplatesRespectTheStructuralLimit(): void
    {
        $catalog = new TemplateCatalog();
        foreach ($catalog->all() as $t) {
            self::assertLessThanOrEqual(2, $t['levels']);
            self::assertLessThanOrEqual(2, count($catalog->project($t['slug'])['levels']));
        }
    }

    #[Test]
    public function unknownTemplatesAreReported(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        (new TemplateCatalog())->project('no-existe');
    }

    #[Test]
    public function thumbnailsAreWellFormedSvgAndEscapeTheProjectName(): void
    {
        $catalog = new TemplateCatalog();
        $summary = $catalog->summary('casa-minima');
        $project = $summary['project'];
        $project['name'] = '<img src=x onerror=alert(1)>';
        $svg = TemplateThumbnail::svg($project);

        $doc = new \DOMDocument();
        self::assertTrue($doc->loadXML($svg), 'El SVG debe ser XML bien formado');
        self::assertStringNotContainsString('<img', $svg);
        self::assertGreaterThan(5, substr_count($svg, '<rect'));
    }
}
