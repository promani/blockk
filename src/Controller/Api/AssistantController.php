<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Assistant\Assistant;
use App\Assistant\Attachment;
use App\Assistant\Conversations;
use App\Domain\Model\InvalidProjectException;
use App\Http\JsonBody;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Asistente de diseño por chat. Sin login: el navegador manda un id de cliente aleatorio (`client`) y sólo accede a
 * sus conversaciones y diseños. Hay límites de uso por IP y por día porque cada mensaje consume el modelo.
 */
#[Route('/api/assistant', name: 'api_assistant_')]
final class AssistantController extends AbstractController
{
    public function __construct(
        private readonly Assistant $assistant,
        private readonly Conversations $conversations,
        #[Autowire(env: 'int:ASSISTANT_DAILY_LIMIT')] private readonly int $dailyLimit,
        #[Autowire(env: 'int:ASSISTANT_HOURLY_LIMIT')] private readonly int $hourlyLimit,
    ) {
    }

    #[Route('/status', name: 'status', methods: ['GET'])]
    public function status(): JsonResponse
    {
        return $this->json(['enabled' => $this->assistant->enabled()]);
    }

    #[Route('/conversations', name: 'start', methods: ['POST'])]
    public function start(Request $request): JsonResponse
    {
        $body = JsonBody::decode($request);
        $client = (string) ($body['client'] ?? '');
        if (null !== ($error = $this->guard($request, $client))) {
            return $error;
        }
        set_time_limit(300);
        try {
            $conv = $this->assistant->start($client, (array) ($body['inicio'] ?? []), (string) ($body['modo'] ?? 'galeria'), (string) ($body['texto'] ?? ''), $this->answers($body), Attachment::fromRequest($body['adjunto'] ?? null));
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        } catch (\InvalidArgumentException $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        }
        $this->conversations->save($conv);

        return $this->json($this->view($conv), Response::HTTP_CREATED);
    }

    #[Route('/conversations/{id}', name: 'show', methods: ['GET'])]
    public function show(string $id, Request $request): JsonResponse
    {
        $conv = $this->conversations->find($id, (string) $request->query->get('client', ''));

        return null === $conv ? $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND) : $this->json($this->view($conv));
    }

    #[Route('/conversations/{id}/messages', name: 'reply', methods: ['POST'])]
    public function reply(string $id, Request $request): JsonResponse
    {
        $body = JsonBody::decode($request);
        $client = (string) ($body['client'] ?? '');
        $conv = $this->conversations->find($id, $client);
        if (null === $conv) {
            return $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }
        if (null !== ($error = $this->guard($request, $client))) {
            return $error;
        }
        set_time_limit(300);
        $before = count($conv['events']);
        try {
            $conv = $this->assistant->reply($conv, (string) ($body['texto'] ?? ''), $this->answers($body), is_array($body['project'] ?? null) ? $body['project'] : null, Attachment::fromRequest($body['adjunto'] ?? null), isset($body['modo']) ? (string) $body['modo'] : null);
        } catch (InvalidProjectException $e) {
            return $this->json(['error' => 'invalid_project', 'details' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        } catch (\InvalidArgumentException $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        }
        $this->conversations->save($conv);

        return $this->json($this->view($conv) + ['nuevos' => max(0, count($conv['events']) - $before)]);
    }

    #[Route('/designs/{id}', name: 'design', methods: ['GET'])]
    public function design(string $id, Request $request): JsonResponse
    {
        $d = $this->conversations->design($id, (string) $request->query->get('client', ''));

        return null === $d ? $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND) : $this->json(['project' => $d['project'], 'nombre' => $d['nombre'], 'programa' => $d['programa'] ?? null]);
    }

    /**
     * Respuestas a un formulario: {id de pregunta: [ids de opción]} (máx. 10 preguntas y 10 opciones cada una).
     *
     * @param array<string, mixed> $body
     *
     * @return array<string, list<string>>
     */
    private function answers(array $body): array
    {
        $out = [];
        foreach (array_slice((array) ($body['respuestas'] ?? []), 0, 10, true) as $q => $ids) {
            $ids = array_values(array_filter(array_map('strval', array_slice((array) $ids, 0, 10)), static fn (string $i): bool => '' !== $i));
            if ([] !== $ids) {
                $out[(string) $q] = $ids;
            }
        }

        return $out;
    }

    private function guard(Request $request, string $client): ?JsonResponse
    {
        if (!Conversations::validClient($client)) {
            return $this->json(['error' => 'Falta el identificador del navegador.'], Response::HTTP_BAD_REQUEST);
        }
        if (!$this->assistant->enabled()) {
            return $this->json(['error' => 'El asistente no está configurado.'], Response::HTTP_SERVICE_UNAVAILABLE);
        }
        $ip = $request->getClientIp() ?? 'unknown';
        $ok = $this->conversations->allow('ip:'.sha1($ip).':h', 3600, $this->hourlyLimit)
            && $this->conversations->allow('day:'.date('Ymd'), 86400, $this->dailyLimit);

        return $ok ? null : $this->json(['error' => 'Se alcanzó el límite de uso del asistente. Probá de nuevo más tarde.'], Response::HTTP_TOO_MANY_REQUESTS);
    }

    /**
     * @param array<string, mixed> $conv
     *
     * @return array<string, mixed>
     */
    private function view(array $conv): array
    {
        $events = array_map(static function (array $e): array {
            unset($e['detalle']); // el detalle técnico de los errores queda en el servidor

            return $e;
        }, $conv['events']);

        return [
            'id' => $conv['id'],
            'eventos' => $events,
            'diseno' => null === $conv['draft'] ? null : ['id' => $conv['id'], 'nombre' => $conv['draft']['summary']['nombre'], 'version' => $conv['draft']['version']],
            'activa' => $conv['turns'] < Assistant::MAX_TURNS,
        ];
    }
}
