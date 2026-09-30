<?php

declare(strict_types=1);

namespace App\Assistant;

use App\Domain\Design\HouseDescriber;
use App\Domain\Design\HouseEditor;
use App\Domain\Design\HouseGenerator;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateThumbnail;

/**
 * Orquesta una conversación: manda la historia al modelo, ejecuta las herramientas que pide (preguntar, generar,
 * editar, cargar plantilla, ver) y devuelve los eventos para la interfaz. `preguntar` corta el turno hasta que la
 * persona responda.
 *
 * Eventos: usuario {texto} · asistente {texto} · pregunta {pregunta, opciones, multiple} · casa {diseno, nombre, svg,
 * resumen} · error {texto}.
 */
final class Assistant
{
    public const int MAX_STEPS = 8;
    public const int MAX_TURNS = 40;
    private const int MAX_MESSAGES = 90;

    public function __construct(
        private readonly LlmClient $llm,
        private readonly Conversations $conversations,
        private readonly ProjectAnalyzer $analyzer,
        private readonly HouseGenerator $generator,
        private readonly HouseEditor $editor,
        private readonly HouseDescriber $describer,
        private readonly TemplateCatalog $templates,
    ) {
    }

    public function enabled(): bool
    {
        return $this->llm->enabled();
    }

    /**
     * Nueva conversación. $start: {tipo: nueva|plantilla|proyecto, slug?, project?}.
     *
     * @param array<string, mixed> $start
     *
     * @return array<string, mixed> la conversación
     */
    public function start(string $client, array $start): array
    {
        $conv = ['id' => Conversations::newId(), 'client' => $client, 'created' => time(), 'turns' => 0, 'messages' => [], 'events' => [], 'draft' => null];
        $kind = (string) ($start['tipo'] ?? 'nueva');
        if ('plantilla' === $kind) {
            $slug = (string) ($start['slug'] ?? '');
            if (!$this->templates->has($slug)) {
                throw new \InvalidArgumentException('Plantilla desconocida.');
            }
            $name = $this->templates->summary($slug)['name'];
            $this->setDraft($conv, $this->templates->project($slug), [], null);
            $text = "Quiero partir de la plantilla «{$name}» y adaptarla.";
        } elseif ('proyecto' === $kind) {
            if (!is_array($start['project'] ?? null)) {
                throw new \InvalidArgumentException('Falta el proyecto.');
            }
            $this->setDraft($conv, $start['project'], [], null);
            $text = sprintf('Quiero modificar mi proyecto actual («%s»).', $conv['draft']['project']['name'] ?? 'sin nombre');
        } else {
            $text = 'Quiero diseñar una casa nueva.';
        }
        if (null !== $conv['draft']) {
            $conv['events'][] = $this->houseEvent($conv);
        }
        $this->turn($conv, $text, $text);

        return $conv;
    }

    /**
     * Respuesta de la persona: texto libre y/o ids de opciones de la última pregunta.
     *
     * @param array<string, mixed> $conv
     * @param list<string>         $choices
     *
     * @return array<string, mixed> la conversación actualizada
     */
    public function reply(array $conv, string $text, array $choices): array
    {
        $text = trim(mb_substr($text, 0, 800));
        $labels = [];
        if ([] !== $choices) {
            $question = null;
            foreach (array_reverse($conv['events']) as $e) {
                if ('pregunta' === $e['tipo']) {
                    $question = $e;
                    break;
                }
            }
            foreach ($question['opciones'] ?? [] as $o) {
                if (in_array($o['id'], $choices, true)) {
                    $labels[] = $o['texto'];
                }
            }
        }
        if ([] === $labels && '' === $text) {
            throw new \InvalidArgumentException('Escribí un mensaje o elegí una opción.');
        }
        $shown = implode(', ', $labels).([] !== $labels && '' !== $text ? '. ' : '').$text;
        $forModel = [] !== $labels ? 'Elijo: '.implode(', ', $labels).('' !== $text ? ". {$text}" : '') : $text;
        $this->turn($conv, $forModel, $shown);

        return $conv;
    }

