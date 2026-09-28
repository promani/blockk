<?php

declare(strict_types=1);

namespace App\Domain\Geometry;

use App\Domain\Model\Axis;
use App\Domain\Model\Level;
use App\Domain\Model\Wall;

/**
 * Grafo de nodos y brazos de un nivel ya normalizado. Resuelve, para cada extremo de muro y cada
 * hilada, cuánto se prolonga (+) o se recorta (−) respecto del nodo y si la hilada continúa hacia
 * el muro colineal. En esquinas y cruces los muros se alternan hilada a hilada: en hiladas pares
 * "pasan" los muros horizontales y en las impares los verticales, lo que asegura la traba a 90°.
 */
final class Topology
{
    /** @var array<string, Node> */
    private array $nodes = [];

    public function __construct(public readonly Level $level)
    {
        $arms = [];
        foreach ($level->walls as $w) {
            $arms["{$w->x1},{$w->y1}"][Node::armDirection($w, true)] = $w;
            $arms["{$w->x2},{$w->y2}"][Node::armDirection($w, false)] = $w;
        }
        foreach ($arms as $key => $nodeArms) {
            [$x, $y] = array_map('intval', explode(',', $key));
            $this->nodes[$key] = new Node($x, $y, $nodeArms);
        }
    }

    /** @return array<string, Node> */
    public function nodes(): array
    {
        return $this->nodes;
    }

    public function nodeAt(int $x, int $y): ?Node
    {
        return $this->nodes["$x,$y"] ?? null;
    }

    public function count(NodeType $type): int
    {
        return count(array_filter($this->nodes, static fn (Node $n): bool => $n->type() === $type));
    }

    /**
     * @return array{ext: int, merge: bool} ext en ticks: >0 prolonga el muro más allá del nodo,
     *                                      <0 lo recorta; merge indica que la hilada continúa en el muro colineal
     */
    public function endCondition(Wall $w, bool $atStart, int $course): array
    {
        $node = $this->nodeAt($atStart ? $w->x1 : $w->x2, $atStart ? $w->y1 : $w->y2);
        if (null === $node) {
            return ['ext' => 0, 'merge' => false];
        }
        $horizontalThrough = 0 === $course % 2;
        $isThrough = (Axis::X === $w->axis()) === $horizontalThrough;

        switch ($node->type()) {
            case NodeType::Free:
                return ['ext' => 0, 'merge' => false];

            case NodeType::Straight:
                $other = $node->opposite(Node::armDirection($w, $atStart));

                return ['ext' => 0, 'merge' => null !== $other && $other->t === $w->t];

            case NodeType::Corner:
                $other = array_values(array_filter($node->arms, static fn (Wall $a): bool => $a->id !== $w->id))[0];
                $half = intdiv($other->t, 2);

                return ['ext' => $isThrough ? $half : -$half, 'merge' => false];

            case NodeType::Tee:
                $throughAxis = isset($node->arms['E'], $node->arms['W']) ? Axis::X : Axis::Y;

                return $this->throughOrButt($node, $w, $throughAxis);

            case NodeType::Cross:
                return $this->throughOrButt($node, $w, $horizontalThrough ? Axis::X : Axis::Y);
        }
    }

    /** @return array{ext: int, merge: bool} */
    private function throughOrButt(Node $node, Wall $w, Axis $throughAxis): array
    {
        $pair = $node->armsOn($throughAxis);
        if ($w->axis() === $throughAxis) {
            $merge = 2 === count($pair) && $pair[0]->t === $pair[1]->t;

            return ['ext' => 0, 'merge' => $merge];
        }
        $thickest = max(array_map(static fn (Wall $a): int => $a->t, $pair));

        return ['ext' => -intdiv($thickest, 2), 'merge' => false];
    }

    /**
     * Pares de muros cuya hilada $course se fusiona en una sola corrida continua.
     *
     * @return list<array{Wall, Wall}>
     */
    public function mergePairs(int $course): array
    {
        $pairs = [];
        foreach ($this->nodes as $node) {
            $axis = match ($node->type()) {
                NodeType::Straight => isset($node->arms['E']) ? Axis::X : Axis::Y,
                NodeType::Tee => isset($node->arms['E'], $node->arms['W']) ? Axis::X : Axis::Y,
                NodeType::Cross => 0 === $course % 2 ? Axis::X : Axis::Y,
                default => null,
            };
            if (null === $axis) {
                continue;
            }
            $pair = $node->armsOn($axis);
            if (2 === count($pair) && $pair[0]->t === $pair[1]->t) {
                $pairs[] = [$pair[0], $pair[1]];
            }
        }

        return $pairs;
    }

    /** Espesor máximo de los muros perpendiculares que llegan a un extremo (para la jamba mínima). */
    public function perpendicularThickness(Wall $w, bool $atStart): int
    {
        $node = $this->nodeAt($atStart ? $w->x1 : $w->x2, $atStart ? $w->y1 : $w->y2);
        if (null === $node) {
            return 0;
        }
        $perp = $node->armsOn($w->axis()->perpendicular());

        return [] === $perp ? 0 : max(array_map(static fn (Wall $a): int => $a->t, $perp));
    }
}
