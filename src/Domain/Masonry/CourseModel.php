<?php

declare(strict_types=1);

namespace App\Domain\Masonry;

/** Despiece completo de un nivel: 12 hiladas (11 de bloque + 1 de bloque U de corona), cada una con sus corridas. */
final readonly class CourseModel
{
    /**
     * @param list<list<Run>> $courses
     * @param list<string>    $warnings
     */
    public function __construct(public array $courses, public array $warnings = [])
    {
    }

    /** @return \Generator<int, array{int, Run, Piece}> [hilada, corrida, pieza] */
    public function pieces(): \Generator
    {
        foreach ($this->courses as $c => $runs) {
            foreach ($runs as $run) {
                foreach ($run->pieces as $piece) {
                    yield [$c, $run, $piece];
                }
            }
        }
    }

    /** @return list<list<array<string, mixed>>> */
    public function toArray(): array
    {
        return array_map(
            static fn (array $runs): array => array_map(static fn (Run $r): array => $r->toArray(), $runs),
            $this->courses,
        );
    }
}
