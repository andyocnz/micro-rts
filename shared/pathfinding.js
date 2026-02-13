class MinHeap {
  constructor() {
    this.data = [];
  }

  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }

  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() {
    return this.data.length;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].f < this.data[parent].f) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  _sinkDown(i) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < n && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else {
        break;
      }
    }
  }
}

const NEIGHBORS = [
  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: -1, dy: 0, cost: 1 },
  { dx: 1, dy: -1, cost: 1.414 },
  { dx: 1, dy: 1, cost: 1.414 },
  { dx: -1, dy: 1, cost: 1.414 },
  { dx: -1, dy: -1, cost: 1.414 },
];

function heuristic(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
}

function reconstructPath(cameFrom, endX, endY, startX, startY, keyFn, width) {
  const path = [];
  let ck = keyFn(endX, endY);
  const startKey = keyFn(startX, startY);

  while (ck !== startKey) {
    const y = Math.floor(ck / width);
    const x = ck % width;
    path.unshift({ x, y });
    ck = cameFrom.get(ck);
    if (ck === undefined) break;
  }

  return path;
}

function findNearestWithPredicate(map, x, y, predicate, maxRadius) {
  for (let r = 1; r < maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r || Math.abs(dy) === r) {
          const nx = x + dx;
          const ny = y + dy;
          if (predicate(nx, ny)) {
            return { x: nx, y: ny };
          }
        }
      }
    }
  }
  return null;
}

function runPathfind(map, startX, startY, endX, endY, canTraverse, maxSearchRadius = 12) {
  const originalEndX = endX;
  const originalEndY = endY;

  if (!canTraverse(endX, endY)) {
    const alt = findNearestWithPredicate(map, endX, endY, canTraverse, maxSearchRadius);
    if (!alt) return [];
    endX = alt.x;
    endY = alt.y;
  }

  if (startX === endX && startY === endY) return [];

  const key = (x, y) => y * map.width + x;
  const open = new MinHeap();
  const gScore = new Map();
  const cameFrom = new Map();
  const closed = new Set();

  const startKey = key(startX, startY);
  gScore.set(startKey, 0);
  open.push({ x: startX, y: startY, f: heuristic(startX, startY, endX, endY) });

  let steps = 0;
  const maxSteps = 2000;

  // Track the closest explored tile to the original target (for partial path fallback)
  let bestClosestKey = -1;
  let bestClosestH = Infinity;

  while (open.size > 0 && steps < maxSteps) {
    steps += 1;
    const current = open.pop();
    if (!current) break;
    const ck = key(current.x, current.y);

    if (current.x === endX && current.y === endY) {
      return reconstructPath(cameFrom, current.x, current.y, startX, startY, key, map.width);
    }

    if (closed.has(ck)) continue;
    closed.add(ck);

    // Track tile closest to target for partial path fallback
    const h = heuristic(current.x, current.y, originalEndX, originalEndY);
    if (h < bestClosestH && ck !== startKey) {
      bestClosestH = h;
      bestClosestKey = ck;
    }

    for (const n of NEIGHBORS) {
      const nx = current.x + n.dx;
      const ny = current.y + n.dy;

      if (!canTraverse(nx, ny)) continue;

      if (n.dx !== 0 && n.dy !== 0) {
        if (!canTraverse(current.x + n.dx, current.y) || !canTraverse(current.x, current.y + n.dy)) {
          continue;
        }
      }

      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      const tentativeG = gScore.get(ck) + n.cost;
      const prevG = gScore.get(nk);

      if (prevG === undefined || tentativeG < prevG) {
        gScore.set(nk, tentativeG);
        cameFrom.set(nk, ck);
        open.push({ x: nx, y: ny, f: tentativeG + heuristic(nx, ny, endX, endY) });
      }
    }
  }

  // No complete path found — return partial path to closest reachable tile
  if (bestClosestKey >= 0) {
    const bx = bestClosestKey % map.width;
    const by = Math.floor(bestClosestKey / map.width);
    return reconstructPath(cameFrom, bx, by, startX, startY, key, map.width);
  }

  return [];
}

export function findPath(map, startX, startY, endX, endY) {
  return runPathfind(map, startX, startY, endX, endY, (x, y) => map.isWalkable(x, y));
}

export function findPathWater(map, startX, startY, endX, endY) {
  return runPathfind(map, startX, startY, endX, endY, (x, y) => map.isSwimmable(x, y), 18);
}
