import { TILE_SIZE, UNIT_SIZE, TILE_WATER, TILE_MINERAL, TILE_TREE } from './constants.js';

export class SnapshotMap {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.tiles = [];
    this.mineralAmounts = new Map();
    this.woodAmounts = new Map();
  }

  apply(snapshot) {
    if (!snapshot) return;
    this.width = snapshot.width;
    this.height = snapshot.height;
    if (snapshot.tiles) this.tiles = snapshot.tiles;
    this.mineralAmounts = new Map(snapshot.mineralAmounts || []);
    this.woodAmounts = new Map(snapshot.woodAmounts || []);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getTile(x, y) {
    if (!this.inBounds(x, y)) return TILE_WATER;
    return this.tiles[y * this.width + x];
  }

  isWalkable(x, y) {
    const t = this.getTile(x, y);
    return t === 0 || t === 2 || t === TILE_MINERAL;
  }

  isSwimmable(x, y) {
    return this.getTile(x, y) === TILE_WATER;
  }

  isResource(x, y) {
    const t = this.getTile(x, y);
    return t === TILE_MINERAL || t === TILE_TREE;
  }
}

export class ClientUnit {
  constructor(snapshot) {
    this.apply(snapshot);
    this.selected = false;
  }

  apply(snapshot) {
    Object.assign(this, snapshot);
  }

  containsScreenPoint(sx, sy, camera) {
    const screen = camera.worldToScreen(this.x, this.y);
    const halfSize = (UNIT_SIZE / 2 + 2) * camera.zoom;
    return sx >= screen.x - halfSize && sx <= screen.x + halfSize && sy >= screen.y - halfSize && sy <= screen.y + halfSize;
  }

  withinScreenBox(box, camera) {
    const screen = camera.worldToScreen(this.x, this.y);
    return screen.x >= box.x1 && screen.x <= box.x2 && screen.y >= box.y1 && screen.y <= box.y2;
  }
}

export class ClientBuilding {
  constructor(snapshot) {
    this.apply(snapshot);
    this.selected = false;
  }

  apply(snapshot) {
    Object.assign(this, snapshot);
  }

  occupiesTile(tx, ty) {
    return tx >= this.tileX && tx < this.tileX + this.sizeTiles && ty >= this.tileY && ty < this.tileY + this.sizeTiles;
  }

  containsScreenPoint(sx, sy, camera) {
    const screen = camera.worldToScreen(this.x, this.y);
    const halfSize = (this.sizeTiles * TILE_SIZE / 2) * camera.zoom;
    return sx >= screen.x - halfSize && sx <= screen.x + halfSize && sy >= screen.y - halfSize && sy <= screen.y + halfSize;
  }
}

export class ClientUnitManager {
  constructor() {
    this.units = [];
  }

  applySnapshot(unitSnapshots, previousSelection = new Set()) {
    const next = [];
    for (const snap of unitSnapshots || []) {
      const unit = new ClientUnit(snap);
      unit.selected = previousSelection.has(unit.id);
      next.push(unit);
    }
    this.units = next;
  }

  getSelected() {
    return this.units.filter((u) => u.selected);
  }

  deselectAll() {
    for (const u of this.units) u.selected = false;
  }

  getPlayerUnits(team) {
    return this.units.filter((u) => u.team === team);
  }

  getUnitAtScreen(sx, sy, camera) {
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].containsScreenPoint(sx, sy, camera)) return this.units[i];
    }
    return null;
  }

  getUnitsInScreenBox(box, camera, team = null) {
    return this.units.filter((u) => {
      if (team !== null && u.team !== team) return false;
      return u.withinScreenBox(box, camera);
    });
  }
}

export class ClientBuildingManager {
  constructor() {
    this.buildings = [];
  }

  applySnapshot(buildingSnapshots, previousSelection = new Set()) {
    const next = [];
    for (const snap of buildingSnapshots || []) {
      const b = new ClientBuilding(snap);
      b.selected = previousSelection.has(b.id);
      next.push(b);
    }
    this.buildings = next;
  }

  deselectAll() {
    for (const b of this.buildings) b.selected = false;
  }

  getBuildingAtScreen(sx, sy, camera) {
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      if (this.buildings[i].containsScreenPoint(sx, sy, camera)) return this.buildings[i];
    }
    return null;
  }

  getBuildingAtTile(tx, ty) {
    for (const b of this.buildings) {
      if (b.occupiesTile(tx, ty)) return b;
    }
    return null;
  }

  canPlaceAt(tileX, tileY, sizeTiles, map) {
    for (let dy = 0; dy < sizeTiles; dy++) {
      for (let dx = 0; dx < sizeTiles; dx++) {
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (!map.isWalkable(tx, ty)) return false;
        if (this.getBuildingAtTile(tx, ty)) return false;
      }
    }
    return true;
  }

  canPlaceDock(tileX, tileY, map) {
    const sz = 2;
    for (let dy = 0; dy < sz; dy++) {
      for (let dx = 0; dx < sz; dx++) {
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (!map.isWalkable(tx, ty)) return false;
        if (this.getBuildingAtTile(tx, ty)) return false;
      }
    }

    for (let dy = -1; dy <= sz; dy++) {
      for (let dx = -1; dx <= sz; dx++) {
        if (dx >= 0 && dx < sz && dy >= 0 && dy < sz) continue;
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (map.inBounds(tx, ty) && map.getTile(tx, ty) === TILE_WATER) {
          return true;
        }
      }
    }

    return false;
  }
}
