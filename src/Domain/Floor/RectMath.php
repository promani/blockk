<?php

declare(strict_types=1);

namespace App\Domain\Floor;

/** Rectángulos en cm como [x0, y0, x1, y1]. */
final class RectMath
{
    /**
     * $rect menos la unión de $holes, como lista de rectángulos disjuntos.
     *
     * @param array{float, float, float, float}       $rect
     * @param list<array{float, float, float, float}> $holes
     *
     * @return list<array{float, float, float, float}>
     */
    public static function subtract(array $rect, array $holes): array
    {
        $parts = [$rect];
        foreach ($holes as [$hx0, $hy0, $hx1, $hy1]) {
            $next = [];
            foreach ($parts as [$x0, $y0, $x1, $y1]) {
                if ($hx1 <= $x0 || $hx0 >= $x1 || $hy1 <= $y0 || $hy0 >= $y1) {
                    $next[] = [$x0, $y0, $x1, $y1];
                    continue;
                }
                if ($hy0 > $y0) {
                    $next[] = [$x0, $y0, $x1, $hy0];
                }
                if ($hy1 < $y1) {
                    $next[] = [$x0, $hy1, $x1, $y1];
                }
                $cy0 = max($y0, $hy0);
                $cy1 = min($y1, $hy1);
                if ($hx0 > $x0) {
                    $next[] = [$x0, $cy0, $hx0, $cy1];
                }
                if ($hx1 < $x1) {
                    $next[] = [$hx1, $cy0, $x1, $cy1];
                }
            }
            $parts = $next;
        }

        return $parts;
    }

    /** @param list<array{float, float, float, float}> $rects */
    public static function area(array $rects): float
    {
        return array_sum(array_map(static fn (array $r): float => ($r[2] - $r[0]) * ($r[3] - $r[1]), $rects));
    }

    /** @param array{float, float, float, float} $a @param array{float, float, float, float} $b */
    public static function intersects(array $a, array $b): bool
    {
        return $a[0] < $b[2] && $b[0] < $a[2] && $a[1] < $b[3] && $b[1] < $a[3];
    }
}
