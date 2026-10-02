<?php

declare(strict_types=1);

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\Routing\Attribute\Route;

/** Enlace corto de una casa compartida: `/c/{id}` abre el editor con esa casa. */
final class ShareController extends AbstractController
{
    #[Route('/c/{id}', name: 'shared_house', methods: ['GET'], requirements: ['id' => '[a-f0-9]{24}'])]
    public function open(string $id): RedirectResponse
    {
        return $this->redirectToRoute('editor', ['casa' => $id]);
    }
}
