import {
  MAP_WIDTH, MAP_HEIGHT, TILE_SIZE,
  TILE_GRASS, TILE_WATER, TILE_DIRT, TILE_TREE, TILE_MINERAL, TILE_ROCK
} from './constants.js';

function seededRandom(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Simple 2D noise for terrain
function smoothNoise(x, y, seed) {
  const rng = seededRandom(Math.floor(x) * 73856093 ^ Math.floor(y) * 19349663 ^ seed);
  return rng();
}

function interpolatedNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const v00 = smoothNoise(ix, iy, seed);
  const v10 = smoothNoise(ix + 1, iy, seed);
  const v01 = smoothNoise(ix, iy + 1, seed);
  const v11 = smoothNoise(ix + 1, iy + 1, seed);

  const i1 = v00 * (1 - fx) + v10 * fx;
  const i2 = v01 * (1 - fx) + v11 * fx;
  return i1 * (1 - fy) + i2 * fy;
}

function fbmNoise(x, y, seed, octaves = 4) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += interpolatedNoise(x * frequency, y * frequency, seed + i * 1000) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue;
}

export class GameMap {
  constructor(seed) {
    this.width = MAP_WIDTH;
    this.height = MAP_HEIGHT;
    this.tiles = new Uint8Array(this.width * this.height);
    this.mineralAmounts = new Map(); // "x,y" -> amount
    this.woodAmounts = new Map();    // "x,y" -> amount
    this.seed = seed || Math.floor(Math.random() * 999999);
    this.generate();
  }

