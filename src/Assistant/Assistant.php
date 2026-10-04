<?php

declare(strict_types=1);

namespace App\Assistant;

use App\Domain\Design\HouseDescriber;
use App\Domain\Design\HouseEditor;
use App\Domain\Design\HouseGenerator;
use App\Domain\Design\PlanTracer;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateCatalog;
use App\Domain\Templates\TemplateThumbnail;

/**
 * Orquesta una conversación de diseño. Dos modos: «galeria» (paso a paso, arranca con un formulario fijo y genera la
 * primera casa sin llamar al modelo) y «editor» (pedidos directos sobre la casa del editor).
 *
 * Por cada mensaje: se manda la historia al modelo, se ejecutan las herramientas que pide y se devuelven eventos para
 * la interfaz. El turno termina cuando el modelo pregunta, cuando contesta sin herramientas o cuando deja una casa sin
 * errores (no hace falta otra vuelta para resumirla: la tarjeta ya muestra los números).
 *
 * Un mensaje puede traer la imagen de un plano: ese turno va directo al modelo que construye (el que lee imágenes),
 * que lo calca con `calcar_plano`. En la historia queda sólo la última imagen.
 *
 * Eventos: usuario {texto, adjunto?} · asistente {texto} · pregunta {preguntas: [{id, pregunta, opciones, multiple}]} ·
 * casa {diseno, version, nombre, svg, resumen} · error {texto}.
 */
