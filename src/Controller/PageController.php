<?php

declare(strict_types=1);

namespace App\Controller;

use App\Assistant\Assistant;
use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateImages;
use App\Domain\Templates\TemplateThumbnail;
use App\Http\ClientConfig;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

final class PageController extends AbstractController
{
    public function __construct(private readonly TemplateCatalog $templates, private readonly CacheInterface $cache, private readonly Assistant $assistant, private readonly TemplateImages $images)
    {
    }

    #[Route('/', name: 'editor', methods: ['GET'])]
    public function editor(): Response
    {
        return $this->render('editor/index.html.twig', ['config' => ClientConfig::json(), 'nav' => 'editor', 'assistant' => $this->assistant->enabled()]);
    }

    #[Route('/computo', name: 'bom', methods: ['GET'])]
    public function bom(): Response
    {
        return $this->render('bom/index.html.twig', ['config' => ClientConfig::json(), 'nav' => 'bom']);
    }

    #[Route('/galeria', name: 'gallery', methods: ['GET'])]
    public function gallery(): Response
    {
        // Las métricas de las plantillas salen del motor real; se cachean porque son deterministas. La clave lleva el
        // hash de cada plantilla (el mismo de las miniaturas): si cambia una casa, se vuelven a calcular.
        $projects = array_combine($this->templates->slugs(), array_map(fn (string $slug): array => $this->templates->project($slug), $this->templates->slugs()));
        $hashes = array_map(static fn (array $p): string => TemplateImages::hash($p), $projects);
        $summaries = $this->cache->get('gallery.cards.v5.'.sha1(implode('|', $hashes).$this->templates->version()), function (ItemInterface $item): array {
            $item->expiresAfter(3600);

            return $this->templates->all();
        });
        // Las miniaturas se buscan en cada pedido (sólo mira si existen los archivos): así no queda en caché una tarjeta sin
        // imágenes generada antes de `composer miniaturas`. Si faltan, la planta en SVG.
        $cards = array_map(function (array $s) use ($projects): array {
            $s['images'] = $this->images->find($s['slug'], $projects[$s['slug']]);
            $s['svg'] = null === $s['images'] ? TemplateThumbnail::svg($s['project']) : null;
            unset($s['project']);

            return $s;
        }, $summaries);

        return $this->render('gallery/index.html.twig', ['cards' => $cards, 'nav' => 'gallery', 'assistant' => $this->assistant->enabled(), 'config' => ClientConfig::json()]);
    }

    #[Route('/catalogo', name: 'catalog', methods: ['GET'])]
    public function catalog(): Response
    {
        return $this->render('catalog/index.html.twig', ['nav' => 'catalog', 'sys' => ClientConfig::catalog()]);
    }

    #[Route('/estilos', name: 'styles', methods: ['GET'])]
    public function styles(): Response
    {
        return $this->render('styles/index.html.twig', ['nav' => 'styles', 'config' => ClientConfig::json()]);
    }
}
