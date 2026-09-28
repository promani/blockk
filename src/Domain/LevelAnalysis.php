<?php

declare(strict_types=1);

namespace App\Domain;

use App\Domain\Geometry\RegionMap;
use App\Domain\Geometry\Topology;
use App\Domain\Masonry\CourseModel;
use App\Domain\Model\Level;

/** Resultado del análisis geométrico y de despiece de un nivel ya normalizado. */
final readonly class LevelAnalysis
{
    public function __construct(
        public Level $level,
        public Topology $topology,
        public RegionMap $regions,
        public CourseModel $courses,
    ) {
    }
}
