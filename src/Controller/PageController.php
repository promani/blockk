<?php

declare(strict_types=1);

namespace App\Controller;

use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateThumbnail;
use App\Http\ClientConfig;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

final class PageController extends AbstractController
{
    public function __construct(private readonly TemplateCatalog $templates, private readonly CacheInterface $cache)
    {
    }

    #[Route('/', name: 'editor', methods: ['GET'])]
    public function editor(): Response
    {
        return $this->render('editor/index.html.twig', ['config' => ClientConfig::json(), 'nav' => 'editor']);
    }

    #[Route('/computo', name: 'bom', methods: ['GET'])]
    public function bom(): Response
    {
        return $this->render('bom/index.html.twig', ['config' => ClientConfig::json(), 'nav' => 'bom']);
    }

    #[Route('/galeria', name: 'gallery', methods: ['GET'])]
    public function gallery(): Response
    {
        // Las métricas de las plantillas salen del motor real; se cachean porque son deterministas.
        $cards = $this->cache->get('gallery.cards.v2', function (ItemInterface $item): array {
            $item->expiresAfter(3600);

            return array_map(function (array $s): array {
                $s['svg'] = TemplateThumbnail::svg($s['project']);
                unset($s['project']);

                return $s;
            }, $this->templates->all());
        });

        return $this->render('gallery/index.html.twig', ['cards' => $cards, 'nav' => 'gallery']);
    }

    #[Route('/catalogo', name: 'catalog', methods: ['GET'])]
    public function catalog(): Response
    {
        return $this->render('catalog/index.html.twig', ['nav' => 'catalog']);
    }
}
