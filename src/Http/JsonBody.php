<?php

declare(strict_types=1);

namespace App\Http;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/** Lectura acotada y estricta del cuerpo JSON de la API (que es pública y sin estado). */
final class JsonBody
{
    public const int MAX_BYTES = 1_500_000;

    /** @return array<string, mixed> */
    public static function decode(Request $request): array
    {
        $raw = $request->getContent();
        if (strlen($raw) > self::MAX_BYTES) {
            throw new HttpException(413, 'El proyecto supera el tamaño máximo permitido.');
        }
        try {
            $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new BadRequestHttpException('JSON inválido.');
        }
        if (!is_array($data)) {
            throw new BadRequestHttpException('Se esperaba un objeto JSON.');
        }

        return $data;
    }
}
