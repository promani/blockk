<?php

declare(strict_types=1);

namespace App\Houses;

use App\Assistant\Store\KeyValueStore;
use App\Domain\Design\HouseDescriber;
use App\Domain\Model\InvalidProjectException;
use App\Domain\Model\ProjectFactory;
use App\Domain\ProjectAnalyzer;
use App\Domain\Templates\TemplateThumbnail;

/**
 * «Mis casas»: las casas que una persona guarda desde el editor. Sin cuentas: cada navegador tiene un id aleatorio
 * (el mismo del asistente) y sólo él ve, abre, renombra y borra las suyas. Para llevarlas a otro navegador se pide un
 * código de un solo uso que vence enseguida: quien lo canjea recibe una copia de cada casa.
 *
 * Claves: `house:{id}` (la casa), `houses:{client}` (índice de ids del navegador, de la más reciente a la más vieja) y
 * `transfer:{código}` (las casas a copiar).
 */
final class SavedHouses
{
    public const int MAX_PER_CLIENT = 30;
    public const int TTL = 365 * 86400; // un año desde la última vez que se guardó o abrió
    public const int TRANSFER_TTL = 900; // el código para llevarlas a otro navegador dura 15 minutos

    public function __construct(
        private readonly KeyValueStore $store,
        private readonly ProjectAnalyzer $analyzer,
        private readonly HouseDescriber $describer,
    ) {
    }

    public static function validId(string $id): bool
    {
        return 1 === preg_match('/^[a-f0-9]{24}$/', $id);
    }

    /**
     * Las casas de un navegador, de la más reciente a la más vieja (sin el proyecto: sólo lo de la tarjeta).
     *
     * @return list<array<string, mixed>>
     */
    public function list(string $client): array
    {
        $out = [];
        foreach ($this->store->indexGet("houses:{$client}", self::MAX_PER_CLIENT) as $id) {
            $house = $this->store->get("house:{$id}");
            if (null === $house || ($house['client'] ?? null) !== $client) {
                $this->store->indexRemove("houses:{$client}", $id); // venció o se borró
                continue;
            }
            $out[] = $this->card($house);
        }

        return $out;
    }

    /**
     * Guarda la casa: actualiza la de `$id` si es de este navegador; si no (sin id, id ajeno o vencido), crea una nueva.
     *
     * @param array<string, mixed> $project
     *
     * @return array<string, mixed> la tarjeta de la casa guardada
     *
     * @throws InvalidProjectException
     * @throws HouseLimitReached
     */
    public function save(string $client, array $project, ?string $id = null): array
    {
        $result = $this->analyzer->analyze(ProjectFactory::fromArray($project));
        $current = null !== $id && self::validId($id) ? $this->store->get("house:{$id}") : null;
        if (null !== $current && ($current['client'] ?? null) !== $client) {
            $current = null; // la casa de otro navegador no se pisa: queda una copia propia
        }
        if (null === $current && count($this->list($client)) >= self::MAX_PER_CLIENT) {
            throw new HouseLimitReached(sprintf('Llegaste al máximo de %d casas guardadas: eliminá alguna desde la Galería.', self::MAX_PER_CLIENT));
        }
        $now = time();
        $house = [
            'id' => $current['id'] ?? bin2hex(random_bytes(12)),
            'client' => $client,
            'name' => (string) $result['project']['name'],
            'project' => $result['project'],
            'summary' => $this->describer->summary($result),
            'svg' => TemplateThumbnail::svg($result['project']),
            'created' => $current['created'] ?? $now,
            'updated' => $now,
        ];
        $this->write($house);

        return $this->card($house);
    }

    /**
     * La casa de un enlace (cualquiera que tenga el id). Abrirla renueva su vencimiento.
     *
     * @return array<string, mixed>|null
     */
    public function find(string $id): ?array
    {
        if (!self::validId($id)) {
            return null;
        }
        $house = $this->store->get("house:{$id}");
        if (null === $house) {
            return null;
        }
        $this->write($house);

        return $house;
    }

