<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Domain\Design\HouseDescriber;
use App\Domain\Design\HouseEditor;
use App\Domain\Design\HouseGenerator;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateCatalog;
use App\Http\JsonBody;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\String\Slugger\AsciiSlugger;

/**
 * API de administración de la Galería (para Claude Code u otro cliente): crea, edita y borra modelos que quedan
 * disponibles para todas las personas, que después deciden si usarlos. Se autentica con
 * `Authorization: Bearer <ADMIN_API_TOKEN>`; sin token configurado no existe (404). Las plantillas del código no se
 * tocan: se pueden clonar con `{plantilla: slug}` bajo otro nombre.
 */
#[Route('/api/admin', name: 'api_admin_')]
final class AdminApiController extends AbstractController
{
    public function __construct(
        private readonly ProjectAnalyzer $analyzer,
        private readonly HouseGenerator $generator,
        private readonly HouseEditor $editor,
        private readonly HouseDescriber $describer,
        private readonly TemplateCatalog $templates,
        #[Autowire(env: 'ADMIN_API_TOKEN')] private readonly string $token,
    ) {
    }

    #[Route('/ping', name: 'ping', methods: ['GET'])]
    public function ping(Request $request): JsonResponse
    {
        return $this->authorize($request) ?? $this->json(['ok' => true, 'plantillas' => $this->templates->slugs(), 'tiposDeAmbiente' => array_keys(HouseGenerator::TYPES)]);
    }

    /** Modelos de la Galería: los del código (`propio: false`, no editables) y los creados por la API. */
    #[Route('/galeria', name: 'list', methods: ['GET'])]
    public function list(Request $request): JsonResponse
    {
        if (null !== ($denied = $this->authorize($request))) {
            return $denied;
        }
        $customs = $this->templates->customs();
        $items = array_map(fn (string $slug): array => [
            'slug' => $slug,
            'nombre' => $this->templates->name($slug),
            'propio' => isset($customs[$slug]),
        ], $this->templates->slugs());

        return $this->json(['modelos' => $items, 'galeria' => $this->galleryUrl()]);
    }

    #[Route('/galeria/{slug}', name: 'show', methods: ['GET'], requirements: ['slug' => '[a-z0-9-]+'])]
    public function show(string $slug, Request $request): JsonResponse
    {
        if (null !== ($denied = $this->authorize($request))) {
            return $denied;
        }
        if (!$this->templates->has($slug)) {
            return $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }
        $s = $this->templates->summary($slug);

        return $this->json(['slug' => $slug, 'propio' => !$this->templates->isBuiltin($slug), 'nombre' => $s['name'], 'descripcion' => $s['description'], 'etiquetas' => $s['tags'], 'project' => $s['project']]);
    }

