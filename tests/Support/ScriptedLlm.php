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

    /** @var list<string> nivel de cada llamada (liviano / pesado) */
    public array $tiers = [];

    public function __construct(public bool $light = false)
    {
    }

    public function enabled(): bool
    {
        return true;
    }

    public function hasLight(): bool
    {
        return $this->light;
    }

    public function chat(array $messages, array $tools, string $tier = self::HEAVY): array
    {
        $this->received[] = $messages;
        $this->tiers[] = $tier;
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

    /**
     * Una pregunta (id «q») con opciones id => texto.
     *
     * @param array<string, string> $options
     *
     * @return array<string, mixed>
     */
    public static function ask(string $question, array $options, bool $multiple = false, string $id = 'q1'): array
    {
        return self::form([['id' => 'q', 'pregunta' => $question, 'multiple' => $multiple, 'opciones' => $options]], $id);
    }

    /**
     * Varias preguntas: [{id, pregunta, multiple?, opciones: id => texto}].
     *
     * @param list<array<string, mixed>> $questions
     *
     * @return array<string, mixed>
     */
    public static function form(array $questions, string $id = 'q1'): array
    {
        return self::call('preguntar', ['preguntas' => array_map(static fn (array $q): array => [
            'id' => $q['id'], 'pregunta' => $q['pregunta'], 'multiple' => $q['multiple'] ?? false,
            'opciones' => array_map(static fn (string $k, string $v): array => ['id' => $k, 'texto' => $v], array_keys($q['opciones']), $q['opciones']),
        ], $questions)], $id);
    }
}