final class Assistant
{
    public const int MAX_STEPS = 6;
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
        private readonly PlanTracer $tracer = new PlanTracer(),
    ) {
    }

    public function enabled(): bool
    {
        return $this->llm->enabled();
    }

    /**
     * Nueva conversación. $start: {tipo: nueva|plantilla|proyecto, slug?, project?}. Sin mensaje, no se llama al modelo:
     * «nueva» muestra el formulario inicial y las otras sólo la casa de partida.
     *
     * @param array<string, mixed>                   $start
     * @param array<string, list<string>>            $answers
     * @param array{mime: string, data: string}|null $attachment imagen de un plano (ver Attachment)
     *
     * @return array<string, mixed> la conversación
     */
    public function start(string $client, array $start, string $mode = 'galeria', string $text = '', array $answers = [], ?array $attachment = null): array
    {
        $conv = ['id' => Conversations::newId(), 'client' => $client, 'created' => time(), 'modo' => 'editor' === $mode ? 'editor' : 'galeria', 'turns' => 0, 'messages' => [], 'events' => [], 'draft' => null];
        $kind = (string) ($start['tipo'] ?? 'nueva');
        if ('plantilla' === $kind) {
            $slug = (string) ($start['slug'] ?? '');
            if (!$this->templates->has($slug)) {
                throw new \InvalidArgumentException('Plantilla desconocida.');
            }
            $this->setDraft($conv, $this->templates->project($slug), [], null);
            $conv['events'][] = $this->houseEvent($conv);
        } elseif ('proyecto' === $kind) {
            if (!is_array($start['project'] ?? null)) {
                throw new \InvalidArgumentException('Falta el proyecto.');
            }
            $this->setDraft($conv, $start['project'], [], is_array($start['programa'] ?? null) ? $start['programa'] : null);
            $conv['events'][] = $this->houseEvent($conv);
        } elseif ('' === trim($text) && null === $attachment) {
            // Formulario inicial fijo, registrado en la historia como si el modelo lo hubiera preguntado.
            $questions = Wizard::questions();
            $conv['messages'][] = ['role' => 'assistant', 'content' => '', 'tool_calls' => [['id' => 'wizard', 'type' => 'function', 'function' => ['name' => 'preguntar', 'arguments' => json_encode(['preguntas' => $questions], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]]]];
            $conv['messages'][] = ['role' => 'tool', 'tool_call_id' => 'wizard', 'name' => 'preguntar', 'content' => 'Preguntas mostradas.'];
            $conv['events'][] = ['tipo' => 'pregunta', 'formulario' => Wizard::FORM_ID, 'preguntas' => $questions];
        }
        if ('' !== trim($text) || [] !== $answers || null !== $attachment) {
            $conv = $this->reply($conv, $text, $answers, null, $attachment);
        }

        return $conv;
    }

    /**
     * Mensaje de la persona: texto libre y/o respuestas a la última pregunta ({id de pregunta: [ids de opción]}). En
     * modo editor puede venir el proyecto actual del editor, que reemplaza a la casa de la conversación. Con la imagen
     * de un plano adjunta alcanza: sin texto, el pedido es calcarlo.
     *
     * @param array<string, mixed>                   $conv
     * @param array<string, list<string>>            $answers
     * @param array<string, mixed>|null              $project
     * @param array{mime: string, data: string}|null $attachment
     * @param string|null                            $mode       pantalla desde la que se escribe: una conversación de la
     *                                                           Galería que sigue en el editor pasa a modo editor
     *
     * @return array<string, mixed> la conversación actualizada
     *
     * @throws InvalidProjectException si el proyecto enviado no es válido
     */
    public function reply(array $conv, string $text, array $answers, ?array $project = null, ?array $attachment = null, ?string $mode = null): array
    {
        if ('editor' === $mode || 'galeria' === $mode) {
            $conv['modo'] = $mode;
        }
        $text = trim(mb_substr($text, 0, 800));
        if ('' === $text && null !== $attachment) {
            $text = 'Calcá este plano.';
        }
        if (null !== $project) {
            $this->sync($conv, $project);
        }
        $question = null;
        foreach (array_reverse($conv['events']) as $e) {
            if ('pregunta' === $e['tipo']) {
                $question = $e;
                break;
            }
        }
        $lines = [];
        $shown = [];
        $valid = [];
        foreach ($question['preguntas'] ?? [] as $q) {
            $ids = array_values(array_intersect(array_column($q['opciones'], 'id'), $answers[$q['id']] ?? []));
            if ([] === $ids) {
                continue;
            }
            $valid[$q['id']] = $ids;
            $labels = array_values(array_map(static fn (array $o): string => $o['texto'], array_filter($q['opciones'], static fn (array $o): bool => in_array($o['id'], $ids, true))));
            $lines[] = "{$q['pregunta']} → ".implode(', ', $labels);
            $shown[] = implode(', ', $labels);
        }
        if ([] === $lines && '' === $text) {
            throw new \InvalidArgumentException('Escribí un mensaje o elegí una opción.');
        }
        $forModel = implode("\n", $lines).([] !== $lines && '' !== $text ? "\n" : '').$text;
        $display = implode(' · ', $shown).([] !== $shown && '' !== $text ? ' · ' : '').$text;

        // Formulario inicial respondido sin texto: el programa sale directo de las respuestas, sin el modelo.
        if (Wizard::FORM_ID === ($question['formulario'] ?? null) && '' === $text && [] !== $valid && $this->isLastQuestion($conv, $question)) {
            $this->direct($conv, $forModel, $display, Wizard::program($valid));

            return $conv;
        }
        $this->turn($conv, $forModel, $display, $attachment);

        return $conv;
    }

    /** @param array<string, mixed> $conv */
    private function isLastQuestion(array $conv, array $question): bool
    {
        return end($conv['events']) === $question;
    }

    /**
     * Genera la casa del programa y la registra en la historia como una llamada del modelo (para que después la vea).
     *
     * @param array<string, mixed> $conv
     * @param array<string, mixed> $program
     */
    private function direct(array &$conv, string $forModel, string $display, array $program): void
    {
        ++$conv['turns'];
        $conv['messages'][] = ['role' => 'user', 'content' => $forModel];
        $conv['events'][] = ['tipo' => 'usuario', 'texto' => $display];
        $id = 'wizard-'.$conv['turns'];
        $conv['messages'][] = ['role' => 'assistant', 'content' => '', 'tool_calls' => [['id' => $id, 'type' => 'function', 'function' => ['name' => 'generar_casa', 'arguments' => json_encode($program, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]]]];
        $result = $this->run($conv, 'generar_casa', $program);
        $conv['messages'][] = ['role' => 'tool', 'tool_call_id' => $id, 'name' => 'generar_casa', 'content' => $result['content']];
        $conv['messages'][] = ['role' => 'assistant', 'content' => 'Listo, la casa está en pantalla.'];
        if (isset($result['event'])) {
            $conv['events'][] = $result['event'];
        } else {
            $conv['events'][] = ['tipo' => 'error', 'texto' => 'No se pudo armar la casa con esas respuestas: '.$result['content']];
        }
    }

    /**
     * La casa del editor reemplaza a la de la conversación (la persona pudo haberla cambiado a mano).
     *
     * @param array<string, mixed> $conv
     * @param array<string, mixed> $project
     */
    private function sync(array &$conv, array $project): void
    {
        $normalized = $this->analyze($project)['project'];
        if (null !== $conv['draft'] && $normalized === $conv['draft']['project']) {
            return;
        }
        $program = $conv['draft']['program'] ?? null;
        $this->setDraft($conv, $project, $conv['draft']['names'] ?? [], $program);
        $conv['draft']['editada'] = true;
    }

    /**
     * @param array<string, mixed>                   $conv
     * @param array{mime: string, data: string}|null $attachment
     */
    private function turn(array &$conv, string $forModel, string $shown, ?array $attachment = null): void
    {
        if ($conv['turns'] >= self::MAX_TURNS) {
            $conv['events'][] = ['tipo' => 'error', 'texto' => 'Esta conversación llegó al máximo de mensajes. Empezá una nueva.'];

            return;
        }
        ++$conv['turns'];
        if (null !== $attachment) {
            // En la historia queda una sola imagen: la del último plano.
            $conv['messages'] = Attachment::strip($conv['messages'], '[Acá la persona había adjuntado otro plano.]');
        }
        $conv['messages'][] = ['role' => 'user', 'content' => null === $attachment ? $forModel : Attachment::content($forModel, $attachment)];
        $conv['events'][] = ['tipo' => 'usuario', 'texto' => $shown] + (null === $attachment ? [] : ['adjunto' => true]);
        $this->trim($conv);

        $slugs = array_column($this->templates->all(), 'name', 'slug');
        $tools = Prompt::tools(array_keys($slugs));
        // El turno arranca con el modelo liviano (coordinador), que delega al pesado cuando tiene las órdenes. Con un
        // plano adjunto va directo al pesado: es el que lee la imagen y no hay nada que coordinar.
        $tier = $this->llm->hasLight() && null === $attachment ? LlmClient::LIGHT : LlmClient::HEAVY;
        $delegated = false; // el coordinador pasó el pedido al constructor
        $nudged = false;    // ya se le recordó al constructor que tiene que actuar

        for ($step = 0; $step < self::MAX_STEPS; ++$step) {
            $system = ['role' => 'system', 'content' => LlmClient::LIGHT === $tier
                ? Prompt::coordinator($conv['modo'] ?? 'galeria', $this->context($conv))
                : Prompt::system($slugs, $conv['modo'] ?? 'galeria', $this->context($conv))];
            $t0 = microtime(true);
            try {
                // El coordinador no lee imágenes: recibe una nota en su lugar.
                $msg = $this->llm->chat([$system, ...(LlmClient::LIGHT === $tier ? Attachment::strip($conv['messages']) : $conv['messages'])], $tools, $tier);
            } catch (LlmUnavailable $e) {
                $this->log($conv, $step, $tier, $t0, 'ERROR '.$e->getMessage());
                $withImage = LlmClient::HEAVY === $tier && array_any($conv['messages'], Attachment::in(...));
                // Si el modelo no pudo con la imagen, se saca de la historia para que los próximos mensajes no fallen igual.
                $conv['messages'] = Attachment::strip($conv['messages'], '[La persona adjuntó un plano que no se pudo leer.]');
                $conv['events'][] = ['tipo' => 'error', 'texto' => $withImage
                    ? 'No pude leer el plano en este momento. Probá de nuevo en un rato o contame la casa con palabras.'
                    : 'El asistente no está disponible en este momento. Probá de nuevo en un rato.', 'detalle' => $e->getMessage()];

                return;
            }
            $this->log($conv, $step, $tier, $t0, implode(',', array_map(static fn (array $c): string => (string) ($c['function']['name'] ?? '?'), (array) ($msg['tool_calls'] ?? []))) ?: 'texto');
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
                // El coordinador a veces anuncia en texto que pasa el pedido («le paso las indicaciones al
                // constructor», «ya lo armo») sin llamar a `delegar`: se le pasa igual, si no la casa no cambia.
                if (LlmClient::LIGHT === $tier && self::announcesWork($content)) {
                    $this->log($conv, $step, $tier, $t0, 'anuncio sin delegar → constructor');
                    $tier = LlmClient::HEAVY;
                    $delegated = true;
                    continue;
                }
                // El constructor que recibió un pedido y contesta sólo con texto no cambió nada: se le pide una vez
                // que lo haga con las herramientas.
                if (LlmClient::HEAVY === $tier && $delegated && !$nudged) {
                    $nudged = true;
                    $this->log($conv, $step, $tier, $t0, 'constructor sin herramientas → se le pide actuar');
                    if ('' !== $content) {
                        array_pop($conv['events']); // su texto («listo, ya está») no corresponde: todavía no hizo nada
                    }
                    $conv['messages'][] = ['role' => 'user', 'content' => '(Sistema) Todavía no se cambió nada en la casa. Hacé el cambio pedido ahora con las herramientas (generar_casa, editar_casa…); no contestes sólo con texto. Si de verdad falta un dato, usá preguntar.'];
                    continue;
                }

                return;
            }

            if (LlmClient::LIGHT === $tier) {
                if ($this->coordinate($conv, $calls)) {
                    $tier = LlmClient::HEAVY;
                    $delegated = true;
                    continue;
                }
                if ('pregunta' === (end($conv['events'])['tipo'] ?? null)) {
                    return;
                }
                continue;
            }

            $events = [];
            $asked = false;
            $failed = false;
            $cleanHouse = false;
            foreach ($calls as $call) {
                $name = (string) ($call['function']['name'] ?? '');
                $raw = (string) ($call['function']['arguments'] ?? '{}');
                $args = json_decode('' === $raw ? '{}' : $raw, true);
                $result = match (true) {
                    'delegar' === $name => ['content' => 'Ya sos el constructor: ejecutá las instrucciones con las otras herramientas.', 'error' => true],
                    is_array($args) => $this->run($conv, $name, $args),
                    default => ['content' => 'Error: los argumentos no son JSON válido.', 'error' => true],
                };
                $conv['messages'][] = ['role' => 'tool', 'tool_call_id' => (string) ($call['id'] ?? ''), 'name' => $name, 'content' => $result['content']];
                if (isset($result['event'])) {
                    $events[] = $result['event'];
                }
                if ('' !== ($result['note'] ?? '')) {
                    $events[] = ['tipo' => 'asistente', 'texto' => $result['note']];
                }
                $asked = $asked || 'preguntar' === $name && !($result['error'] ?? false);
                $failed = $failed || ($result['error'] ?? false);
                $cleanHouse = $cleanHouse || ($result['clean'] ?? false);
            }
            // Si algo falló en la tanda, la pregunta queda para después: el modelo primero corrige.
            if ($failed) {
                $events = array_values(array_filter($events, static fn (array $e): bool => 'pregunta' !== $e['tipo']));
            }
            array_push($conv['events'], ...$events);
            if (!$failed && ($asked || $cleanHouse)) {
                if (!$asked) {
                    $conv['messages'][] = ['role' => 'assistant', 'content' => 'Listo, la casa está en pantalla.'];
                }

                return;
            }
        }
        $conv['events'][] = ['tipo' => 'asistente', 'texto' => 'Se me complicó con este pedido. ¿Lo podés decir de otra forma?'];
    }

    /** ¿El texto del coordinador anuncia que el cambio se va a hacer (sin haberlo pasado con `delegar`)? */
    private static function announcesWork(string $text): bool
    {
        if (str_contains($text, '?')) {
            return false; // una pregunta («¿querés que se lo pase al constructor?») espera respuesta
        }

        return 1 === preg_match('/constructor|le pas[eé]|se lo paso|le paso|deleg|ya (lo |la )?(armo|hago|cambio|aplico|agrego|sumo)|ahora (lo |la )?(armo|hago|cambio|aplico|agrego|sumo)|enseguida|voy a (armar|hacer|cambiar|aplicar|agregar|sumar|poner|sacar|mover)/iu', $text);
    }

    /**
     * Herramientas del coordinador. `preguntar` se muestra; `delegar` (o cualquier herramienta de construcción, que
     * el coordinador no ejecuta) pasa el turno al modelo pesado. Devuelve true si hay que delegar.
     *
     * @param array<string, mixed>       $conv
     * @param list<array<string, mixed>> $calls
     */
    private function coordinate(array &$conv, array $calls): bool
    {
        $handoff = [] !== array_filter($calls, static fn (array $c): bool => 'preguntar' !== ($c['function']['name'] ?? ''));
        foreach ($calls as $call) {
            $name = (string) ($call['function']['name'] ?? '');
            $args = json_decode((string) ($call['function']['arguments'] ?? '{}'), true);
            if ('preguntar' === $name && !$handoff) {
                $result = $this->run($conv, $name, is_array($args) ? $args : []);
                if (isset($result['event'])) {
                    $conv['events'][] = $result['event'];
                }
            } else {
                $result = ['content' => match ($name) {
                    'delegar' => 'Delegado al constructor.',
                    'preguntar' => 'No se mostró: primero actúa el constructor.',
                    default => 'No ejecutado por el coordinador: lo hace el constructor con estos datos.',
                }];
            }
            $conv['messages'][] = ['role' => 'tool', 'tool_call_id' => (string) ($call['id'] ?? ''), 'name' => $name, 'content' => $result['content']];
        }

        return $handoff;
    }

    /**
     * @param array<string, mixed> $conv
     * @param array<string, mixed> $args
     *
     * @return array{content: string, event?: array<string, mixed>, error?: bool, clean?: bool, note?: string}
     */
    private function run(array &$conv, string $name, array $args): array
    {
        switch ($name) {
            case 'preguntar':
                $questions = [];
                foreach (array_slice((array) ($args['preguntas'] ?? []), 0, 6) as $qi => $q) {
                    if (!is_array($q)) {
                        continue;
                    }
                    $options = [];
                    foreach (array_slice((array) ($q['opciones'] ?? []), 0, 8) as $i => $o) {
                        $label = is_array($o) ? trim((string) ($o['texto'] ?? '')) : trim((string) $o);
                        if ('' !== $label) {
                            $options[] = ['id' => is_array($o) && '' !== trim((string) ($o['id'] ?? '')) ? mb_substr(trim((string) $o['id']), 0, 40) : 'o'.($i + 1), 'texto' => mb_substr($label, 0, 80), 'detalle' => is_array($o) ? mb_substr((string) ($o['detalle'] ?? ''), 0, 140) : ''];
                        }
                    }
                    $text = trim((string) ($q['pregunta'] ?? ''));
                    if ('' !== $text && count($options) >= 2) {
                        $questions[] = ['id' => '' !== trim((string) ($q['id'] ?? '')) ? mb_substr(trim((string) $q['id']), 0, 40) : 'p'.($qi + 1), 'pregunta' => mb_substr($text, 0, 200), 'multiple' => (bool) ($q['multiple'] ?? false), 'opciones' => $options];
                    }
                }
                if ([] === $questions) {
                    return ['content' => 'Error: cada pregunta necesita texto y al menos 2 opciones.', 'error' => true];
                }

                return ['content' => 'Preguntas mostradas. Esperá la respuesta.', 'event' => ['tipo' => 'pregunta', 'preguntas' => $questions]];
            case 'generar_casa':
                try {
                    $house = $this->generator->generate($args);
                } catch (\InvalidArgumentException $e) {
                    return ['content' => 'No se pudo generar: '.$e->getMessage(), 'error' => true];
                }

                return $this->afterChange($conv, $house['project'], $house['rooms'], $house['program']);
            case 'editar_casa':
                if (null === $conv['draft']) {
                    return ['content' => 'Todavía no hay casa: generá una o cargá una plantilla.', 'error' => true];
                }
                try {
                    $analysis = $this->analyze($conv['draft']['project'])['analysis'];
                    $project = $this->editor->apply($conv['draft']['project'], (array) ($args['operaciones'] ?? []), $analysis);
                } catch (\InvalidArgumentException $e) {
                    $hint = null !== ($conv['draft']['program'] ?? null)
                        ? ' La casa tiene programa: podés regenerarla con generar_casa si eso resuelve el pedido.'
                        : ' La casa NO tiene programa (plantilla o dibujada a mano): no la regeneres sin preguntarle a la persona, porque se perdería su diseño; explicale y ofrecé alternativas.';

                    return ['content' => 'No se aplicó ningún cambio. '.$e->getMessage().$hint, 'error' => true];
                }

                return $this->afterChange($conv, $project, $conv['draft']['names'], $conv['draft']['program'] ?? null);
            case 'calcar_plano':
                try {
                    $traced = $this->tracer->trace($args);
                } catch (\InvalidArgumentException $e) {
                    return ['content' => 'No se pudo calcar: '.$e->getMessage(), 'error' => true];
                }

                // Una casa calcada no tiene programa: después se ajusta con editar_casa o volviendo a calcar.
                return $this->afterChange($conv, $traced['project'], [], null, true, $traced['notes']);
            case 'cargar_plantilla':
                $slug = (string) ($args['slug'] ?? '');
                if (!$this->templates->has($slug)) {
                    return ['content' => 'Plantilla desconocida.', 'error' => true];
                }

                return $this->afterChange($conv, $this->templates->project($slug), [], null, true);
            case 'ver_casa':
                if (null === $conv['draft']) {
                    return ['content' => 'Todavía no hay casa.', 'error' => true];
                }

                return ['content' => $this->json($this->describer->describe($this->analyze($conv['draft']['project']), $conv['draft']['names']))];
            default:
                return ['content' => "Herramienta desconocida: {$name}.", 'error' => true];
        }
    }

    /**
     * @param array<string, mixed>       $conv
     * @param array<string, mixed>       $project
     * @param list<array<string, mixed>> $names
     * @param array<string, mixed>|null  $program
     * @param list<string>               $notes   avisos de quien armó la casa: van al modelo y a la persona
     *
     * @return array{content: string, event?: array<string, mixed>, error?: bool, clean?: bool, note?: string}
     */
    private function afterChange(array &$conv, array $project, array $names, ?array $program, bool $resetProgram = false, array $notes = []): array
    {
        try {
            $summary = $this->setDraft($conv, $project, $names, $program, $resetProgram);
        } catch (InvalidProjectException $e) {
            return ['content' => 'El resultado no es un proyecto válido; no se aplicó. Detalle: '.implode('; ', array_slice($e->errors, 0, 5)), 'error' => true];
        }
        $errors = array_filter($summary['observaciones'], static fn (array $o): bool => 'error' === $o['severidad']);

        return [
            'content' => $this->json(['resultado' => 'ok', 'casa' => $summary] + ([] === $notes ? [] : ['avisos' => $notes])),
            'event' => $this->houseEvent($conv),
            'clean' => [] === $errors,
            'note' => implode(' ', $notes),
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
    private function setDraft(array &$conv, array $project, array $names, ?array $program, bool $resetProgram = false): array
    {
        $result = $this->analyze($project);
        $summary = $this->describer->summary($result, $names);
        $conv['draft'] = ['project' => $result['project'], 'names' => $names, 'program' => $resetProgram ? null : $program, 'summary' => $summary, 'version' => ($conv['draft']['version'] ?? 0) + 1];
        $this->conversations->saveDesign([
            'id' => $conv['id'],
            'client' => $conv['client'],
            'nombre' => $summary['nombre'],
            'resumen' => $summary,
            'svg' => TemplateThumbnail::svg($result['project']),
            'project' => $result['project'],
            'programa' => $conv['draft']['program'],
        ]);

        return $summary;
    }

    /**
     * Lo que el modelo sabe de la casa actual sin pedir ver_casa.
     *
     * @param array<string, mixed> $conv
     *
     * @return array<string, mixed>|null
     */
    private function context(array $conv): ?array
    {
        $d = $conv['draft'];
        if (null === $d) {
            return null;
        }
        $s = $d['summary'];

        return array_filter([
            'nombre' => $s['nombre'],
            'niveles' => $s['niveles'],
            'superficieUtilM2' => $s['superficieUtilM2'],
            'ambientes' => array_map(static fn (array $a): string => "{$a['id']} {$a['nombre']} {$a['m2']} m²", $s['ambientes']),
            'techo' => array_values(array_unique(array_map(static fn (array $r): string => 'shed' === $r['type'] ? 'un_agua' : 'dos_aguas', $d['project']['roofs'] ?? []))),
            'programa' => $d['program'] ?? null,
            'editadaAMano' => ($d['editada'] ?? false) ? 'sí: generar_casa la rearmaría y se perderían esos cambios' : null,
            'observaciones' => $s['observaciones'] ?: null,
        ], static fn ($v): bool => null !== $v);
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

    /**
     * Una línea por llamada al modelo en el log del servidor (en Docker, los logs del contenedor): para diagnosticar
     * respuestas lentas o vueltas de más sin guardar el contenido de la conversación.
     *
     * @param array<string, mixed> $conv
     */
    private function log(array $conv, int $step, string $tier, float $t0, string $what): void
    {
        if ('cli' === PHP_SAPI) {
            return; // tests y consola
        }
        $image = array_any($conv['messages'], Attachment::in(...)) ? ' +plano' : '';
        error_log(sprintf('[asistente] conv=%s modo=%s turno=%d paso=%d modelo=%s%s %.1fs → %s', substr((string) $conv['id'], 0, 8), $conv['modo'] ?? '?', $conv['turns'], $step + 1, $tier, $image, microtime(true) - $t0, $what));
    }

    /** @param array<string, mixed> $data */
    private function json(array $data): string
    {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
