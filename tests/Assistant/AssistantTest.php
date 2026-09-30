<?php

declare(strict_types=1);

namespace App\Tests\Assistant;

use App\Assistant\Assistant;
use App\Assistant\Conversations;
use App\Assistant\LlmUnavailable;
use App\Assistant\Store\FileStore;
use App\Domain\Design\HouseDescriber;
use App\Domain\Design\HouseEditor;
use App\Domain\Design\HouseGenerator;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateCatalog;
use App\Tests\Support\ScriptedLlm;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class AssistantTest extends TestCase
{
    private ScriptedLlm $llm;
    private Conversations $conversations;
    private Assistant $assistant;
    private string $dir;
    private const string CLIENT = 'abcdef0123456789abcdef01';

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/blockk-assistant-'.bin2hex(random_bytes(4));
        $this->llm = new ScriptedLlm();
        $this->conversations = new Conversations(new FileStore($this->dir));
        $this->assistant = new Assistant($this->llm, $this->conversations, new ProjectAnalyzer(), new HouseGenerator(), new HouseEditor(), new HouseDescriber(), new TemplateCatalog());
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob($this->dir.'/*') ?: []);
        @rmdir($this->dir);
    }

    /** @param array<string, mixed> $conv */
    private function types(array $conv): array
    {
        return array_column($conv['events'], 'tipo');
    }

    #[Test]
    public function aMultipleChoiceQuestionEndsTheTurnUntilThePersonAnswers(): void
    {
        $this->llm->queue = [ScriptedLlm::ask('¿Cuántas plantas?', ['una' => 'Una planta', 'dos' => 'Dos plantas'])];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva']);

        self::assertSame(['usuario', 'pregunta'], $this->types($conv));
        self::assertSame('¿Cuántas plantas?', $conv['events'][1]['pregunta']);
        self::assertSame(['una', 'dos'], array_column($conv['events'][1]['opciones'], 'id'));
        self::assertCount(1, $this->llm->received, 'preguntar corta el turno: no se vuelve a llamar al modelo');
        self::assertSame('tool', $conv['messages'][2]['role']);
    }

    #[Test]
    public function answeringWithOptionsGeneratesAHouseAndSavesTheDesign(): void
    {
        $this->llm->queue = [ScriptedLlm::ask('¿Cuántas plantas?', ['una' => 'Una planta', 'dos' => 'Dos plantas'])];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva']);

        $this->llm->queue = [
            ScriptedLlm::call('generar_casa', ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 2], ['tipo' => 'bano']]], 'c2'),
            ScriptedLlm::ask('¿Qué hacemos?', ['ok' => 'Me gusta', 'mas' => 'Agregar un dormitorio'], false, 'q2'),
        ];
        $conv = $this->assistant->reply($conv, '', ['una']);

        self::assertSame(['usuario', 'pregunta', 'usuario', 'casa', 'pregunta'], $this->types($conv));
        self::assertSame('Una planta', $conv['events'][2]['texto']);
        $userMessages = array_values(array_filter($this->llm->received[1], static fn (array $m): bool => 'user' === $m['role']));
        self::assertSame('Elijo: Una planta', end($userMessages)['content']);
        $house = $conv['events'][3];
        self::assertStringStartsWith('<svg', $house['svg']);
        self::assertSame([], $house['resumen']['observaciones']);
        self::assertContains('Dormitorio', array_column($house['resumen']['ambientes'], 'nombre'));

        // el modelo recibió el resumen de la casa como resultado de la herramienta
        $last = $this->llm->received[array_key_last($this->llm->received)];
        $toolResult = json_decode($last[array_key_last($last)]['content'], true);
        self::assertSame('ok', $toolResult['resultado']);

        $designs = $this->conversations->designs(self::CLIENT);
        self::assertCount(1, $designs);
        self::assertSame($conv['id'], $designs[0]['id']);
        self::assertArrayNotHasKey('project', $designs[0]);
        self::assertNotNull($this->conversations->design($conv['id'], self::CLIENT)['project'] ?? null);
        self::assertNull($this->conversations->design($conv['id'], 'ffffffffffffffffffffffff'), 'otro navegador no ve el diseño');
    }

    #[Test]
    public function toolErrorsGoBackToTheModelSoItCanFixThem(): void
    {
        $this->llm->queue = [
            ScriptedLlm::call('generar_casa', ['niveles' => 3, 'ambientes' => [['tipo' => 'dormitorio']]]),
            ScriptedLlm::say('Sólo puedo hasta 2 plantas.'),
        ];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva']);

        self::assertSame(['usuario', 'asistente'], $this->types($conv));
        $tool = $this->llm->received[1][array_key_last($this->llm->received[1])];
        self::assertSame('tool', $tool['role']);
        self::assertStringContainsString('1 o 2 niveles', $tool['content']);
    }

    #[Test]
    public function aTemplateCanBeLoadedDescribedAndEdited(): void
    {
        $this->llm->queue = [ScriptedLlm::ask('¿Qué cambiamos?', ['v' => 'Otra ventana', 't' => 'El techo'])];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima']);
        self::assertSame(['casa', 'usuario', 'pregunta'], $this->types($conv));
        $before = count($conv['draft']['project']['levels'][0]['openings']);

        $this->llm->queue = [ScriptedLlm::call('ver_casa', [], 'c3'), ScriptedLlm::say('Veo la casa.')];
        $conv = $this->assistant->reply($conv, 'agregá una ventana', []);
        $last = $this->llm->received[array_key_last($this->llm->received)];
        $described = json_decode($last[array_key_last($last)]['content'], true);
        $walls = $described['muros'] ?? [];
        self::assertNotEmpty($walls);
        $east = array_values(array_filter($walls, static fn (array $w): bool => 'E' === $w['exterior']));
        self::assertNotEmpty($east);

        $this->llm->queue = [
            ScriptedLlm::call('editar_casa', ['operaciones' => [['accion' => 'agregar_vano', 'muro' => $east[0]['id'], 'tipo' => 'V62', 'desde' => 0.5], ['accion' => 'cambiar_techo', 'tipo' => 'dos_aguas'], ['accion' => 'renombrar', 'nombre' => 'Mi casa']]], 'c4'),
            ScriptedLlm::say('Listo.'),
        ];
        $conv = $this->assistant->reply($conv, 'dale', []);
        self::assertSame('casa', $conv['events'][array_key_last($conv['events']) - 1]['tipo']);
        self::assertSame($before + 1, count($conv['draft']['project']['levels'][0]['openings']));
        self::assertSame('Mi casa', $conv['draft']['summary']['nombre']);
    }

    #[Test]
    public function aBadEditChangesNothingAndExplainsWhy(): void
    {
        $this->llm->queue = [ScriptedLlm::say('Hola')];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima']);
        $project = $conv['draft']['project'];

        $this->llm->queue = [ScriptedLlm::call('editar_casa', ['operaciones' => [['accion' => 'renombrar', 'nombre' => 'X'], ['accion' => 'quitar_muro', 'muro' => 'no-existe']]]), ScriptedLlm::say('Uy.')];
        $conv = $this->assistant->reply($conv, 'cambiá', []);

        self::assertSame($project, $conv['draft']['project']);
        $tool = $this->llm->received[2][array_key_last($this->llm->received[2])];
        self::assertStringContainsString('Operación 2 (quitar_muro)', $tool['content']);
    }

    #[Test]
    public function theModelBeingDownIsAFriendlyError(): void
    {
        $this->llm->queue = [new LlmUnavailable('HTTP 503')];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva']);

        self::assertSame(['usuario', 'error'], $this->types($conv));
        self::assertStringContainsString('no está disponible', $conv['events'][1]['texto']);
    }

    #[Test]
    public function reasoningContentIsSentBackToTheModel(): void
    {
        $this->llm->queue = [['role' => 'assistant', 'content' => '', 'reasoning_content' => 'pienso', 'tool_calls' => [['id' => 'x', 'type' => 'function', 'function' => ['name' => 'ver_casa', 'arguments' => '{}']]]], ScriptedLlm::say('ok')];
        $this->assistant->start(self::CLIENT, ['tipo' => 'nueva']);

        $assistantMsg = array_values(array_filter($this->llm->received[1], static fn (array $m): bool => 'assistant' === $m['role']))[0];
        self::assertSame('pienso', $assistantMsg['reasoning_content']);
    }

    #[Test]
    public function aRunawayModelIsCutOff(): void
    {
        $this->llm->queue = array_fill(0, Assistant::MAX_STEPS + 2, ScriptedLlm::call('ver_casa', []));
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva']);

        self::assertCount(Assistant::MAX_STEPS, $this->llm->received);
        self::assertSame('asistente', end($conv['events'])['tipo']);
    }
}
