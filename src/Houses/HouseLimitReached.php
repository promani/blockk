<?php

declare(strict_types=1);

namespace App\Houses;

/** El navegador ya tiene el máximo de casas guardadas. */
final class HouseLimitReached extends \RuntimeException
{
}
