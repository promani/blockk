<?php

declare(strict_types=1);

namespace App\Domain\Solar;

/** Época del año para el asoleamiento; "invierno" y "verano" dependen del hemisferio. */
enum Season: string
{
    case Winter = 'winter';
    case Summer = 'summer';
    case Equinox = 'equinox';

    /** Día del año representativo (solsticios 21 jun = 172 / 21 dic = 355; equinoccio 21 mar = 80). */
    public function dayOfYear(float $latitude): int
    {
        return match ($this) {
            self::Winter => $latitude < 0 ? 172 : 355,
            self::Summer => $latitude < 0 ? 355 : 172,
            self::Equinox => 80,
        };
    }

    public function label(float $latitude): string
    {
        return match ($this) {
            self::Winter => $latitude < 0 ? 'Invierno (21 jun)' : 'Invierno (21 dic)',
            self::Summer => $latitude < 0 ? 'Verano (21 dic)' : 'Verano (21 jun)',
            self::Equinox => 'Equinoccio (21 mar)',
        };
    }
}
