<?php

declare(strict_types=1);

namespace App\Assistant;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Kimi (Moonshot AI) por su API compatible con OpenAI (KIMI_API_KEY, KIMI_BASE_URL), con dos modelos:
 *  - KIMI_MODEL (pesado): arma el JSON de la casa y las acciones directas;
 *  - KIMI_MODEL_LIGHT (liviano, más barato): conversa, pregunta y decide cuándo delegar. Vacío: todo lo hace el pesado.
 *  - KIMI_MODEL_VISION (opcional): el que recibe los turnos con la imagen de un plano. Vacío: los lee el pesado, que
 *    tiene que aceptar imágenes.
 *
 * Con una imagen en la conversación el razonamiento se desactiva: razonando, el modelo gasta toda la respuesta en las
 * coordenadas de un plano y no llega a contestar (medido: más de 4 minutos sin resultado contra ~30 s sin razonar).
 */
final class KimiClient implements LlmClient
{
    public function __construct(
        private readonly HttpClientInterface $http,
        #[Autowire(env: 'KIMI_API_KEY')] private readonly string $apiKey,
        #[Autowire(env: 'KIMI_MODEL')] private readonly string $model,
        #[Autowire(env: 'KIMI_BASE_URL')] private readonly string $baseUrl,
        #[Autowire(env: 'default::KIMI_MODEL_LIGHT')] private readonly ?string $lightModel = null,
        #[Autowire(env: 'default::KIMI_MODEL_VISION')] private readonly ?string $visionModel = null,
    ) {
    }

    public function enabled(): bool
    {
        return '' !== trim($this->apiKey) && '' !== trim($this->model);
    }

    public function hasLight(): bool
    {
        return '' !== trim((string) $this->lightModel) && trim((string) $this->lightModel) !== trim($this->model);
    }

    public function chat(array $messages, array $tools, string $tier = self::HEAVY): array
    {
        if (!$this->enabled()) {
            throw new LlmUnavailable('El asistente no está configurado (faltan KIMI_API_KEY o KIMI_MODEL).');
        }
        $model = trim(self::LIGHT === $tier && $this->hasLight() ? (string) $this->lightModel : $this->model);
        $withImage = array_any($messages, Attachment::in(...));
        if ($withImage && self::HEAVY === $tier && '' !== trim((string) $this->visionModel)) {
            $model = trim((string) $this->visionModel);
        }
        try {
            $response = $this->http->request('POST', rtrim($this->baseUrl, '/').'/chat/completions', [
                'auth_bearer' => trim($this->apiKey),
                'json' => ['model' => $model, 'messages' => $messages, 'tools' => $tools, 'tool_choice' => 'auto', 'max_tokens' => $withImage ? 8192 : 4096]
                    + ($withImage ? ['thinking' => ['type' => 'disabled']] : []),
                'timeout' => 60,
                'max_duration' => 150,
            ]);
            $status = $response->getStatusCode();
            $data = $response->toArray(false);
        } catch (ExceptionInterface $e) {
            throw new LlmUnavailable("No se pudo contactar al modelo {$model}: ".$e->getMessage(), 0, $e);
        }
        if ($status >= 400) {
            $detail = is_array($data['error'] ?? null) ? (string) ($data['error']['message'] ?? '') : '';
            throw new LlmUnavailable(sprintf('El modelo %s respondió %d%s', $model, $status, '' !== $detail ? ': '.$detail : ''));
        }
        $message = $data['choices'][0]['message'] ?? null;
        if (!is_array($message)) {
            throw new LlmUnavailable('Respuesta del modelo sin mensaje.');
        }

        return $message;
    }
}
