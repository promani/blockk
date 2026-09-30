<?php

declare(strict_types=1);

namespace App\Assistant;

/** Modelo de lenguaje con llamadas a herramientas (formato de mensajes de OpenAI Chat Completions). */
interface LlmClient
{
    public function enabled(): bool;

    /**
     * @param list<array<string, mixed>> $messages
     * @param list<array<string, mixed>> $tools
     *
     * @return array<string, mixed> el mensaje del asistente (role, content, tool_calls…)
     *
     * @throws LlmUnavailable
     */
    public function chat(array $messages, array $tools): array;
}
