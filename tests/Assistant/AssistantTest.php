<?php

declare(strict_types=1);

namespace App\Tests\Assistant;

use App\Assistant\Assistant;
use App\Assistant\Conversations;
use App\Assistant\LlmClient;
use App\Assistant\LlmUnavailable;
use App\Assistant\Store\FileStore;
use App\Assistant\Wizard;
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

    /** @param list<array<string, mixed>> $messages */
    private static function lastToolContent(array $messages): string
    {
        $tools = array_values(array_filter($messages, static fn (array $m): bool => 'tool' === $m['role']));

        return end($tools)['content'];
    }

    #[Test]
    public function theGalleryWizardShowsItsFormAndBuildsTheFirstHouseWithoutTheModel(): void
    {
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva']);
        self::assertSame(['pregunta'], $this->types($conv));
        self::assertSame(array_column(Wizard::questions(), 'id'), array_column($conv['events'][0]['preguntas'], 'id'));

        $conv = $this->assistant->reply($conv, '', ['plantas' => ['1'], 'dormitorios' => ['3'], 'banos' => ['bt'], 'cocina' => ['separada'], 'extras' => ['lavadero', 'escritorio'], 'techo' => ['dos_aguas']]);

        self::assertSame([], $this->llm->received, 'el formulario inicial no llama al modelo');
        self::assertSame(['pregunta', 'usuario', 'casa'], $this->types($conv));
        self::assertSame('1 planta · 3 · Baño + toilette · Separada · Lavadero, Escritorio · A dos aguas', $conv['events'][1]['texto']);
        $names = array_column($conv['events'][2]['resumen']['ambientes'], 'nombre');
        foreach (['Dormitorio principal', 'Cocina', 'Toilette', 'Lavadero', 'Escritorio'] as $n) {
            self::assertContains($n, $names);
        }
        self::assertSame([], $conv['events'][2]['resumen']['observaciones']);
        self::assertNotNull($conv['draft']['program']);

        // la historia quedó coherente para el modelo: después del formulario, un pedido libre lo ve todo
        $this->llm->queue = [ScriptedLlm::say('Ok.')];
        $this->assistant->reply($conv, 'gracias', []);
        $roles = array_column($this->llm->received[0], 'role');
        self::assertSame(['system', 'assistant', 'tool', 'user', 'assistant', 'tool', 'assistant', 'user'], $roles);
        self::assertStringContainsString('"programa"', $this->llm->received[0][0]['content']);
    }

    #[Test]
    public function twoFloorWizardPutsBedroomsUpstairs(): void
    {
        $program = Wizard::program(['plantas' => ['2'], 'dormitorios' => ['2'], 'banos' => ['2'], 'cocina' => ['integrada'], 'techo' => ['un_agua']]);
        $house = (new HouseGenerator())->generate($program);
        $upstairs = array_filter($house['rooms'], static fn (array $r): bool => 2 === $r['nivel'] && str_starts_with($r['tipo'], 'dormitorio'));
        self::assertCount(2, $upstairs);
        self::assertSame('un_agua', $house['program']['techo']);
    }

    #[Test]
    public function freeTextInTheWizardGoesToTheModel(): void
    {
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva']);
        $this->llm->queue = [
            ScriptedLlm::call('generar_casa', ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 4], ['tipo' => 'bano', 'cantidad' => 2]]], 'c2', 'Te armo 4 dormitorios.'),
        ];
        $conv = $this->assistant->reply($conv, 'somos una familia de 6', []);

        self::assertCount(1, $this->llm->received, 'una casa sin errores termina el turno sin otra vuelta al modelo');
        self::assertSame(['pregunta', 'usuario', 'asistente', 'casa'], $this->types($conv));
        self::assertSame('assistant', end($conv['messages'])['role']);
    }

    #[Test]
    public function severalQuestionsAtOnceAndTheirAnswers(): void
    {
        $this->llm->queue = [ScriptedLlm::form([
            ['id' => 'plantas', 'pregunta' => '¿Plantas?', 'opciones' => ['1' => 'Una', '2' => 'Dos']],
            ['id' => 'extras', 'pregunta' => '¿Extras?', 'multiple' => true, 'opciones' => ['l' => 'Lavadero', 'e' => 'Escritorio', 'd' => 'Depósito']],
        ])];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima'], 'galeria', 'quiero agrandarla');
        self::assertSame(['casa', 'usuario', 'pregunta'], $this->types($conv));
        self::assertCount(2, $conv['events'][2]['preguntas']);
        self::assertTrue($conv['events'][2]['preguntas'][1]['multiple']);

        $this->llm->queue = [ScriptedLlm::say('Anotado.')];
        $conv = $this->assistant->reply($conv, 'y que sea luminosa', ['plantas' => ['2'], 'extras' => ['l', 'd', 'inventada']]);
        self::assertSame('Dos · Lavadero, Depósito · y que sea luminosa', $conv['events'][3]['texto']);
        $user = array_values(array_filter($this->llm->received[1], static fn (array $m): bool => 'user' === $m['role']));
        self::assertSame("¿Plantas? → Dos\n¿Extras? → Lavadero, Depósito\ny que sea luminosa", end($user)['content']);
    }

    #[Test]
    public function startingFromATemplateDoesNotCallTheModelUntilThePersonAsks(): void
    {
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima']);
        self::assertSame(['casa'], $this->types($conv));
        self::assertSame([], $this->llm->received);
        self::assertStringContainsString('(probable)', implode(' ', array_column($conv['events'][0]['resumen']['ambientes'], 'nombre')));
    }

    #[Test]
    public function windowsArePlacedByRoomAndOrientation(): void
    {
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima']);
        $before = count($conv['draft']['project']['levels'][0]['openings']);
        $living = array_values(array_filter($conv['draft']['summary']['ambientes'], static fn (array $a): bool => str_starts_with($a['nombre'], 'Estar')))[0];

        $this->llm->queue = [ScriptedLlm::call('editar_casa', ['operaciones' => [['accion' => 'agregar_ventana', 'ambiente' => $living['id'], 'orientacion' => 'S', 'tipo' => 'V187']]])];
        $conv = $this->assistant->reply($conv, 'una ventana más al sur en el estar', []);

        self::assertCount(1, $this->llm->received);
        self::assertSame('casa', end($conv['events'])['tipo']);
        self::assertSame([], end($conv['events'])['resumen']['observaciones']);
        self::assertCount($before + 1, $conv['draft']['project']['levels'][0]['openings']);
    }

    #[Test]
    public function aWindowThatDoesNotFitIsExplained(): void
    {
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima']);
        $this->llm->queue = [ScriptedLlm::call('editar_casa', ['operaciones' => [['accion' => 'agregar_ventana', 'ambiente' => 'N1-A99']]]), ScriptedLlm::say('No existe.')];
        $conv = $this->assistant->reply($conv, 'ventana', []);

        self::assertStringContainsString('no existe el ambiente', self::lastToolContent($this->llm->received[1]));
    }

    #[Test]
    public function inTheEditorTheCurrentProjectReplacesTheDraft(): void
    {
        $template = (new TemplateCatalog())->project('casa-minima');
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'proyecto', 'project' => $template], 'editor');
        self::assertSame('editor', $conv['modo']);

        $changed = $template;
        $changed['name'] = 'Cambiada a mano';
        $this->llm->queue = [ScriptedLlm::say('Veo que la cambiaste.')];
        $conv = $this->assistant->reply($conv, 'hola', [], $changed);

        self::assertSame('Cambiada a mano', $conv['draft']['summary']['nombre']);
        self::assertStringContainsString('MODO EDITOR', $this->llm->received[0][0]['content']);
        self::assertStringContainsString('editadaAMano', $this->llm->received[0][0]['content']);
    }

    #[Test]
    public function aFailedToolKeepsTheQuestionBackAndTheModelFixesIt(): void
    {
        $this->llm->queue = [
            ['role' => 'assistant', 'content' => '', 'tool_calls' => [
                ['id' => 'a', 'type' => 'function', 'function' => ['name' => 'generar_casa', 'arguments' => json_encode(['niveles' => 3, 'ambientes' => [['tipo' => 'dormitorio']]])]],
                ['id' => 'b', 'type' => 'function', 'function' => ['name' => 'preguntar', 'arguments' => json_encode(['preguntas' => [['id' => 'x', 'pregunta' => '¿Algo más?', 'opciones' => [['id' => 's', 'texto' => 'Sí'], ['id' => 'n', 'texto' => 'No']]]]])]],
            ]],
            ScriptedLlm::say('Sólo puedo hasta 2 plantas.'),
        ];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva'], 'galeria', 'una casa de 3 pisos');

        self::assertSame(['usuario', 'asistente'], $this->types($conv));
        self::assertCount(2, $this->llm->received);
        self::assertStringContainsString('1 o 2 niveles', implode(' ', array_column(array_filter($this->llm->received[1], static fn (array $m): bool => 'tool' === $m['role']), 'content')));
    }

    #[Test]
    public function aBadEditChangesNothingAndExplainsWhy(): void
    {
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima']);
        $project = $conv['draft']['project'];

        $this->llm->queue = [ScriptedLlm::call('editar_casa', ['operaciones' => [['accion' => 'renombrar', 'nombre' => 'X'], ['accion' => 'quitar_muro', 'muro' => 'no-existe']]]), ScriptedLlm::say('Uy.')];
        $conv = $this->assistant->reply($conv, 'cambiá', []);

        self::assertSame($project, $conv['draft']['project']);
        self::assertStringContainsString('Operación 2 (quitar_muro)', self::lastToolContent($this->llm->received[1]));
    }

    #[Test]
    public function theModelBeingDownIsAFriendlyError(): void
    {
        $this->llm->queue = [new LlmUnavailable('HTTP 503')];
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva'], 'galeria', 'hola');

        self::assertSame(['usuario', 'error'], $this->types($conv));
        self::assertStringContainsString('no está disponible', $conv['events'][1]['texto']);
    }

    #[Test]
    public function reasoningContentIsSentBackToTheModel(): void
    {
        $this->llm->queue = [['role' => 'assistant', 'content' => '', 'reasoning_content' => 'pienso', 'tool_calls' => [['id' => 'x', 'type' => 'function', 'function' => ['name' => 'ver_casa', 'arguments' => '{}']]]], ScriptedLlm::say('ok')];
        $this->assistant->start(self::CLIENT, ['tipo' => 'nueva'], 'galeria', 'hola');

        $assistantMsg = array_values(array_filter($this->llm->received[1], static fn (array $m): bool => 'assistant' === $m['role'] && isset($m['reasoning_content'])))[0];
        self::assertSame('pienso', $assistantMsg['reasoning_content']);
    }

    #[Test]
    public function aRunawayModelIsCutOff(): void
    {
        $this->llm->queue = array_fill(0, Assistant::MAX_STEPS + 2, ScriptedLlm::call('ver_casa', []));
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'nueva'], 'galeria', 'hola');

        self::assertCount(Assistant::MAX_STEPS, $this->llm->received);
        self::assertSame('asistente', end($conv['events'])['tipo']);
    }

    #[Test]
    public function designsBelongToTheirBrowser(): void
    {
        $conv = $this->assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima']);
        self::assertCount(1, $this->conversations->designs(self::CLIENT));
        self::assertNotNull($this->conversations->design($conv['id'], self::CLIENT));
        self::assertNull($this->conversations->design($conv['id'], 'ffffffffffffffffffffffff'));
    }

    private function twoTier(): Assistant
    {
        $this->llm = new ScriptedLlm(light: true);

        return new Assistant($this->llm, $this->conversations, new ProjectAnalyzer(), new HouseGenerator(), new HouseEditor(), new HouseDescriber(), new TemplateCatalog());
    }

    #[Test]
    public function theLightModelStartsTheTurnAndAsksWhenAmbiguous(): void
    {
        $assistant = $this->twoTier();
        $this->llm->queue = [ScriptedLlm::ask('¿Cuánto más grande?', ['a' => 'Un poco', 'b' => 'Bastante'])];
        $conv = $assistant->start(self::CLIENT, ['tipo' => 'plantilla', 'slug' => 'casa-minima'], 'editor', 'agrandala');

        self::assertSame([LlmClient::LIGHT], $this->llm->tiers);
        self::assertSame(['casa', 'usuario', 'pregunta'], $this->types($conv));
        self::assertStringContainsString('coordinador', $this->llm->received[0][0]['content']);
    }

    #[Test]
    public function whenTheLightModelHasTheOrdersTheHeavyOneBuildsTheHouse(): void
    {
        $assistant = $this->twoTier();
        $this->llm->queue = [
            ScriptedLlm::call('delegar', ['instrucciones' => '1 planta, 3 dormitorios, 1 baño'], 'd1'),
            ScriptedLlm::call('generar_casa', ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 3], ['tipo' => 'bano']]], 'g1'),
        ];
        $conv = $assistant->start(self::CLIENT, ['tipo' => 'nueva'], 'galeria', 'casa de una planta con 3 dormitorios y un baño');

        self::assertSame([LlmClient::LIGHT, LlmClient::HEAVY], $this->llm->tiers);
        self::assertSame(['usuario', 'casa'], $this->types($conv));
        self::assertStringContainsString('coordinador te delegó', $this->llm->received[1][0]['content']);
        self::assertStringContainsString('1 planta, 3 dormitorios', json_encode($this->llm->received[1], JSON_UNESCAPED_UNICODE));
    }

    #[Test]
    public function aBuildToolCalledByTheLightModelIsHandedOffNotExecuted(): void
    {
        $assistant = $this->twoTier();
        $this->llm->queue = [
            ScriptedLlm::call('generar_casa', ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio']]], 'x1'),
            ScriptedLlm::call('generar_casa', ['niveles' => 1, 'ambientes' => [['tipo' => 'dormitorio', 'cantidad' => 2]]], 'x2'),
        ];
        $conv = $assistant->start(self::CLIENT, ['tipo' => 'nueva'], 'galeria', 'dos dormitorios');

        self::assertSame([LlmClient::LIGHT, LlmClient::HEAVY], $this->llm->tiers);
        self::assertSame(1, count(array_filter($conv['events'], static fn (array $e): bool => 'casa' === $e['tipo'])), 'sólo construye el pesado');
        self::assertStringContainsString('No ejecutado por el coordinador', self::lastToolContent($this->llm->received[1]));
    }

    #[Test]
    public function theWizardFormStillNeedsNoModelAtAll(): void
    {
        $assistant = $this->twoTier();
        $conv = $assistant->start(self::CLIENT, ['tipo' => 'nueva']);
        $assistant->reply($conv, '', ['plantas' => ['1'], 'dormitorios' => ['2'], 'banos' => ['1'], 'cocina' => ['integrada'], 'techo' => ['dos_aguas']]);
        self::assertSame([], $this->llm->tiers);
    }
}