    /**
     * Crea un modelo. Cuerpo: `nombre` (obligatorio), `slug?`, `descripcion?`, `etiquetas?` y una de `programa`
     * ({niveles, techo?, ambientes:[{tipo, nivel?, m2?}]}), `plantilla` (slug a clonar) o `project` (JSON del editor).
     */
    #[Route('/galeria', name: 'create', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        if (null !== ($denied = $this->authorize($request))) {
            return $denied;
        }
        $body = JsonBody::decode($request);
        $name = trim((string) ($body['nombre'] ?? ''));
        if ('' === $name) {
            return $this->json(['error' => 'Falta `nombre`.'], Response::HTTP_BAD_REQUEST);
        }
        $slug = (string) ($body['slug'] ?? '') ?: strtolower((new AsciiSlugger())->slug($name)->toString());
        if (1 !== preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $slug) || strlen($slug) > 60) {
            return $this->json(['error' => 'El `slug` admite minúsculas, números y guiones (máx. 60).'], Response::HTTP_BAD_REQUEST);
        }
        if ($this->templates->has($slug)) {
            return $this->json(['error' => "Ya existe un modelo «{$slug}». Usá PUT para editarlo u otro nombre."], Response::HTTP_CONFLICT);
        }

        return $this->save($slug, $body, null);
    }

    /** Edita un modelo propio. Todo es opcional: `nombre`, `descripcion`, `etiquetas`, y el dibujo (`programa`, `plantilla`, `project` u `operaciones` sobre el actual). */
    #[Route('/galeria/{slug}', name: 'update', methods: ['PUT', 'PATCH'], requirements: ['slug' => '[a-z0-9-]+'])]
    public function update(string $slug, Request $request): JsonResponse
    {
        if (null !== ($denied = $this->authorize($request))) {
            return $denied;
        }
        $current = $this->templates->customs()[$slug] ?? null;
        if (null === $current) {
            return $this->templates->has($slug)
                ? $this->json(['error' => 'Es una plantilla del código: clonala con POST {plantilla, nombre}.'], Response::HTTP_FORBIDDEN)
                : $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }

        return $this->save($slug, JsonBody::decode($request), $current);
    }

    #[Route('/galeria/{slug}', name: 'delete', methods: ['DELETE'], requirements: ['slug' => '[a-z0-9-]+'])]
    public function delete(string $slug, Request $request): JsonResponse
    {
        if (null !== ($denied = $this->authorize($request))) {
            return $denied;
        }
        if ($this->templates->deleteCustom($slug)) {
            return $this->json(['borrado' => $slug]);
        }

        return $this->templates->has($slug)
            ? $this->json(['error' => 'Es una plantilla del código y no se puede borrar.'], Response::HTTP_FORBIDDEN)
            : $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
    }

    /**
     * @param array<string, mixed>      $body
     * @param array<string, mixed>|null $current modelo existente (edición) o null (alta)
     */
    private function save(string $slug, array $body, ?array $current): JsonResponse
    {
        try {
            $project = $this->project($body, $current['project'] ?? null);
            if (null === $project) {
                return $this->json(['error' => 'Mandá `programa`, `plantilla` o `project`.'], Response::HTTP_BAD_REQUEST);
            }
            $name = trim((string) ($body['nombre'] ?? $current['name'] ?? ''));
            $project['name'] = mb_substr($name, 0, 80);
            $result = $this->analyzer->analyze(ProjectFactory::fromArray($project));
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        } catch (\InvalidArgumentException $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        }

        $summary = $this->describer->summary($result);
        $levels = $summary['niveles'];
        try {
            $this->templates->saveCustom([
                'slug' => $slug,
                'name' => mb_substr($name, 0, 120),
                'description' => mb_substr(trim((string) ($body['descripcion'] ?? $current['description'] ?? sprintf('%d planta%s, %s m² útiles.', $levels, $levels > 1 ? 's' : '', number_format($summary['superficieUtilM2'], 1, ',', '.')))), 0, 600),
                'tags' => $this->tags($body['etiquetas'] ?? $current['tags'] ?? [sprintf('%d planta%s', $levels, $levels > 1 ? 's' : '')]),
                'project' => $result['project'],
            ]);
        } catch (\InvalidArgumentException $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_CONFLICT);
        }

        return $this->json(['slug' => $slug, 'galeria' => $this->galleryUrl(), 'resumen' => $summary], null === $current ? Response::HTTP_CREATED : Response::HTTP_OK);
    }

    /**
     * El dibujo pedido, o el actual si sólo se editan datos; null si no hay de dónde sacarlo (alta sin dibujo).
     *
     * @param array<string, mixed>      $body
     * @param array<string, mixed>|null $current
     *
     * @return array<string, mixed>|null
     */
    private function project(array $body, ?array $current): ?array
    {
        if (is_array($body['programa'] ?? null)) {
            return $this->generator->generate($body['programa'])['project'];
        }
        if (is_string($body['plantilla'] ?? null)) {
            return $this->templates->project($body['plantilla']);
        }
        if (is_array($body['project'] ?? null)) {
            return $body['project'];
        }
        if (null === $current) {
            return null;
        }
        if (is_array($body['operaciones'] ?? null)) {
            $analysis = $this->analyzer->analyze(ProjectFactory::fromArray($current))['analysis'];

            return $this->editor->apply($current, $body['operaciones'], $analysis);
        }

        return $current;
    }

    /** @return list<string> */
    private function tags(mixed $tags): array
    {
        $list = array_values(array_filter(array_map(static fn (mixed $t): string => mb_substr(trim((string) $t), 0, 30), is_array($tags) ? $tags : []), static fn (string $t): bool => '' !== $t));

        return array_slice($list, 0, 6);
    }

    /** Link absoluto; detrás del proxy de producción Symfony ve http, así que se fuerza https salvo en local. */
    private function galleryUrl(): string
    {
        $url = $this->generateUrl('gallery', [], UrlGeneratorInterface::ABSOLUTE_URL);

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
}
