<?php

declare(strict_types=1);

namespace App\Tests\Support;

use App\Assistant\LlmClient;
use App\Assistant\LlmUnavailable;

/** Modelo guionado: devuelve los mensajes encolados en orden y registra lo que recibió. */
final class ScriptedLlm implements LlmClient
{
    /** @var list<array<string, mixed>|\Throwable> */
    public array $queue = [];

    /** @var list<list<array<string, mixed>>> */
    public array $received = [];

    public function enabled(): bool
    {
        return true;
    }

    public function chat(array $messages, array $tools): array
    {
        $this->received[] = $messages;
        $next = array_shift($this->queue) ?? throw new LlmUnavailable('guion agotado');
        if ($next instanceof \Throwable) {
            throw $next;
        }

        return $next;
    }

    /** @param array<string, mixed> $args */
    public static function call(string $name, array $args, string $id = 'c1', string $text = ''): array
    {
        return ['role' => 'assistant', 'content' => $text, 'tool_calls' => [['id' => $id, 'type' => 'function', 'function' => ['name' => $name, 'arguments' => json_encode($args, JSON_THROW_ON_ERROR)]]]];
    }

    public static function say(string $text): array
    {
        return ['role' => 'assistant', 'content' => $text];
    }

    /** @return array<string, mixed> */
    public static function ask(string $question, array $options, bool $multiple = false, string $id = 'q1'): array
    {
        return self::call('preguntar', ['pregunta' => $question, 'opciones' => array_map(static fn (string $k, string $v): array => ['id' => $k, 'texto' => $v], array_keys($options), $options), 'multiple' => $multiple], $id);
    }
}