    /** @param array<string, mixed> $conv */
    private function turn(array &$conv, string $forModel, string $shown): void
    {
        if ($conv['turns'] >= self::MAX_TURNS) {
            $conv['events'][] = ['tipo' => 'error', 'texto' => 'Esta conversación llegó al máximo de mensajes. Empezá una nueva desde la Galería.'];

            return;
        }
        ++$conv['turns'];
        $conv['messages'][] = ['role' => 'user', 'content' => $forModel];
        $conv['events'][] = ['tipo' => 'usuario', 'texto' => $shown];
        $this->trim($conv);

        $slugs = array_column($this->templates->all(), 'name', 'slug');
        $system = ['role' => 'system', 'content' => Prompt::system($slugs)];
        $tools = Prompt::tools(array_keys($slugs));

        for ($step = 0; $step < self::MAX_STEPS; ++$step) {
            try {
                $msg = $this->llm->chat([$system, ...$conv['messages']], $tools);
            } catch (LlmUnavailable $e) {
                $conv['events'][] = ['tipo' => 'error', 'texto' => 'El asistente no está disponible en este momento. Probá de nuevo en un rato.', 'detalle' => $e->getMessage()];

                return;
            }
            $calls = is_array($msg['tool_calls'] ?? null) ? array_values($msg['tool_calls']) : [];
            $content = is_string($msg['content'] ?? null) ? trim($msg['content']) : '';
            $keep = ['role' => 'assistant', 'content' => $content];
            if ([] !== $calls) {
                $keep['tool_calls'] = $calls;
            }
            if (isset($msg['reasoning_content'])) {
                $keep['reasoning_content'] = $msg['reasoning_content']; // modelos con razonamiento lo necesitan de vuelta
            }
            $conv['messages'][] = $keep;
            if ('' !== $content) {
                $conv['events'][] = ['tipo' => 'asistente', 'texto' => $content];
            }
            if ([] === $calls) {
                return;
            }
            $stop = false;
            foreach ($calls as $call) {
                $name = (string) ($call['function']['name'] ?? '');
                $args = json_decode((string) ($call['function']['arguments'] ?? '{}'), true);
                $result = is_array($args) || '{}' === ($call['function']['arguments'] ?? '{}')
                    ? $this->run($conv, $name, is_array($args) ? $args : [])
                    : ['content' => 'Error: los argumentos no son JSON válido.'];
                $conv['messages'][] = ['role' => 'tool', 'tool_call_id' => (string) ($call['id'] ?? ''), 'name' => $name, 'content' => $result['content']];
                if (isset($result['event'])) {
                    $conv['events'][] = $result['event'];
                }
                $stop = $stop || ($result['stop'] ?? false);
            }
            if ($stop) {
                return;
            }
        }
        $conv['events'][] = ['tipo' => 'asistente', 'texto' => 'Se me complicó con este pedido. ¿Lo podés decir de otra forma?'];
    }

    /**
     * @param array<string, mixed> $conv
     * @param array<string, mixed> $args
     *
     * @return array{content: string, event?: array<string, mixed>, stop?: bool}
     */
    private function run(array &$conv, string $name, array $args): array
    {
        switch ($name) {
            case 'preguntar':
                $options = [];
                foreach (array_slice((array) ($args['opciones'] ?? []), 0, 8) as $i => $o) {
                    $label = is_array($o) ? trim((string) ($o['texto'] ?? '')) : trim((string) $o);
                    if ('' !== $label) {
                        $options[] = ['id' => is_array($o) && '' !== (string) ($o['id'] ?? '') ? mb_substr((string) $o['id'], 0, 40) : 'o'.($i + 1), 'texto' => mb_substr($label, 0, 80), 'detalle' => is_array($o) ? mb_substr((string) ($o['detalle'] ?? ''), 0, 140) : ''];
                    }
                }
                $question = trim((string) ($args['pregunta'] ?? ''));
                if ('' === $question || count($options) < 2) {
                    return ['content' => 'Error: la pregunta necesita texto y al menos 2 opciones.'];
                }

                return [
                    'content' => 'Pregunta mostrada. Esperá la respuesta de la persona.',
                    'event' => ['tipo' => 'pregunta', 'pregunta' => mb_substr($question, 0, 200), 'opciones' => $options, 'multiple' => (bool) ($args['multiple'] ?? false)],
                    'stop' => true,
                ];
            case 'generar_casa':
                try {
                    $house = $this->generator->generate($args);
                } catch (\InvalidArgumentException $e) {
                    return ['content' => 'No se pudo generar: '.$e->getMessage()];
                }

                return $this->afterChange($conv, $house['project'], $house['rooms'], $house['program']);
            case 'editar_casa':
                if (null === $conv['draft']) {
                    return ['content' => 'Todavía no hay casa: generá una o cargá una plantilla.'];
                }
                try {
                    $project = $this->editor->apply($conv['draft']['project'], (array) ($args['operaciones'] ?? []));
                } catch (\InvalidArgumentException $e) {
                    return ['content' => 'No se aplicó ningún cambio. '.$e->getMessage()];
                }

                return $this->afterChange($conv, $project, $conv['draft']['names'], null);
            case 'cargar_plantilla':
                $slug = (string) ($args['slug'] ?? '');
                if (!$this->templates->has($slug)) {
                    return ['content' => 'Plantilla desconocida.'];
                }

                return $this->afterChange($conv, $this->templates->project($slug), [], null);
            case 'ver_casa':
                if (null === $conv['draft']) {
                    return ['content' => 'Todavía no hay casa.'];
                }

                return ['content' => $this->json($this->describer->describe($this->analyze($conv['draft']['project']), $conv['draft']['names']))];
            default:
                return ['content' => "Herramienta desconocida: {$name}."];
        }
    }

