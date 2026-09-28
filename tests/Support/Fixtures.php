<?php

declare(strict_types=1);

namespace App\Tests\Support;

use App\Domain\Model\Project;
use App\Domain\Model\ProjectFactory;
use App\Domain\Templates\TemplateBuilder;

/** Proyectos de prueba armados con el mismo builder que las plantillas (unidades de 12,5 cm). */
final class Fixtures
{
    /** Sala rectangular de PB (8 × 6 módulos por defecto) con muros de $t cm. */
    public static function room(int $w = 40, int $h = 30, float $t = 20.0): TemplateBuilder
    {
        return (new TemplateBuilder('Prueba'))->room(0, 0, 0, $w, $h, $t);
    }

    /** @param array<string, mixed> $data */
    public static function project(array $data): Project
    {
        return ProjectFactory::fromArray($data);
    }

    public static function build(TemplateBuilder $b): Project
    {
        return ProjectFactory::fromArray($b->build());
    }
}