  generate() {
    const rng = seededRandom(this.seed);
    const noiseScale = 0.08;

    // Step 1: Base terrain from noise (no random water — channels handle that)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const n = fbmNoise(x * noiseScale, y * noiseScale, this.seed, 4);
        if (n < 0.35) {
          this.setTile(x, y, TILE_DIRT);
        } else {
          this.setTile(x, y, TILE_GRASS);
        }
      }
    }

    // Step 2: Carve ocean border + natural river channels (island map)
    this._carveWaterChannels();

    // Step 3: Tree clusters (harvestable for wood)
    const numTreeClusters = 20 + Math.floor(rng() * 10);
    for (let i = 0; i < numTreeClusters; i++) {
      const cx = 5 + Math.floor(rng() * (this.width - 10));
      const cy = 5 + Math.floor(rng() * (this.height - 10));
      const radius = 2 + Math.floor(rng() * 4);

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= radius && rng() > 0.3) {
            const tx = cx + dx;
            const ty = cy + dy;
            if (this.inBounds(tx, ty) && this.getTile(tx, ty) === TILE_GRASS) {
              this.setTile(tx, ty, TILE_TREE);
              this.woodAmounts.set(`${tx},${ty}`, 3000);
            }
          }
        }
      }
    }

    // Step 4: Rock formations
    const numRockClusters = 8 + Math.floor(rng() * 5);
    for (let i = 0; i < numRockClusters; i++) {
      const cx = 8 + Math.floor(rng() * (this.width - 16));
      const cy = 8 + Math.floor(rng() * (this.height - 16));
      const count = 2 + Math.floor(rng() * 4);
      for (let j = 0; j < count; j++) {
        const tx = cx + Math.floor(rng() * 4) - 2;
        const ty = cy + Math.floor(rng() * 4) - 2;
        if (this.inBounds(tx, ty) && this.getTile(tx, ty) === TILE_GRASS) {
          this.setTile(tx, ty, TILE_ROCK);
        }
      }
    }

    // Step 5: Mineral patches (3 per corner + middle areas)
    const W = this.width;
    const H = this.height;
    const mineralSpots = [
      // Top-left (BLUE)
      { x: 8 + Math.floor(rng() * 4), y: 8 + Math.floor(rng() * 4) },
      { x: 5 + Math.floor(rng() * 3), y: 14 + Math.floor(rng() * 3) },
      { x: 14 + Math.floor(rng() * 3), y: 5 + Math.floor(rng() * 3) },
      // Top-right (RED)
      { x: W - 12 + Math.floor(rng() * 4), y: 8 + Math.floor(rng() * 4) },
      { x: W - 8 + Math.floor(rng() * 3), y: 14 + Math.floor(rng() * 3) },
      { x: W - 18 + Math.floor(rng() * 3), y: 5 + Math.floor(rng() * 3) },
      // Bottom-left (GREEN)
      { x: 8 + Math.floor(rng() * 4), y: H - 12 + Math.floor(rng() * 4) },
      { x: 5 + Math.floor(rng() * 3), y: H - 18 + Math.floor(rng() * 3) },
      { x: 14 + Math.floor(rng() * 3), y: H - 8 + Math.floor(rng() * 3) },
      // Bottom-right (YELLOW)
      { x: W - 12 + Math.floor(rng() * 4), y: H - 12 + Math.floor(rng() * 4) },
      { x: W - 8 + Math.floor(rng() * 3), y: H - 18 + Math.floor(rng() * 3) },
      { x: W - 18 + Math.floor(rng() * 3), y: H - 8 + Math.floor(rng() * 3) },
    ];

    for (const spot of mineralSpots) {
      for (let j = 0; j < 6 + Math.floor(rng() * 4); j++) {
        const tx = spot.x + Math.floor(rng() * 3) - 1;
        const ty = spot.y + Math.floor(rng() * 3) - 1;
        if (this.inBounds(tx, ty) && this.getTile(tx, ty) !== TILE_WATER) {
          this.setTile(tx, ty, TILE_MINERAL);
          this.mineralAmounts.set(`${tx},${ty}`, 5000);
        }
      }
    }

    // Step 6: Clear all 4 starting areas
    this.clearArea(3, 3, 8, 8);                     // Top-left (BLUE)
    this.clearArea(W - 11, 3, 8, 8);                // Top-right (RED)
    this.clearArea(3, H - 11, 8, 8);                // Bottom-left (GREEN)
    this.clearArea(W - 11, H - 11, 8, 8);           // Bottom-right (YELLOW)
  }

  _carveWaterChannels() {
    const W = this.width;
    const H = this.height;
    const corners = [[0, 0], [W, 0], [0, H], [W, H]];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const edgeDist = Math.min(x, y, W - 1 - x, H - 1 - y);
        const coastNoise = fbmNoise(x * 0.12, y * 0.12, this.seed + 5000, 3);

        // Distance from nearest corner — ocean narrows near corners so bases have land
        let minCornerDist = Infinity;
        for (const [ccx, ccy] of corners) {
          minCornerDist = Math.min(minCornerDist, Math.sqrt((x - ccx) ** 2 + (y - ccy) ** 2));
        }
        // Squared falloff: strong protection near corners, fades smoothly
        const cornerInfluence = Math.max(0, 1 - minCornerDist / 35);
        const cornerProtection = cornerInfluence * cornerInfluence;

        // Ocean: wide bays at mid-edges (8-11 tiles), narrow at corners (min 2 tiles)
        const oceanThreshold = Math.max(2, 8 + coastNoise * 3 - cornerProtection * 16);

        if (edgeDist < oceanThreshold) {
          this.setTile(x, y, TILE_WATER);
          this.mineralAmounts.delete(`${x},${y}`);
          this.woodAmounts.delete(`${x},${y}`);
        }
      }
    }

    // Dirt banks along water edges (natural shoreline)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (this.getTile(x, y) === TILE_WATER) continue;
        const adj = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of adj) {
          if (this.inBounds(nx, ny) && this.getTile(nx, ny) === TILE_WATER) {
            this.setTile(x, y, TILE_DIRT);
            break;
          }
        }
      }
    }
  }

  clearArea(sx, sy, w, h) {
    for (let y = sy; y < sy + h && y < this.height; y++) {
      for (let x = sx; x < sx + w && x < this.width; x++) {
        if (this.inBounds(x, y)) {
          const tile = this.getTile(x, y);
          if (tile !== TILE_WATER) {
            this.setTile(x, y, TILE_GRASS);
            this.mineralAmounts.delete(`${x},${y}`);
            this.woodAmounts.delete(`${x},${y}`);
          }
        }
      }
    }
  }

  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getTile(x, y) {
    if (!this.inBounds(x, y)) return TILE_ROCK;
    return this.tiles[y * this.width + x];
  }

  setTile(x, y, type) {
    if (this.inBounds(x, y)) {
      this.tiles[y * this.width + x] = type;
    }
  }

  isWalkable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const tile = this.getTile(x, y);
    return tile === TILE_GRASS || tile === TILE_DIRT || tile === TILE_MINERAL;
  }

  isSwimmable(x, y) {
    if (!this.inBounds(x, y)) return false;
    return this.getTile(x, y) === TILE_WATER;
  }

  isFlyable(x, y) {
    return this.inBounds(x, y);
  }

  worldToTile(wx, wy) {
    return {
      x: Math.floor(wx / TILE_SIZE),
      y: Math.floor(wy / TILE_SIZE)
    };
  }

  tileToWorld(tx, ty) {
    return {
      x: tx * TILE_SIZE + TILE_SIZE / 2,
      y: ty * TILE_SIZE + TILE_SIZE / 2
    };
  }
}
