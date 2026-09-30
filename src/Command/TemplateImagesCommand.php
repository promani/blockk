<?php

declare(strict_types=1);

namespace App\Command;

use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateImages;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/** Lista las miniaturas que tiene que haber para cada plantilla (la usa bin/miniaturas.cjs). */
#[AsCommand(name: 'app:miniaturas', description: 'Miniaturas de la Galería: rutas esperadas y si ya están generadas (JSON).')]
final class TemplateImagesCommand extends Command
{
    public function __construct(private readonly TemplateCatalog $templates, private readonly TemplateImages $images)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $out = [];
        foreach ($this->templates->all() as $t) {
            $project = $this->templates->project($t['slug']);
            $out[] = ['slug' => $t['slug'], 'paths' => TemplateImages::paths($t['slug'], $project), 'ok' => null !== $this->images->find($t['slug'], $project)];
        }
        $output->writeln(json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));

        return Command::SUCCESS;
    }
}
