<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Un nivel estructural (Planta Baja o Planta Alta). Inmutable. */
final readonly class Level
{
    /**
     * @param list<Wall>          $walls
     * @param list<Opening>       $openings
     * @param list<UBeam>         $ubeams
     * @param list<TimberElement> $timber   estructura de entrepiso que apoya sobre este nivel
     * @param list<Slab>          $slabs    losas que hacen de piso de este nivel
     * @param list<Stair>         $stairs   escaleras que suben desde este nivel
     */
    public function __construct(
        public array $walls = [],
        public array $openings = [],
        public array $ubeams = [],
        public array $timber = [],
        public array $slabs = [],
        public array $stairs = [],
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
        return new self($walls, $openings, $ubeams, $this->timber, $this->slabs, $this->stairs);
    }

    /** @param list<TimberElement> $timber */
    public function withTimber(array $timber): self
    {
        return new self($this->walls, $this->openings, $this->ubeams, $timber, $this->slabs, $this->stairs);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'walls' => array_map(static fn (Wall $w): array => $w->toArray(), $this->walls),
            'openings' => array_map(static fn (Opening $o): array => $o->toArray(), $this->openings),
            'ubeams' => array_map(static fn (UBeam $u): array => $u->toArray(), $this->ubeams),
            'timber' => array_map(static fn (TimberElement $t): array => $t->toArray(), $this->timber),
            'slabs' => array_map(static fn (Slab $t): array => $t->toArray(), $this->slabs),
            'stairs' => array_map(static fn (Stair $t): array => $t->toArray(), $this->stairs),
        ];
    }
}
