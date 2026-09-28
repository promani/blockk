<?php

declare(strict_types=1);

namespace App\Tests\Domain;

use App\Domain\Geometry\WallNormalizer;
use App\Domain\Hcca;
use App\Domain\ProjectAnalyzer;
use App\Domain\Solar\ExposureAnalyzer;
use App\Domain\Solar\OpeningSuggester;
use App\Domain\Solar\Season;
use App\Domain\Solar\SunCalculator;
use App\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class SolarTest extends TestCase
{
    #[Test]
    public function southernHemisphereWinterNoonSunIsLowAndToTheNorth(): void
    {
        $sun = (new SunCalculator())->position(-34.6, Season::Winter->dayOfYear(-34.6), 12.0);

        self::assertEqualsWithDelta(90 - 34.6 - 23.45, $sun['alt'], 0.15);
        self::assertEqualsWithDelta(0.0, min($sun['az'], 360 - $sun['az']), 0.5, 'Al mediodía el sol está al norte');
    }

    #[Test]
    public function summerNoonSunIsHighAndSeasonsFlipWithTheHemisphere(): void
    {
        $calc = new SunCalculator();
        $summer = $calc->position(-34.6, Season::Summer->dayOfYear(-34.6), 12.0);
        self::assertEqualsWithDelta(90 - 34.6 + 23.45, $summer['alt'], 0.2);

        self::assertSame(172, Season::Winter->dayOfYear(-34.6));
        self::assertSame(355, Season::Winter->dayOfYear(40.4));
        self::assertSame('Invierno (21 jun)', Season::Winter->label(-34.6));
        self::assertSame('Invierno (21 dic)', Season::Winter->label(40.4));
    }

    #[Test]
    public function sunRisesEastAndSetsWest(): void
    {
        $calc = new SunCalculator();
        $morning = $calc->position(-34.6, 355, 8.0);
        $evening = $calc->position(-34.6, 355, 17.0);

        self::assertGreaterThan(0, $morning['alt']);
        self::assertGreaterThan(30, $morning['az']);
        self::assertLessThan(150, $morning['az'], 'Mañana: sol hacia el este');
        self::assertGreaterThan(210, $evening['az']);
        self::assertLessThan(330, $evening['az'], 'Tarde: sol hacia el oeste');
    }

    #[Test]
    public function pathCoversSixToNineteenEveryFifteenMinutes(): void
    {
        $path = (new SunCalculator())->path(-34.6, Season::Winter);

        self::assertCount(((19 - 6) * 4) + 1, $path);
        self::assertSame(6.0, $path[0]['h']);
        self::assertSame(19.0, $path[array_key_last($path)]['h']);
    }

    #[Test]
    public function northFacadeGainsMostSunInWinterInTheSouthernHemisphere(): void
    {
        $a = new ExposureAnalyzer();
        $northFace = $a->winterGain([0, -1], 0, -34.6); // normal hacia arriba = norte
        $southFace = $a->winterGain([0, 1], 0, -34.6);
        $westFace = $a->winterGain([-1, 0], 0, -34.6);

        self::assertGreaterThan($westFace, $northFace);
        self::assertGreaterThan(0, $northFace);
        self::assertEqualsWithDelta(0.0, $southFace, 0.001);
        self::assertSame('N', $a->facing([0, -1], 0));
        self::assertSame('E', $a->facing([1, 0], 0));
        self::assertSame('S', $a->facing([0, -1], 180), 'Con el norte apuntando hacia abajo, la cara superior mira al sur');
    }

    #[Test]
    public function rotatingTheNorthMovesTheFavourableFacade(): void
    {
        $a = new ExposureAnalyzer();
        // Norte hacia la derecha (E en el plano): la fachada derecha (normal +x) es la norte.
        self::assertGreaterThan($a->winterGain([0, -1], 90, -34.6), $a->winterGain([1, 0], 90, -34.6));
    }

    #[Test]
    public function suggestsAWinterWindowOnTheNorthFaceAndACrossVentilationPartner(): void
    {
        $project = Fixtures::build(Fixtures::room(40, 30, 20.0));
        $analyzer = new ProjectAnalyzer();
        [$normalized] = $analyzer->normalize($project);
        $suggestions = (new OpeningSuggester())->suggest($normalized, $analyzer->analyzeLevels($normalized));

        $applicable = array_values(array_filter($suggestions, static fn (array $s): bool => $s['apply']));
        self::assertCount(2, $applicable);
        $solar = array_values(array_filter($applicable, static fn (array $s): bool => 'solar' === $s['type']))[0];
        $cross = array_values(array_filter($applicable, static fn (array $s): bool => 'cross' === $s['type']))[0];
        self::assertSame('N', $solar['facing']);
        self::assertSame('S', $cross['facing']);
        self::assertSame($solar['pair'], $cross['pair']);

        // Las posiciones sugeridas respetan la jamba mínima (≥ 25 cm) a esquinas.
        foreach ($applicable as $s) {
            self::assertGreaterThanOrEqual(3, $s['pos']);
            self::assertLessThanOrEqual(40 - 3, $s['pos'] + $s['w']);
        }
    }

    #[Test]
    public function suggestionsFollowTheNorthOrientation(): void
    {
        $data = Fixtures::room(40, 30, 20.0)->build();
        $data['north'] = 180; // el norte queda abajo: la ventana solar va en el muro inferior del plano
        $project = Fixtures::project($data);
        $analyzer = new ProjectAnalyzer();
        [$normalized] = $analyzer->normalize($project);
        $levels = $analyzer->analyzeLevels($normalized);
        $solar = array_values(array_filter((new OpeningSuggester())->suggest($normalized, $levels), static fn (array $s): bool => 'solar' === ($s['type'] ?? '')))[0];

        $wall = $normalized->level(0)->wall($solar['wall']);
        self::assertSame(30, $wall->y1, 'Muro sur del plano (y = 30) = fachada norte');
        self::assertSame('N', $solar['facing']);
    }

    #[Test]
    public function doesNotSuggestWhereAWindowAlreadyExistsAndUsesFreeSpanOnly(): void
    {
        $b = Fixtures::room(40, 30, 20.0)->opening(0, 'V125', 'x', 0, 15)->opening(0, 'V125', 'x', 30, 15);
        $project = Fixtures::build($b);
        $analyzer = new ProjectAnalyzer();
        [$normalized] = $analyzer->normalize($project);
        $suggestions = (new OpeningSuggester())->suggest($normalized, $analyzer->analyzeLevels($normalized));

        self::assertSame([], array_values(array_filter($suggestions, static fn (array $s): bool => $s['apply'])));
    }

    #[Test]
    public function aSingleFacadeRoomGetsAnInformationalNoteInsteadOfACrossVentilationWindow(): void
    {
        // Ropero-cuarto interior de 2,50 × 1,88 m pegado a la fachada norte: una sola cara exterior.
        $b = Fixtures::room(60, 40, 20.0)->wall(0, 20, 0, 20, 15, 10.0)->wall(0, 40, 0, 40, 15, 10.0)->wall(0, 20, 15, 40, 15, 10.0);
        $project = Fixtures::build($b);
        $analyzer = new ProjectAnalyzer();
        [$normalized] = $analyzer->normalize($project);
        $levels = $analyzer->analyzeLevels($normalized);
        $suggestions = (new OpeningSuggester())->suggest($normalized, $levels);

        $notes = array_values(array_filter($suggestions, static fn (array $s): bool => 'info' === $s['type']));
        self::assertNotEmpty($notes);
        self::assertStringContainsString('una sola fachada', $notes[0]['reason']);
        self::assertFalse($notes[0]['apply']);
    }
}
