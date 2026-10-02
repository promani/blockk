<?php

declare(strict_types=1);

namespace App\Assistant;

/**
 * Imagen adjunta a un mensaje (la foto o captura de un plano para calcarlo). El navegador la manda ya reducida, en
 * base64; acá se comprueba que sea de verdad una imagen del tipo declarado y que no pase el tamaño admitido.
 */
final class Attachment
{
    public const array TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    /** Largo máximo en base64 (~750 kB de imagen): el cuerpo del mensaje también lleva el proyecto del editor. */
    public const int MAX_BASE64 = 1_000_000;

    /**
     * @return array{mime: string, data: string}|null null si no hay adjunto
     *
     * @throws \InvalidArgumentException con un mensaje para la persona
     */
    public static function fromRequest(mixed $value): ?array
    {
        if (null === $value) {
            return null;
        }
        $mime = is_array($value) ? ($value['tipo'] ?? null) : null;
        $data = is_array($value) ? ($value['datos'] ?? null) : null;
        if (!is_string($mime) || !is_string($data) || !in_array($mime, self::TYPES, true)) {
            throw new \InvalidArgumentException('Sólo se pueden adjuntar imágenes JPG, PNG o WebP.');
        }
        if (strlen($data) > self::MAX_BASE64) {
            throw new \InvalidArgumentException('La imagen es demasiado pesada. Probá con una captura más chica.');
        }
        $binary = base64_decode($data, true);
        $info = false === $binary ? false : @getimagesizefromstring($binary);
        if (false === $info || $info['mime'] !== $mime) {
            throw new \InvalidArgumentException('El adjunto no es una imagen válida.');
        }

        return ['mime' => $mime, 'data' => $data];
    }

    /**
     * Mensaje de la persona con la imagen, en el formato de la API (texto + image_url en base64).
     *
     * @param array{mime: string, data: string} $attachment
     *
     * @return list<array<string, mixed>>
     */
    public static function content(string $text, array $attachment): array
    {
        return [
            ['type' => 'text', 'text' => $text],
            ['type' => 'image_url', 'image_url' => ['url' => "data:{$attachment['mime']};base64,{$attachment['data']}"]],
        ];
    }

    /** @param array<string, mixed> $message */
    public static function in(array $message): bool
    {
        return is_array($message['content'] ?? null) && array_any($message['content'], static fn (mixed $p): bool => is_array($p) && 'image_url' === ($p['type'] ?? null));
    }

    /**
     * La misma historia sin imágenes (queda una nota en su lugar): para el modelo que no las lee y para no volver a
     * mandar un plano anterior.
     *
     * @param list<array<string, mixed>> $messages
     *
     * @return list<array<string, mixed>>
     */
    public static function strip(array $messages, string $note = '[La persona adjuntó la imagen de un plano.]'): array
    {
        foreach ($messages as $i => $m) {
            if (!self::in($m)) {
                continue;
            }
            $text = implode("\n", array_map(static fn (array $p): string => (string) ($p['text'] ?? ''), array_filter($m['content'], static fn (mixed $p): bool => is_array($p) && 'text' === ($p['type'] ?? null))));
            $messages[$i]['content'] = trim($text."\n".$note);
        }

        return $messages;
    }
}
