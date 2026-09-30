<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateImages;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Cada plantilla de la Galería tiene su planta e isométrica pregeneradas y al día (si no: `composer miniaturas`). */
final class TemplateImagesTest extends TestCase
{
    #[Test]
    public function everyTemplateHasUpToDateThumbnails(): void
    {
        $catalog = new TemplateCatalog();
        $images = new TemplateImages(__DIR__.'/../../public');
        foreach ($catalog->all() as $t) {
            self::assertNotNull($images->find($t['slug'], $catalog->project($t['slug'])), "Faltan o están viejas las miniaturas de «{$t['slug']}»: correr `composer miniaturas`.");
        }
    }

    #[Test]
    public function theHashChangesWithTheProject(): void
    {
        $p = (new TemplateCatalog())->project('casa-minima');
        $q = $p;
        $q['name'] = 'Otra';
        self::assertNotSame(TemplateImages::hash($p), TemplateImages::hash($q));
        self::assertMatchesRegularExpression('#^img/plantillas/casa-minima-[0-9a-f]{10}-iso\.webp$#', TemplateImages::paths('casa-minima', $p)['iso']);
    }
}
