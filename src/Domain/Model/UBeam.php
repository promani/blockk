<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** Viga de bloques U colocada manualmente sobre un muro (encadenado intermedio, refuerzo, dintel de nicho). */
final readonly class UBeam
{
    public function __construct(
        public string $id,
        public string $wallId,
        public int $pos,
        public int $len,
        public int $course,
    ) {
    }

    public function withPlacement(string $wallId, int $pos): self
    {
        return new self($this->id, $wallId, $pos, $this->len, $this->course);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['id' => $this->id, 'wall' => $this->wallId, 'pos' => $this->pos, 'len' => $this->len, 'course' => $this->course];
    }
}
