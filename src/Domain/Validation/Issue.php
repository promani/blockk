<?php

declare(strict_types=1);

namespace App\Domain\Validation;

/** Observación de validación constructiva. x/y en unidades de retícula, para que el editor haga zoom al problema. */
final readonly class Issue
{
    public const string ERROR = 'error';
    public const string WARN = 'warn';
    public const string INFO = 'info';

    public function __construct(
        public string $severity,
        public string $code,
        public string $message,
        public int $level = 0,
        public ?string $ref = null,
        public ?int $x = null,
        public ?int $y = null,
    ) {
    }

    /** @param array<string, mixed> $a formato de TimberPlanner (x/y ya en unidades) */
    public static function fromArray(array $a): self
    {
        return new self((string) $a['severity'], (string) $a['code'], (string) $a['message'], (int) ($a['level'] ?? 0), $a['ref'] ?? null, $a['x'] ?? null, $a['y'] ?? null);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'severity' => $this->severity,
            'code' => $this->code,
            'message' => $this->message,
            'level' => $this->level,
            'ref' => $this->ref,
            'x' => $this->x,
            'y' => $this->y,
        ];
    }
}
