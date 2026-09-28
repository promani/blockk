<?php

declare(strict_types=1);

namespace App\Domain\Masonry;

enum PieceKind: string
{
    /** Bloque portante / tabique macizo. */
    case Block = 'B';
    /** Bloque canal "U": dinteles, encadenados y viga corona (se rellena con hormigón y armadura). */
    case U = 'U';
}
