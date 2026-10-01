<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Assistant\Conversations;
use App\Domain\Design\HouseDescriber;
use App\Domain\Design\HouseGenerator;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateThumbnail;
use App\Http\JsonBody;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;

/**
 * API de administración para crear casas en el servidor desde fuera del navegador (p. ej. Claude Code). Se autentica
 * con `Authorization: Bearer <ADMIN_API_TOKEN>`; sin token configurado no existe (404). Las casas se guardan como
 * diseños de un cliente propio derivado del token y se abren en el editor con `/abrir/{id}`.
 */
final class AdminApiController extends AbstractController
{
    public function __construct(
        private readonly ProjectAnalyzer $analyzer,
        private readonly HouseGenerator $generator,
        private readonly HouseDescriber $describer,
        private readonly TemplateCatalog $templates,
        private readonly Conversations $conversations,
        #[Autowire(env: 'ADMIN_API_TOKEN')] private readonly string $token,
    ) {
    }

    #[Route('/api/admin/ping', name: 'api_admin_ping', methods: ['GET'])]
    public function ping(Request $request): JsonResponse
    {
        return $this->authorize($request) ?? $this->json(['ok' => true, 'plantillas' => $this->templates->slugs(), 'tiposDeAmbiente' => array_keys(HouseGenerator::TYPES)]);
    }

    /**
     * Crea una casa. Cuerpo: una de `programa` ({niveles, techo?, ambientes:[{tipo, nivel?, m2?}]}), `plantilla` (slug)
     * o `project` (JSON completo del editor); `nombre` es opcional.
     */
    #[Route('/api/admin/casas', name: 'api_admin_create', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        if (null !== ($denied = $this->authorize($request))) {
            return $denied;
        }
        $body = JsonBody::decode($request);
        $names = [];
        $program = null;
        try {
            if (is_array($body['programa'] ?? null)) {
                $house = $this->generator->generate($body['programa']);
                [$project, $names, $program] = [$house['project'], $house['rooms'], $house['program']];
            } elseif (is_string($body['plantilla'] ?? null)) {
                $project = $this->templates->project($body['plantilla']);
            } elseif (is_array($body['project'] ?? null)) {
                $project = $body['project'];
            } else {
                return $this->json(['error' => 'Mandá `programa`, `plantilla` o `project`.'], Response::HTTP_BAD_REQUEST);
            }
            if (isset($body['nombre']) && '' !== trim((string) $body['nombre'])) {
                $project['name'] = mb_substr(trim((string) $body['nombre']), 0, 80);
            }
            $result = $this->analyzer->analyze(ProjectFactory::fromArray($project));
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        } catch (\InvalidArgumentException $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        }

        $summary = $this->describer->summary($result, $names);
        $id = Conversations::newId();
        $this->conversations->saveDesign([
            'id' => $id,
            'client' => $this->client(),
            'nombre' => $summary['nombre'],
            'resumen' => $summary,
            'svg' => TemplateThumbnail::svg($result['project']),
            'project' => $result['project'],
            'programa' => $program,
        ]);

        return $this->json(['id' => $id, 'url' => $this->openUrl($id), 'resumen' => $summary], Response::HTTP_CREATED);
    }

    #[Route('/api/admin/casas', name: 'api_admin_list', methods: ['GET'])]
    public function list(Request $request): JsonResponse
    {
        if (null !== ($denied = $this->authorize($request))) {
            return $denied;
        }
        $casas = array_map(fn (array $d): array => [
            'id' => $d['id'],
            'nombre' => $d['nombre'],
            'actualizada' => $d['updated'],
            'url' => $this->openUrl($d['id']),
        ], $this->conversations->designs($this->client()));

        return $this->json(['casas' => $casas]);
    }

    #[Route('/api/admin/casas/{id}', name: 'api_admin_show', methods: ['GET'])]
    public function show(string $id, Request $request): JsonResponse
    {
        if (null !== ($denied = $this->authorize($request))) {
            return $denied;
        }
        $d = $this->conversations->design($id, $this->client());

        return null === $d ? $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND) : $this->json(['project' => $d['project'], 'resumen' => $d['resumen']]);
    }

    /** Proyecto de una casa creada por la API, para quien tenga el link (el id es aleatorio e impredecible). */
    #[Route('/api/casas/{id}', name: 'api_admin_public', methods: ['GET'])]
    public function publicProject(string $id): JsonResponse
    {
        $d = '' === $this->token ? null : $this->conversations->design($id, $this->client());

        return null === $d ? $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND) : $this->json(['project' => $d['project']]);
    }

    /** Carga la casa en el editor del navegador (mismo mecanismo que «Abrir en el editor» del asistente). */
    #[Route('/abrir/{id}', name: 'admin_open', methods: ['GET'], requirements: ['id' => '[a-f0-9]{24}'])]
    public function open(string $id): Response
    {
        $html = <<<'HTML'
            <!doctype html><html lang="es"><meta charset="utf-8"><title>Abriendo casa…</title>
            <p style="font-family:sans-serif">Abriendo la casa en el editor…</p>
            <script>
            fetch('/api/casas/' + location.pathname.split('/').pop())
              .then((r) => r.ok ? r.json() : Promise.reject(new Error('La casa no existe o venció.')))
              .then(({ project }) => { localStorage.setItem('blockk.project.v1', JSON.stringify(project)); location.replace('/'); })
              .catch((e) => { document.body.textContent = e.message; });
            </script></html>
            HTML;

        return new Response($html);
    }

    /** Link absoluto; detrás del proxy de producción Symfony ve http, así que se fuerza https salvo en local. */
    private function openUrl(string $id): string
    {
        $url = $this->generateUrl('admin_open', ['id' => $id], UrlGeneratorInterface::ABSOLUTE_URL);

        return (string) preg_replace('#^http://(?!localhost|127\.0\.0\.1)#', 'https://', $url);
    }

    private function authorize(Request $request): ?JsonResponse
    {
        if ('' === $this->token) {
            return $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }
        $given = (string) preg_replace('/^Bearer\s+/i', '', (string) $request->headers->get('Authorization', ''));

        return hash_equals($this->token, $given) ? null : $this->json(['error' => 'unauthorized'], Response::HTTP_UNAUTHORIZED, ['WWW-Authenticate' => 'Bearer']);
    }

    /** Cliente de las casas de la API: derivado del token, así que sólo lo conoce quien lo tenga. */
    private function client(): string
    {
        return substr(hash_hmac('sha256', 'admin-api', $this->token), 0, 32);
    }
}
