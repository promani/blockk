<?php

declare(strict_types=1);

namespace App\Assistant;

/**
 * Modelo de lenguaje con llamadas a herramientas (formato de mensajes de OpenAI Chat Completions), en dos niveles:
 * «liviano» (conversa, pregunta y decide) y «pesado» (arma o edita la casa).
 */
interface LlmClient
{
    public const string LIGHT = 'liviano';
    public const string HEAVY = 'pesado';

    public function enabled(): bool;

    /** ¿Hay un modelo liviano distinto del pesado? */
    public function hasLight(): bool;

    /**
     * @param list<array<string, mixed>> $messages
     * @param list<array<string, mixed>> $tools
     *
     * @return array<string, mixed> el mensaje del asistente (role, content, tool_calls…)
     *
     * @throws LlmUnavailable
     */
    public function chat(array $messages, array $tools, string $tier = self::HEAVY): array;
}
