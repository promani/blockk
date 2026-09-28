<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Domain\Bom\QuickCalculator;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Solar\OpeningSuggester;
use App\Domain\Solar\Season;
use App\Domain\Solar\SunCalculator;
use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateThumbnail;
use App\Http\JsonBody;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api', name: 'api_')]
final class ProjectApiController extends AbstractController
{
    public function __construct(
        private readonly ProjectAnalyzer $analyzer,
        private readonly OpeningSuggester $suggester,
        private readonly SunCalculator $sun,
        private readonly TemplateCatalog $templates,
        private readonly QuickCalculator $calculator,
    ) {
    }

    /** Normaliza el proyecto y devuelve despiece por hiladas, cómputo, validaciones y telemetría. */
    #[Route('/analyze', name: 'analyze', methods: ['POST'])]
    public function analyze(Request $request): JsonResponse
    {
        try {
            $project = ProjectFactory::fromArray(JsonBody::decode($request));

            return $this->json($this->analyzer->analyze($project));
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }

    /** Sugerencias bioclimáticas de aberturas (ganancia solar de invierno + ventilación cruzada). */
    #[Route('/suggest', name: 'suggest', methods: ['POST'])]
    public function suggest(Request $request): JsonResponse
    {
        try {
            [$normalized] = $this->analyzer->normalize(ProjectFactory::fromArray(JsonBody::decode($request)));
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        return $this->json(['suggestions' => $this->suggester->suggest($normalized, $this->analyzer->analyzeLevels($normalized))]);
    }

    /** Trayectoria solar (06:00–19:00 cada 15 min) para una latitud y época del año. */
    #[Route('/solar', name: 'solar', methods: ['GET'])]
    public function solar(Request $request): JsonResponse
    {
        $lat = (float) $request->query->get('lat', -34.6);
        $season = Season::tryFrom((string) $request->query->get('season', 'winter'));
        if ($lat < -66.0 || $lat > 66.0 || null === $season) {
            return $this->json(['error' => 'invalid_query'], Response::HTTP_BAD_REQUEST);
        }

        return $this->json([
            'lat' => $lat,
            'season' => $season->value,
            'label' => $season->label($lat),
            'path' => $this->sun->path($lat, $season),
        ]);
    }

    #[Route('/templates', name: 'templates', methods: ['GET'])]
    public function templates(): JsonResponse
    {
        return $this->json(array_map(static function (array $s): array {
            unset($s['project']);

            return $s;
        }, $this->templates->all()));
    }

    #[Route('/templates/{slug}', name: 'template', methods: ['GET'], requirements: ['slug' => '[a-z0-9-]+'])]
    public function template(string $slug): JsonResponse
    {
        if (!$this->templates->has($slug)) {
            return $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }

        return $this->json($this->templates->project($slug));
    }

    /** Miniatura SVG de una plantilla o de un proyecto enviado por POST. */
    #[Route('/thumbnail', name: 'thumbnail', methods: ['POST'])]
    public function thumbnail(Request $request): Response
    {
        try {
            [$normalized] = $this->analyzer->normalize(ProjectFactory::fromArray(JsonBody::decode($request)));
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        return new Response(TemplateThumbnail::svg($normalized->toArray()), 200, ['Content-Type' => 'image/svg+xml']);
    }

    /** Calculadora rápida de paño y mortero. */
    #[Route('/calc/panel', name: 'calc_panel', methods: ['GET'])]
    public function panel(Request $request): JsonResponse
    {
        try {
            return $this->json($this->calculator->panel(
                (float) $request->query->get('length', 0),
                (float) $request->query->get('height', 0),
                (float) $request->query->get('t', 0),
                (float) $request->query->get('openings', 0),
                (int) $request->query->get('waste', 5),
            ));
        } catch (\InvalidArgumentException $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        }
    }
}