    /**
     * @param array<string, mixed>       $conv
     * @param array<string, mixed>       $project
     * @param list<array<string, mixed>> $names
     * @param array<string, mixed>|null  $program
     *
     * @return array{content: string, event?: array<string, mixed>}
     */
    private function afterChange(array &$conv, array $project, array $names, ?array $program): array
    {
        try {
            $summary = $this->setDraft($conv, $project, $names, $program);
        } catch (InvalidProjectException $e) {
            return ['content' => 'El resultado no es un proyecto válido; no se aplicó. Detalle: '.implode('; ', array_slice($e->errors, 0, 5))];
        }

        return [
            'content' => $this->json(['resultado' => 'ok', 'casa' => $summary, 'siguiente' => 'Resumí en 1–2 frases y preguntá con `preguntar` cómo seguir.']),
            'event' => $this->houseEvent($conv),
        ];
    }

    /**
     * Valida, normaliza y guarda la casa actual (y el diseño de la persona).
     *
     * @param array<string, mixed>       $conv
     * @param array<string, mixed>       $project
     * @param list<array<string, mixed>> $names
     * @param array<string, mixed>|null  $program
     *
     * @return array<string, mixed> el resumen
     *
     * @throws InvalidProjectException
     */
    private function setDraft(array &$conv, array $project, array $names, ?array $program): array
    {
        $result = $this->analyze($project);
        $summary = $this->describer->summary($result, $names);
        $conv['draft'] = ['project' => $result['project'], 'names' => $names, 'program' => $program ?? $conv['draft']['program'] ?? null, 'summary' => $summary, 'version' => ($conv['draft']['version'] ?? 0) + 1];
        $this->conversations->saveDesign([
            'id' => $conv['id'],
            'client' => $conv['client'],
            'nombre' => $summary['nombre'],
            'resumen' => $summary,
            'svg' => TemplateThumbnail::svg($result['project']),
            'project' => $result['project'],
        ]);

        return $summary;
    }

    /**
     * @param array<string, mixed> $conv
     *
     * @return array<string, mixed>
     */
    private function houseEvent(array $conv): array
    {
        $d = $conv['draft'];

        return ['tipo' => 'casa', 'diseno' => $conv['id'], 'version' => $d['version'], 'nombre' => $d['summary']['nombre'], 'svg' => TemplateThumbnail::svg($d['project']), 'resumen' => $d['summary']];
    }

    /**
     * @param array<string, mixed> $project
     *
     * @return array{project: array<string, mixed>, analysis: array<string, mixed>}
     */
    private function analyze(array $project): array
    {
        return $this->analyzer->analyze(ProjectFactory::fromArray($project));
    }

    /** Recorta la historia para el modelo desde el principio, siempre en un mensaje de la persona. */
    private function trim(array &$conv): void
    {
        while (count($conv['messages']) > self::MAX_MESSAGES) {
            array_shift($conv['messages']);
            while ([] !== $conv['messages'] && 'user' !== $conv['messages'][0]['role']) {
                array_shift($conv['messages']);
            }
        }
        if (count($conv['events']) > 300) {
            $conv['events'] = array_slice($conv['events'], -300);
        }
    }

    /** @param array<string, mixed> $data */
    private function json(array $data): string
    {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
