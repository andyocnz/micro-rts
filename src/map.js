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
    this.mineralAmounts = new Map();
    this.woodAmounts = new Map();
    this.seed = seed || Math.floor(Math.random() * 999999);
    this.generate();
  }

  generate() {
    const rng = seededRandom(this.seed);
    const noiseScale = 0.025;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const n = fbmNoise(x * noiseScale, y * noiseScale, this.seed, 4);
        this.setTile(x, y, n < 0.35 ? TILE_DIRT : TILE_GRASS);
      }
    }

    this._carveWaterChannels();
    this._carveInlandRivers(rng);

    const W = this.width;
    const H = this.height;
    const mirror4 = (x, y) => [
      { x, y },
      { x: W - 1 - x, y },
      { x, y: H - 1 - y },
      { x: W - 1 - x, y: H - 1 - y },
    ];

    // Tree clusters scaled for 200x200 map — mirrored for symmetry
    const treeClusterOffsets = [
      // Near spawn areas (light wood access)
      { x: 44, y: 19, r: 6 }, { x: 19, y: 44, r: 6 },
      { x: 35, y: 35, r: 5 }, { x: 55, y: 15, r: 4 }, { x: 15, y: 55, r: 4 },
      // Mid-range forests
      { x: 50, y: 50, r: 8 }, { x: 69, y: 25, r: 6 }, { x: 25, y: 69, r: 6 },
      { x: 75, y: 63, r: 7 }, { x: 60, y: 40, r: 5 }, { x: 40, y: 60, r: 5 },
      { x: 80, y: 80, r: 7 },
      // Deep interior forests (expansion contested)
      { x: 90, y: 30, r: 7 }, { x: 30, y: 90, r: 7 },
      { x: 85, y: 55, r: 6 }, { x: 55, y: 85, r: 6 },
      { x: 70, y: 70, r: 8 }, { x: 95, y: 70, r: 6 }, { x: 70, y: 95, r: 6 },
      { x: 45, y: 75, r: 5 }, { x: 75, y: 45, r: 5 },
      { x: 60, y: 60, r: 5 }, { x: 88, y: 88, r: 6 },
      { x: 65, y: 10, r: 4 }, { x: 10, y: 65, r: 4 },
    ];

    for (const cluster of treeClusterOffsets) {
      const positions = mirror4(cluster.x, cluster.y);
      for (const pos of positions) {
        this._placeTreeCluster(pos.x, pos.y, cluster.r, rng);
      }
    }

    // Extra random tree clusters scattered across the large map
    for (let i = 0; i < 60; i++) {
      const tcx = 25 + Math.floor(rng() * (W - 50));
      const tcy = 25 + Math.floor(rng() * (H - 50));
      this._placeTreeCluster(tcx, tcy, 3 + Math.floor(rng() * 5), rng);
    }

    // Rock formations
    const rockOffsets = [
      { x: 63, y: 38 }, { x: 38, y: 63 }, { x: 78, y: 78 },
      { x: 55, y: 20 }, { x: 20, y: 55 }, { x: 70, y: 50 },
      { x: 90, y: 40 }, { x: 40, y: 90 }, { x: 85, y: 70 }, { x: 70, y: 85 },
    ];
    for (const ro of rockOffsets) {
      const positions = mirror4(ro.x, ro.y);
      for (const pos of positions) {
        for (let j = 0; j < 5; j++) {
          const tx = pos.x + Math.floor(rng() * 5) - 2;
          const ty = pos.y + Math.floor(rng() * 5) - 2;
          if (this.inBounds(tx, ty) && this.getTile(tx, ty) === TILE_GRASS) this.setTile(tx, ty, TILE_ROCK);
        }
      }
    }

    // --- MINERAL DISTRIBUTION ---

    // Tier 1: Starting minerals near each corner (easy to reach)
    const startMineralOffsets = [
      { x: 28, y: 28 }, { x: 19, y: 47 }, { x: 47, y: 19 },
      { x: 35, y: 12 }, { x: 12, y: 35 },
      { x: 22, y: 22 }, { x: 40, y: 10 }, { x: 10, y: 40 },
    ];
    for (const mo of startMineralOffsets) {
      const positions = mirror4(mo.x, mo.y);
      for (const pos of positions) this._placeMineralPatch(pos.x, pos.y, 7);
    }

    // Tier 2: Natural expansion minerals (first expansions, moderate distance)
    const expansionMineralOffsets = [
      { x: 60, y: 15 }, { x: 15, y: 60 },
      { x: 50, y: 35 }, { x: 35, y: 50 },
      { x: 55, y: 55 }, { x: 45, y: 25 }, { x: 25, y: 45 },
      { x: 65, y: 30 }, { x: 30, y: 65 },
    ];
    for (const mo of expansionMineralOffsets) {
      const positions = mirror4(mo.x, mo.y);
      for (const pos of positions) this._placeMineralPatch(pos.x, pos.y, 7, 6000);
    }

    // Tier 3: Contested mid-map minerals (further out, worth fighting over)
    const contestedMineralOffsets = [
      { x: 80, y: 45 }, { x: 45, y: 80 },
      { x: 75, y: 65 }, { x: 65, y: 75 },
      { x: 90, y: 35 }, { x: 35, y: 90 },
      { x: 85, y: 60 }, { x: 60, y: 85 },
      { x: 70, y: 50 }, { x: 50, y: 70 },
      { x: 95, y: 80 }, { x: 80, y: 95 },
    ];
    for (const mo of contestedMineralOffsets) {
      const positions = mirror4(mo.x, mo.y);
      for (const pos of positions) this._placeMineralPatch(pos.x, pos.y, 7, 7000);
    }

    // Tier 4: Rich center mineral deposits (high reward, highest risk)
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    this._placeMineralPatch(cx, cy, 16, 10000);
    this._placeMineralPatch(cx - 8, cy - 4, 7, 10000);
    this._placeMineralPatch(cx + 8, cy + 4, 7, 10000);
    this._placeMineralPatch(cx - 4, cy + 8, 7, 10000);
    this._placeMineralPatch(cx + 4, cy - 8, 7, 10000);
    this._placeMineralPatch(cx - 12, cy, 7, 8000);
    this._placeMineralPatch(cx + 12, cy, 7, 8000);
    this._placeMineralPatch(cx, cy - 12, 7, 8000);
    this._placeMineralPatch(cx, cy + 12, 7, 8000);

    // Clear spawn areas at corners first (before placing expansion minerals)
    this.clearArea(8, 8, 24, 24);
    this.clearArea(W - 32, 8, 24, 24);
    this.clearArea(8, H - 32, 24, 24);
    this.clearArea(W - 32, H - 32, 24, 24);

    // --- EXPANSION SLOTS (cleared base spots with rich minerals) ---
    const expansionSlots = [
      // Close natural expansions (2nd base)
      { x: 35, y: 18 },
      { x: 18, y: 35 },
      // Medium distance expansions (3rd base)
      { x: 50, y: 30 },
      { x: 30, y: 50 },
      // Forward contested expansion (4th base)
      { x: 55, y: 55 },
    ];
    for (const slot of expansionSlots) {
      const positions = mirror4(slot.x, slot.y);
      for (const pos of positions) {
        // Clear a 10x10 area for building placement
        this.clearArea(pos.x - 5, pos.y - 5, 10, 10);
        // Place rich mineral patches on two sides
        this._placeMineralPatch(pos.x - 5, pos.y, 7, 8000);
        this._placeMineralPatch(pos.x + 5, pos.y, 7, 8000);
      }
    }

    this._clearAroundMinerals();

    // Build bridges last so they cut through trees/rocks placed earlier
    this._buildBridges();
  }

  _carveWaterChannels() {
    const W = this.width;
    const H = this.height;
    const corners = [[0, 0], [W, 0], [0, H], [W, H]];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const edgeDist = Math.min(x, y, W - 1 - x, H - 1 - y);
        const coastNoise = fbmNoise(x * 0.04, y * 0.04, this.seed + 5000, 3);

        let minCornerDist = Infinity;
        for (const [ccx, ccy] of corners) {
          minCornerDist = Math.min(minCornerDist, Math.sqrt((x - ccx) ** 2 + (y - ccy) ** 2));
        }

        const cornerInfluence = Math.max(0, 1 - minCornerDist / 110);
        const cornerProtection = cornerInfluence * cornerInfluence;
        const oceanThreshold = Math.max(3, 16 + coastNoise * 6 - cornerProtection * 30);

        if (edgeDist < oceanThreshold) {
          this.setTile(x, y, TILE_WATER);
          this.mineralAmounts.delete(`${x},${y}`);
          this.woodAmounts.delete(`${x},${y}`);
        }
      }
    }

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

  _carveInlandRivers(rng) {
    const W = this.width;
    const H = this.height;

    // Vertical river: top edge → bottom edge, winding through x ≈ W/2
    this._carveRiverPath(rng, Math.floor(W / 2), 0, Math.floor(W / 2), H - 1, 2);

    // Horizontal river: left edge → right edge, winding through y ≈ H/2
    this._carveRiverPath(rng, 0, Math.floor(H / 2), W - 1, Math.floor(H / 2), 2);

    // Add dirt banks along all river edges
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (this.getTile(x, y) === TILE_WATER) continue;
        const adj = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of adj) {
          if (this.inBounds(nx, ny) && this.getTile(nx, ny) === TILE_WATER) {
            if (this.getTile(x, y) !== TILE_MINERAL) {
              this.setTile(x, y, TILE_DIRT);
              this.woodAmounts.delete(`${x},${y}`);
            }
            break;
          }
        }
      }
    }
  }

  _buildBridges() {
    const W = this.width;
    const H = this.height;
    const bw = 2; // bridge half-width (5 tiles total)
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    const scan = 15; // scan radius around river center

    // 4 bridges total — one per river segment on the mainland only

    // Bridge 1: cross vertical river in top half (y≈50)
    this._clearBridgeH(50, cx - scan, cx + scan, bw);
    // Bridge 2: cross vertical river in bottom half (y≈150)
    this._clearBridgeH(H - 51, cx - scan, cx + scan, bw);
    // Bridge 3: cross horizontal river in left half (x≈50)
    this._clearBridgeV(50, cy - scan, cy + scan, bw);
    // Bridge 4: cross horizontal river in right half (x≈150)
    this._clearBridgeV(W - 51, cy - scan, cy + scan, bw);
  }

  // Clear a horizontal bridge strip at row=y, from x=x0 to x=x1, width=2*hw+1
  _clearBridgeH(y, x0, x1, hw) {
    for (let dy = -hw; dy <= hw; dy++) {
      const row = y + dy;
      if (row < 0 || row >= this.height) continue;
      for (let x = x0; x <= x1; x++) {
        if (!this.inBounds(x, row)) continue;
        const t = this.getTile(x, row);
        if (t === TILE_WATER || t === TILE_TREE || t === TILE_ROCK) {
          this.setTile(x, row, TILE_DIRT);
          this.mineralAmounts.delete(`${x},${row}`);
          this.woodAmounts.delete(`${x},${row}`);
        }
      }
    }
  }

  // Clear a vertical bridge strip at col=x, from y=y0 to y=y1, width=2*hw+1
  _clearBridgeV(x, y0, y1, hw) {
    for (let dx = -hw; dx <= hw; dx++) {
      const col = x + dx;
      if (col < 0 || col >= this.width) continue;
      for (let y = y0; y <= y1; y++) {
        if (!this.inBounds(col, y)) continue;
        const t = this.getTile(col, y);
        if (t === TILE_WATER || t === TILE_TREE || t === TILE_ROCK) {
          this.setTile(col, y, TILE_DIRT);
          this.mineralAmounts.delete(`${col},${y}`);
          this.woodAmounts.delete(`${col},${y}`);
        }
      }
    }
  }

  _carveRiverPath(rng, startX, startY, endX, endY, width) {
    let x = startX, y = startY;
    let vx = 0, vy = 0;
    let maxIter = 1000;

    while (maxIter-- > 0) {
      // Place water tiles in a circle of given width
      for (let dy = -width; dy <= width; dy++) {
        for (let dx = -width; dx <= width; dx++) {
          if (dx * dx + dy * dy <= width * width) {
            const tx = Math.round(x) + dx;
            const ty = Math.round(y) + dy;
            if (this.inBounds(tx, ty)) {
              this.setTile(tx, ty, TILE_WATER);
              this.mineralAmounts.delete(`${tx},${ty}`);
              this.woodAmounts.delete(`${tx},${ty}`);
            }
          }
        }
      }

      // Check if we reached the target
      if (Math.abs(x - endX) < 3 && Math.abs(y - endY) < 3) break;

      // Direction toward target
      const dx = endX - x, dy = endY - y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const dirX = dx / len, dirY = dy / len;

      // Momentum + random wobble for organic look
      vx = vx * 0.7 + dirX * 0.3 + (rng() - 0.5) * 0.6;
      vy = vy * 0.7 + dirY * 0.3 + (rng() - 0.5) * 0.6;
      const vlen = Math.sqrt(vx * vx + vy * vy);
      x += vx / vlen;
      y += vy / vlen;
    }
  }

  _placeTreeCluster(cx, cy, radius, rng) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius && rng() > 0.3) {
          const tx = cx + dx;
          const ty = cy + dy;
          if (this.inBounds(tx, ty) && this.getTile(tx, ty) === TILE_GRASS) {
            this.setTile(tx, ty, TILE_TREE);
            this.woodAmounts.set(`${tx},${ty}`, 4000);
          }
        }
      }
    }
  }

  _clearAroundMinerals() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.getTile(x, y) !== TILE_MINERAL) continue;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!this.inBounds(nx, ny)) continue;
            const tile = this.getTile(nx, ny);
            if (tile === TILE_TREE || tile === TILE_ROCK) {
              this.setTile(nx, ny, TILE_GRASS);
              this.woodAmounts.delete(`${nx},${ny}`);
            }
          }
        }
      }
    }
  }

  _placeMineralPatch(cx, cy, count, amount = 5000) {
    for (let j = 0; j < count; j++) {
      const angle = (j / count) * Math.PI * 2;
      const r = j < count / 2 ? 0 : 1;
      const tx = cx + Math.round(Math.cos(angle) * r);
      const ty = cy + Math.round(Math.sin(angle) * r);
      if (this.inBounds(tx, ty) && this.getTile(tx, ty) !== TILE_WATER) {
        this.setTile(tx, ty, TILE_MINERAL);
        this.mineralAmounts.set(`${tx},${ty}`, amount);
      }
    }
  }

  clearArea(sx, sy, w, h) {
    for (let y = sy; y < sy + h && y < this.height; y++) {
      for (let x = sx; x < sx + w && x < this.width; x++) {
        if (!this.inBounds(x, y)) continue;
        if (this.getTile(x, y) !== TILE_WATER) {
          this.setTile(x, y, TILE_GRASS);
          this.mineralAmounts.delete(`${x},${y}`);
          this.woodAmounts.delete(`${x},${y}`);
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
