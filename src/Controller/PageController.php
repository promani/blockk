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
        // hash de cada plantilla (el mismo de las miniaturas): si cambia una casa, no quedan tarjetas con imágenes viejas.
        $hashes = array_map(fn (string $slug): string => TemplateImages::hash($this->templates->project($slug)), $this->templates->slugs());
        $cards = $this->cache->get('gallery.cards.v3.'.sha1(implode('|', $hashes)), function (ItemInterface $item): array {
            $item->expiresAfter(3600);

            return array_map(function (array $s): array {
                // Planta e isométrica pregeneradas con el dibujo del editor; si faltan, la planta en SVG.
                $s['images'] = $this->images->find($s['slug'], $this->templates->project($s['slug']));
                $s['svg'] = null === $s['images'] ? TemplateThumbnail::svg($s['project']) : null;
                unset($s['project']);

                return $s;
            }, $this->templates->all());
        });

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