    /**
     * Cambia el nombre de una casa de este navegador (el de la tarjeta y el del proyecto guardado).
     *
     * @return array<string, mixed>|null la tarjeta, o null si la casa no existe o es de otro
     */
    public function rename(string $id, string $client, string $name): ?array
    {
        $house = self::validId($id) ? $this->store->get("house:{$id}") : null;
        $name = mb_substr(trim($name), 0, 120);
        if (null === $house || ($house['client'] ?? null) !== $client || '' === $name) {
            return null;
        }
        $house['name'] = $name;
        $house['project']['name'] = $name;
        $house['summary']['nombre'] = $name;
        $house['updated'] = time();
        $this->write($house);

        return $this->card($house);
    }

    /**
     * Código de un solo uso para llevar las casas de este navegador a otro. No guarda de quién son: sólo cuáles.
     *
     * @return array{code: string, houses: int}|null null si no hay casas para llevar
     */
    public function transfer(string $client): ?array
    {
        $ids = array_column($this->list($client), 'id');
        if ([] === $ids) {
            return null;
        }
        $code = bin2hex(random_bytes(16));
        $this->store->set("transfer:{$code}", ['ids' => $ids], self::TRANSFER_TTL);

        return ['code' => $code, 'houses' => count($ids)];
    }

    /**
     * Canjea un código: copia sus casas a «Mis casas» de este navegador (hasta el máximo) y lo invalida.
     *
     * @return array{copied: int, skipped: int}|null null si el código no existe, venció o ya se usó
     */
    public function claim(string $code, string $client): ?array
    {
        $doc = 1 === preg_match('/^[a-f0-9]{32}$/', $code) ? $this->store->get("transfer:{$code}") : null;
        if (null === $doc) {
            return null;
        }
        $this->store->delete("transfer:{$code}");
        $room = self::MAX_PER_CLIENT - count($this->list($client));
        $copied = 0;
        $skipped = 0;
        // de la más vieja a la más nueva, para que queden en el mismo orden
        foreach (array_reverse((array) ($doc['ids'] ?? [])) as $id) {
            $house = is_string($id) && self::validId($id) ? $this->store->get("house:{$id}") : null;
            // las que ya son de este navegador no se duplican
            if (null === $house || ($house['client'] ?? null) === $client || $copied >= $room) {
                ++$skipped;
                continue;
            }
            $now = time() + $copied; // un segundo de diferencia conserva el orden en el índice
            $this->write(['id' => bin2hex(random_bytes(12)), 'client' => $client, 'created' => $now, 'updated' => $now] + $house);
            ++$copied;
        }

        return ['copied' => $copied, 'skipped' => $skipped];
    }

    /** Borra la casa si es de este navegador. */
    public function delete(string $id, string $client): bool
    {
        $house = self::validId($id) ? $this->store->get("house:{$id}") : null;
        if (null === $house || ($house['client'] ?? null) !== $client) {
            return false;
        }
        $this->store->delete("house:{$id}");
        $this->store->indexRemove("houses:{$client}", $id);

        return true;
    }

    /** Límite de uso por clave (IP): true si todavía hay cupo. */
    public function allow(string $key, int $window, int $limit): bool
    {
        return $this->store->hit("rl:houses:{$key}", $window, $limit);
    }

    /** @param array<string, mixed> $house */
    private function write(array $house): void
    {
        $this->store->set("house:{$house['id']}", $house, self::TTL);
        $this->store->indexAdd("houses:{$house['client']}", $house['id'], (float) $house['updated'], self::MAX_PER_CLIENT, self::TTL);
    }

    /**
     * Lo que se muestra en una tarjeta. Nunca lleva el id del navegador dueño.
     *
     * @param array<string, mixed> $house
     *
     * @return array<string, mixed>
     */
    private function card(array $house): array
    {
        return ['id' => $house['id'], 'name' => $house['name'], 'summary' => $house['summary'], 'svg' => $house['svg'], 'created' => $house['created'], 'updated' => $house['updated']];
    }
}
