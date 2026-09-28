<?php

declare(strict_types=1);

namespace App\EventListener;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Cabeceras de seguridad para todas las respuestas. El importmap de AssetMapper emite un <script> en línea,
 * por eso script-src admite 'unsafe-inline'; el resto de las fuentes queda restringido al propio origen.
 */
#[AsEventListener(event: KernelEvents::RESPONSE)]
final class SecurityHeadersListener
{
    private const string CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
        ."img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; "
        ."base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    public function __invoke(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $headers = $event->getResponse()->headers;
        $headers->set('X-Content-Type-Options', 'nosniff');
        $headers->set('X-Frame-Options', 'DENY');
        $headers->set('Referrer-Policy', 'same-origin');
        $headers->set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        if (!$headers->has('Content-Security-Policy')) {
            $headers->set('Content-Security-Policy', self::CSP);
        }
    }
}
