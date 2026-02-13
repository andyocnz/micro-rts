import { MAP_WIDTH } from './constants.js';
// A* pathfinding on a tile grid

class MinHeap {
  constructor() {
    this.data = [];
  }

  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }

  pop() {
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
      } else break;
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
      } else break;
    }
  }
}

const NEIGHBORS = [
  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: -1, dy: 0, cost: 1 },
  // Diagonals
  { dx: 1, dy: -1, cost: 1.414 },
  { dx: 1, dy: 1, cost: 1.414 },
  { dx: -1, dy: 1, cost: 1.414 },
  { dx: -1, dy: -1, cost: 1.414 },
];

function heuristic(ax, ay, bx, by) {
  // Octile distance
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
}

export function findPath(map, startX, startY, endX, endY, occupiedTiles = null, maxSteps = 8000) {
  // If destination is not walkable, find nearest walkable tile
  if (!map.isWalkable(endX, endY)) {
    const alt = findNearestWalkable(map, endX, endY);
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

  while (open.size > 0 && steps < maxSteps) {
    steps++;
    const current = open.pop();
    const ck = key(current.x, current.y);

    if (current.x === endX && current.y === endY) {
      return reconstructPath(cameFrom, current.x, current.y, startX, startY, key);
    }

    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const n of NEIGHBORS) {
      const nx = current.x + n.dx;
      const ny = current.y + n.dy;

      if (!map.isWalkable(nx, ny)) continue;

      // For diagonals, ensure we can actually cut the corner
      if (n.dx !== 0 && n.dy !== 0) {
        if (!map.isWalkable(current.x + n.dx, current.y) ||
            !map.isWalkable(current.x, current.y + n.dy)) {
          continue;
        }
      }

      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      // Skip tiles occupied by other units (but allow destination)
      if (occupiedTiles && occupiedTiles.has(nk) && !(nx === endX && ny === endY)) {
        continue;
      }

      const tentativeG = gScore.get(ck) + n.cost;
      const prevG = gScore.get(nk);

      if (prevG === undefined || tentativeG < prevG) {
        gScore.set(nk, tentativeG);
        cameFrom.set(nk, ck);
        open.push({ x: nx, y: ny, f: tentativeG + heuristic(nx, ny, endX, endY) });
      }
    }
  }

  // No path found - return partial path to closest explored node
  return [];
}

function reconstructPath(cameFrom, endX, endY, startX, startY, keyFn) {
  const path = [];
  let ck = keyFn(endX, endY);
  const startKey = keyFn(startX, startY);

  while (ck !== startKey) {
    const y = Math.floor(ck / MAP_WIDTH);
    const x = ck % MAP_WIDTH;
    path.unshift({ x, y });
    ck = cameFrom.get(ck);
    if (ck === undefined) break;
  }

  return path;
}

function findNearestWalkable(map, x, y) {
  for (let r = 1; r < 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r || Math.abs(dy) === r) {
          if (map.isWalkable(x + dx, y + dy)) {
            return { x: x + dx, y: y + dy };
          }
        }
      }
    }
  }
  return null;
}

// Water pathfinding for naval units
export function findPathWater(map, startX, startY, endX, endY, occupiedTiles = null, maxSteps = 8000) {
  if (!map.isSwimmable(endX, endY)) {
    const alt = findNearestSwimmable(map, endX, endY);
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

  while (open.size > 0 && steps < maxSteps) {
    steps++;
    const current = open.pop();
    const ck = key(current.x, current.y);

    if (current.x === endX && current.y === endY) {
      return reconstructPath(cameFrom, current.x, current.y, startX, startY, key);
    }

    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const n of NEIGHBORS) {
      const nx = current.x + n.dx;
      const ny = current.y + n.dy;

      if (!map.isSwimmable(nx, ny)) continue;

      if (n.dx !== 0 && n.dy !== 0) {
        if (!map.isSwimmable(current.x + n.dx, current.y) ||
            !map.isSwimmable(current.x, current.y + n.dy)) {
          continue;
        }
      }

      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      if (occupiedTiles && occupiedTiles.has(nk) && !(nx === endX && ny === endY)) {
        continue;
      }

      const tentativeG = gScore.get(ck) + n.cost;
      const prevG = gScore.get(nk);

      if (prevG === undefined || tentativeG < prevG) {
        gScore.set(nk, tentativeG);
        cameFrom.set(nk, ck);
        open.push({ x: nx, y: ny, f: tentativeG + heuristic(nx, ny, endX, endY) });
      }
    }
  }

  return [];
}

function findNearestSwimmable(map, x, y) {
  for (let r = 1; r < 15; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r || Math.abs(dy) === r) {
          if (map.isSwimmable(x + dx, y + dy)) {
            return { x: x + dx, y: y + dy };
          }
        }
      }
    }
  }
  return null;
}
