<?php

declare(strict_types=1);

namespace App\Assistant;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/** Kimi (Moonshot AI) por su API compatible con OpenAI: KIMI_API_KEY, KIMI_MODEL y KIMI_BASE_URL. */
final class KimiClient implements LlmClient
{
    public function __construct(
        private readonly HttpClientInterface $http,
        #[Autowire(env: 'KIMI_API_KEY')] private readonly string $apiKey,
        #[Autowire(env: 'KIMI_MODEL')] private readonly string $model,
        #[Autowire(env: 'KIMI_BASE_URL')] private readonly string $baseUrl,
    ) {
    }

    public function enabled(): bool
    {
        return '' !== trim($this->apiKey) && '' !== trim($this->model);
    }

    public function chat(array $messages, array $tools): array
    {
        if (!$this->enabled()) {
            throw new LlmUnavailable('El asistente no está configurado (faltan KIMI_API_KEY o KIMI_MODEL).');
        }
        try {
            $response = $this->http->request('POST', rtrim($this->baseUrl, '/').'/chat/completions', [
                'auth_bearer' => trim($this->apiKey),
                'json' => ['model' => trim($this->model), 'messages' => $messages, 'tools' => $tools, 'tool_choice' => 'auto', 'max_tokens' => 4096],
                'timeout' => 60,
                'max_duration' => 150,
            ]);
            $status = $response->getStatusCode();
            $data = $response->toArray(false);
        } catch (ExceptionInterface $e) {
            throw new LlmUnavailable('No se pudo contactar al modelo: '.$e->getMessage(), 0, $e);
        }
        if ($status >= 400) {
            $detail = is_array($data['error'] ?? null) ? (string) ($data['error']['message'] ?? '') : '';
            throw new LlmUnavailable(sprintf('El modelo respondió %d%s', $status, '' !== $detail ? ': '.$detail : ''));
        }
        $message = $data['choices'][0]['message'] ?? null;
        if (!is_array($message)) {
            throw new LlmUnavailable('Respuesta del modelo sin mensaje.');
        }

        return $message;
    }
}
