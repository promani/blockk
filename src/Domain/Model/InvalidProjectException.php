<?php

declare(strict_types=1);

namespace App\Domain\Model;

/** El JSON del proyecto no cumple el esquema o los límites estructurales/defensivos. */
final class InvalidProjectException extends \InvalidArgumentException
{
    /** @param list<string> $errors */
    public function __construct(public readonly array $errors)
    {
        parent::__construct('Proyecto inválido: '.implode('; ', array_slice($errors, 0, 5)));
    }
}
