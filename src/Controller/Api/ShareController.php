<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Http\JsonBody;
use App\Share\SharedProjects;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/** Enlaces para compartir un proyecto: quien tiene el enlace lo ve y lo edita (sin cuentas). */
#[Route('/api/compartidos', name: 'api_share_')]
final class ShareController extends AbstractController
{
    public function __construct(private readonly SharedProjects $shares)
    {
    }

    #[Route('', name: 'create', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        if (!$this->shares->allow('new:'.sha1($request->getClientIp() ?? '?'), 60)) {
            return $this->json(['error' => 'Se crearon demasiados enlaces desde esta conexión. Probá más tarde.'], Response::HTTP_TOO_MANY_REQUESTS);
        }
        $project = $this->project($request);
        if ($project instanceof JsonResponse) {
            return $project;
        }
        $id = $this->shares->create($project);

        return $this->json(['id' => $id, 'version' => 1, 'url' => $request->getSchemeAndHttpHost().'/?compartido='.$id], Response::HTTP_CREATED);
    }

    #[Route('/{id}', name: 'show', methods: ['GET'])]
    public function show(string $id): JsonResponse
    {
        $doc = $this->shares->get($id);

        return null === $doc
            ? $this->json(['error' => 'El enlace no existe o venció.'], Response::HTTP_NOT_FOUND)
            : $this->json(['id' => $id] + $doc);
    }

    #[Route('/{id}', name: 'save', methods: ['PUT'])]
    public function save(string $id, Request $request): JsonResponse
    {
        if (!$this->shares->allow('save:'.sha1($request->getClientIp() ?? '?'), 3000)) {
            return $this->json(['error' => 'Demasiados guardados seguidos. Probá en un rato.'], Response::HTTP_TOO_MANY_REQUESTS);
        }
        $project = $this->project($request);
        if ($project instanceof JsonResponse) {
            return $project;
        }
        $saved = $this->shares->save($id, $project);

        return null === $saved
            ? $this->json(['error' => 'El enlace no existe o venció.'], Response::HTTP_NOT_FOUND)
            : $this->json(['id' => $id] + $saved);
    }

    /** @return array<string, mixed>|JsonResponse el proyecto del cuerpo, validado por el motor */
    private function project(Request $request): array|JsonResponse
    {
        $body = JsonBody::decode($request);
        $project = is_array($body['project'] ?? null) ? $body['project'] : null;
        if (null === $project) {
            return $this->json(['error' => 'Falta el proyecto.'], Response::HTTP_BAD_REQUEST);
        }
        try {
            ProjectFactory::fromArray($project);
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        return $project;
    }
}
