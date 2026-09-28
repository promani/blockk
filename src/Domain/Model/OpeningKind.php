<?php

declare(strict_types=1);

namespace App\Domain\Model;

enum OpeningKind: string
{
    case Door = 'door';
    case Window = 'window';
}
