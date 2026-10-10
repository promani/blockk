<?php

declare(strict_types=1);

namespace App\Domain\Model;

use App\Domain\Hcca;

/** Un nivel estructural (Planta Baja o Planta Alta). Inmutable. $courses: alto del nivel en hiladas (12 = 3,00 m). */
final readonly class Level
{
    /**
     * @param list<Wall>          $walls
     * @param list<Opening>       $openings
     * @param list<UBeam>         $ubeams
     * @param list<Slab>          $slabs    losas que hacen de piso de este nivel
     * @param list<Stair>         $stairs   escaleras que suben desde este nivel
     * @param list<Column>        $columns  pilares de hormigón
     * @param list<Label>         $labels   nombres de los ambientes
     * @param list<Furniture>     $furniture muebles simples (gabaritos; no entran al cómputo)
     */
    public function __construct(
        public array $walls = [],
        public array $openings = [],
        public array $ubeams = [],
        public array $slabs = [],
        public array $stairs = [],
        public array $columns = [],
        public array $labels = [],
        public array $furniture = [],
        public int $courses = Hcca::COURSES,
    ) {
    }

    public function isEmpty(): bool
    {
        return [] === $this->walls;
    }

    public function wall(string $id): ?Wall
    {
        return array_find($this->walls, static fn (Wall $w): bool => $w->id === $id);
    }

    /** @return list<Opening> */
    public function openingsOn(string $wallId): array
    {
        return array_values(array_filter($this->openings, static fn (Opening $o): bool => $o->wallId === $wallId));
    }

    /** @return list<UBeam> */
    public function ubeamsOn(string $wallId): array
    {
        return array_values(array_filter($this->ubeams, static fn (UBeam $u): bool => $u->wallId === $wallId));
    }

    /**
     * @param list<Wall>          $walls
     * @param list<Opening>       $openings
     * @param list<UBeam>         $ubeams
     */
    public function withStructure(array $walls, array $openings, array $ubeams): self
    {
        return new self($walls, $openings, $ubeams, $this->slabs, $this->stairs, $this->columns, $this->labels, $this->furniture, $this->courses);
    }

    /** @param list<Slab> $slabs */
    public function withSlabs(array $slabs): self
    {
        return new self($this->walls, $this->openings, $this->ubeams, $slabs, $this->stairs, $this->columns, $this->labels, $this->furniture, $this->courses);
    }

    public function heightCm(): int
    {
        return $this->courses * Hcca::COURSE_CM;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'walls' => array_map(static fn (Wall $w): array => $w->toArray(), $this->walls),
            'openings' => array_map(static fn (Opening $o): array => $o->toArray(), $this->openings),
            'ubeams' => array_map(static fn (UBeam $u): array => $u->toArray(), $this->ubeams),
            'slabs' => array_map(static fn (Slab $t): array => $t->toArray(), $this->slabs),
            'stairs' => array_map(static fn (Stair $t): array => $t->toArray(), $this->stairs),
            'columns' => array_map(static fn (Column $c): array => $c->toArray(), $this->columns),
            'labels' => array_map(static fn (Label $l): array => $l->toArray(), $this->labels),
            // sin muebles no se agrega la clave: los proyectos que no los usan quedan como antes
            // ídem el alto: sólo se guarda si no es el de siempre (3,00 m)
            ...(Hcca::COURSES === $this->courses ? [] : ['courses' => $this->courses]),
            ...([] === $this->furniture ? [] : ['furniture' => array_map(static fn (Furniture $f): array => $f->toArray(), $this->furniture)]),
        ];
    }
}
