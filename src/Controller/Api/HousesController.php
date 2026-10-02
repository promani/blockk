<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Assistant\Conversations;
use App\Domain\Model\InvalidProjectException;
use App\Houses\HouseLimitReached;
use App\Houses\SavedHouses;
use App\Http\JsonBody;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * «Mis casas»: guardar la casa del editor y compartirla por enlace. Sin login: el navegador manda su id aleatorio
 * (`client`, el mismo del asistente) y sólo lista, cambia y borra lo suyo. Leer una casa por su id es público: el id es
 * el enlace que la persona comparte.
 */
#[Route('/api/houses', name: 'api_houses_')]
final class HousesController extends AbstractController
{
    private const int WRITES_PER_HOUR = 120;
    private const int READS_PER_HOUR = 1200;

    public function __construct(private readonly SavedHouses $houses)
    {
    }

    #[Route('', name: 'list', methods: ['GET'])]
    public function list(Request $request): JsonResponse
    {
        $client = (string) $request->query->get('client', '');
        if (!Conversations::validClient($client)) {
            return $this->json(['error' => 'Falta el identificador del navegador.'], Response::HTTP_BAD_REQUEST);
        }

        return $this->limited($request, 'r', self::READS_PER_HOUR) ?? $this->json(['casas' => $this->houses->list($client), 'maximo' => SavedHouses::MAX_PER_CLIENT]);
    }

    #[Route('', name: 'save', methods: ['POST'])]
    public function save(Request $request): JsonResponse
    {
        $body = JsonBody::decode($request);
        $client = (string) ($body['client'] ?? '');
        if (!Conversations::validClient($client)) {
            return $this->json(['error' => 'Falta el identificador del navegador.'], Response::HTTP_BAD_REQUEST);
        }
        if (!is_array($body['project'] ?? null)) {
            return $this->json(['error' => 'Falta el proyecto.'], Response::HTTP_BAD_REQUEST);
        }
        if (null !== ($denied = $this->limited($request, 'w', self::WRITES_PER_HOUR))) {
            return $denied;
        }
        $id = is_string($body['id'] ?? null) ? $body['id'] : null;
        try {
            $card = $this->houses->save($client, $body['project'], $id);
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        } catch (HouseLimitReached $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_CONFLICT);
        }

        return $this->json($card, $card['id'] === $id ? Response::HTTP_OK : Response::HTTP_CREATED);
    }

    /** Una casa guardada: sólo la abre el navegador que la guardó (para otros está «Compartir», /api/compartidos). */
    #[Route('/{id}', name: 'show', methods: ['GET'], requirements: ['id' => '[a-f0-9]{24}'])]
    public function show(string $id, Request $request): JsonResponse
    {
        if (null !== ($denied = $this->limited($request, 'r', self::READS_PER_HOUR))) {
            return $denied;
        }
        $house = $this->houses->find($id);
        $client = (string) $request->query->get('client', '');
        // una casa ajena responde igual que una que no existe
        if (null === $house || !Conversations::validClient($client) || $house['client'] !== $client) {
            return $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }

        return $this->json(['id' => $house['id'], 'name' => $house['name'], 'project' => $house['project'], 'summary' => $house['summary'], 'updated' => $house['updated']]);
    }

    #[Route('/{id}', name: 'delete', methods: ['DELETE'], requirements: ['id' => '[a-f0-9]{24}'])]
    public function delete(string $id, Request $request): JsonResponse
    {
        $client = (string) $request->query->get('client', '');
        if (!Conversations::validClient($client)) {
            return $this->json(['error' => 'Falta el identificador del navegador.'], Response::HTTP_BAD_REQUEST);
        }
        if (null !== ($denied = $this->limited($request, 'w', self::WRITES_PER_HOUR))) {
            return $denied;
        }

        // una casa ajena responde igual que una que no existe
        return $this->houses->delete($id, $client) ? $this->json(['ok' => true]) : $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
    }

    private function limited(Request $request, string $kind, int $perHour): ?JsonResponse
    {
        $ip = $request->getClientIp() ?? 'unknown';

        return $this->houses->allow("{$kind}:".sha1($ip), 3600, $perHour) ? null : $this->json(['error' => 'Demasiados pedidos seguidos. Probá de nuevo más tarde.'], Response::HTTP_TOO_MANY_REQUESTS);
    }
}
