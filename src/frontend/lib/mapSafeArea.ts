export type SafeRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * Finds the largest axis-aligned rectangle inside the container that does not
 * overlap any obstacle. Obstacle edges are the only meaningful boundaries for
 * an axis-aligned solution, so every pair of those boundaries is considered.
 */
export function largestUncoveredRect(
  width: number,
  height: number,
  obstacles: SafeRect[],
  clearance = 0
): SafeRect | undefined {
  const bounds: SafeRect = {
    left: Math.max(0, clearance),
    top: Math.max(0, clearance),
    right: Math.min(width, width - Math.max(0, clearance)),
    bottom: Math.min(height, height - Math.max(0, clearance))
  };
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return undefined;
  }

  const clippedObstacles = obstacles
    .map((obstacle) => ({
      left: Math.max(bounds.left, obstacle.left - clearance),
      top: Math.max(bounds.top, obstacle.top - clearance),
      right: Math.min(bounds.right, obstacle.right + clearance),
      bottom: Math.min(bounds.bottom, obstacle.bottom + clearance)
    }))
    .filter((obstacle) => obstacle.right > obstacle.left && obstacle.bottom > obstacle.top);

  const xBoundaries = uniqueSorted([
    bounds.left,
    bounds.right,
    ...clippedObstacles.flatMap((obstacle) => [obstacle.left, obstacle.right])
  ]);
  const yBoundaries = uniqueSorted([
    bounds.top,
    bounds.bottom,
    ...clippedObstacles.flatMap((obstacle) => [obstacle.top, obstacle.bottom])
  ]);

  let best: SafeRect | undefined;
  let bestArea = 0;
  for (let leftIndex = 0; leftIndex < xBoundaries.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < xBoundaries.length; rightIndex += 1) {
      for (let topIndex = 0; topIndex < yBoundaries.length - 1; topIndex += 1) {
        for (let bottomIndex = topIndex + 1; bottomIndex < yBoundaries.length; bottomIndex += 1) {
          const candidate: SafeRect = {
            left: xBoundaries[leftIndex],
            top: yBoundaries[topIndex],
            right: xBoundaries[rightIndex],
            bottom: yBoundaries[bottomIndex]
          };
          if (clippedObstacles.some((obstacle) => rectanglesIntersect(candidate, obstacle))) {
            continue;
          }

          const area = (candidate.right - candidate.left) * (candidate.bottom - candidate.top);
          if (area > bestArea || (area === bestArea && isEarlierCandidate(candidate, best))) {
            best = candidate;
            bestArea = area;
          }
        }
      }
    }
  }

  return best;
}

export function rectanglesIntersect(left: SafeRect, right: SafeRect): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function isEarlierCandidate(candidate: SafeRect, current: SafeRect | undefined): boolean {
  if (!current) {
    return true;
  }
  return candidate.top < current.top
    || (candidate.top === current.top && candidate.left < current.left)
    || (candidate.top === current.top && candidate.left === current.left && candidate.bottom < current.bottom)
    || (candidate.top === current.top && candidate.left === current.left && candidate.bottom === current.bottom && candidate.right < current.right);
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values.filter(Number.isFinite))).sort((left, right) => left - right);
}
