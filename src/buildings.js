import { TILE_SIZE, TILE_WATER } from './constants.js';
import { sfxTrain, sfxAttack } from './audio.js';

let nextBuildingId = 1;

export const BUILDING_DEFS = {
  base: {
    name: 'Command Centre',
    shortName: 'HQ',
    cost: { minerals: 150, wood: 100 },
    buildTime: 10,
    hp: 500,
    sizeTiles: 2,
    produces: ['worker'],
    trainCosts: { worker: { minerals: 50, wood: 0 } },
    trainTimes: { worker: 5 },
    canBuild: ['barracks', 'tower', 'factory', 'dock', 'base'],
    hotkey: 'h',
  },
  barracks: {
    name: 'Barracks',
    shortName: 'Barracks',
    cost: { minerals: 100, wood: 50 },
    buildTime: 8,
    hp: 350,
    sizeTiles: 3,
    produces: ['soldier', 'rocket'],
    trainCosts: {
      soldier: { minerals: 95, wood: 0 },
      rocket: { minerals: 90, wood: 30 },
    },
    trainTimes: { soldier: 6, rocket: 10 },
    canBuild: [],
    hotkey: 'b',
  },
  factory: {
    name: 'Factory',
    shortName: 'Factory',
    cost: { minerals: 150, wood: 100 },
    buildTime: 12,
    hp: 400,
    sizeTiles: 3,
    produces: ['tank', 'bomber'],
    trainCosts: {
      tank: { minerals: 150, wood: 50 },
      bomber: { minerals: 160, wood: 60 },
    },
    trainTimes: { tank: 12, bomber: 15 },
    canBuild: [],
    hotkey: 'f',
  },
  tower: {
    name: 'Defense Tower',
    shortName: 'Def Tower',
    cost: { minerals: 50, wood: 50 },
    buildTime: 6,
    hp: 250,
    sizeTiles: 1,
    produces: [],
    trainCosts: {},
    trainTimes: {},
    canBuild: [],
    hotkey: 'd',
    attackRange: 6,
    attackDamage: 10,
    attackSpeed: 1.5,
  },
  dock: {
    name: 'Navy Dock',
    shortName: 'Navy Dock',
    cost: { minerals: 120, wood: 80 },
    buildTime: 10,
    hp: 300,
    sizeTiles: 2,
    produces: ['battleship'],
    trainCosts: { battleship: { minerals: 200, wood: 100 } },
    trainTimes: { battleship: 15 },
    canBuild: [],
    hotkey: 'n',
  },
};

export class Building {
  constructor(tileX, tileY, type, team) {
    this.id = nextBuildingId++;
    this.type = type;
    this.team = team;
    const def = BUILDING_DEFS[type];

    this.tileX = tileX;
    this.tileY = tileY;
    this.sizeTiles = def.sizeTiles;
    this.x = (tileX + def.sizeTiles / 2) * TILE_SIZE;
    this.y = (tileY + def.sizeTiles / 2) * TILE_SIZE;

    this.hp = def.hp;
    this.maxHp = def.hp;

    this.built = false;
    this.buildProgress = 0;
    this.buildTime = def.buildTime;
    this.constructionQueued = false;

    this.selected = false;

    // Production queue
    this.trainQueue = [];
    this.rallyX = (tileX + def.sizeTiles / 2) * TILE_SIZE;
    this.rallyY = (tileY + def.sizeTiles + 1) * TILE_SIZE;

    // Tower combat
    this.attackCooldown = 0;
    this.attackTarget = null;
    this.lastShotTarget = null; // for renderer to draw projectile
    this.lastShotTime = 0;
  }

  update(dt, enemyUnits) {
    if (!this.built) return null;

    // Tower auto-attack
    if (this.type === 'tower') {
      this._updateTowerAttack(dt, enemyUnits);
    }

    // Process training queue
    if (this.trainQueue.length > 0) {
      this.trainQueue[0].timeLeft -= dt;
      if (this.trainQueue[0].timeLeft <= 0) {
        const trained = this.trainQueue.shift();
        sfxTrain();
        const def = BUILDING_DEFS[this.type];
        const cx = (this.tileX + def.sizeTiles / 2) * TILE_SIZE;
        const cy = (this.tileY + def.sizeTiles - 0.5) * TILE_SIZE; // Near the south door
        return { unitType: trained.type, team: this.team, x: cx, y: cy, bTileX: this.tileX, bTileY: this.tileY, bSize: def.sizeTiles };
      }
    }
    return null;
  }

  _updateTowerAttack(dt, enemyUnits) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.lastShotTime += dt;
    const def = BUILDING_DEFS.tower;
    const rangePx = def.attackRange * TILE_SIZE;

    // Find target
    if (!this.attackTarget || this.attackTarget.hp <= 0 || this._distTo(this.attackTarget) > rangePx) {
      this.attackTarget = null;
      let closest = rangePx;
      for (const u of enemyUnits) {
        if (u.hp <= 0) continue;
        const d = this._distTo(u);
        if (d < closest) {
          closest = d;
          this.attackTarget = u;
        }
      }
    }

    // Fire
    if (this.attackTarget && this.attackCooldown <= 0) {
      const actualDmg = Math.max(1, def.attackDamage - (this.attackTarget.armor || 0));
      this.attackTarget.hp -= actualDmg;
      this.attackCooldown = def.attackSpeed;
      this.lastShotTarget = this.attackTarget;
      this.lastShotTime = 0;
      sfxAttack();
    }
  }

  _distTo(unit) {
    const dx = unit.x - this.x;
    const dy = unit.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  canTrain(unitType, resources) {
    const def = BUILDING_DEFS[this.type];
    if (!this.built) return false;
    if (!def.produces.includes(unitType)) return false;
    const cost = def.trainCosts[unitType];
    if (!cost) return false;
    if (resources.minerals < cost.minerals) return false;
    if (resources.wood < cost.wood) return false;
    if (this.trainQueue.length >= 5) return false;
    return true;
  }

  train(unitType) {
    const def = BUILDING_DEFS[this.type];
    this.trainQueue.push({
      type: unitType,
      timeLeft: def.trainTimes[unitType],
    });
    return def.trainCosts[unitType];
  }

  occupiesTile(tx, ty) {
    return tx >= this.tileX && tx < this.tileX + this.sizeTiles &&
      ty >= this.tileY && ty < this.tileY + this.sizeTiles;
  }

  containsScreenPoint(sx, sy, camera) {
    const screen = camera.worldToScreen(this.x, this.y);
    const halfSize = (this.sizeTiles * TILE_SIZE / 2) * camera.zoom;
    return sx >= screen.x - halfSize && sx <= screen.x + halfSize &&
      sy >= screen.y - halfSize && sy <= screen.y + halfSize;
  }
}

export class BuildingManager {
  constructor() {
    this.buildings = [];
  }

  add(building) {
    this.buildings.push(building);
    return building;
  }

  update(dt, allUnits) {
    const produced = [];
    const destroyed = [];
    for (const b of this.buildings) {
      // Find enemy units for tower targeting
      const enemies = allUnits ? allUnits.filter(u => u.team !== b.team) : [];
      const result = b.update(dt, enemies);
      if (result) produced.push(result);
    }

    // Remove destroyed buildings
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      if (this.buildings[i].hp <= 0) {
        destroyed.push(this.buildings[i]);
        this.buildings[i].selected = false;
        this.buildings.splice(i, 1);
      }
    }

    return { produced, destroyed };
  }

  getBuildingAtScreen(sx, sy, camera) {
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      if (this.buildings[i].containsScreenPoint(sx, sy, camera)) {
        return this.buildings[i];
      }
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
    const sz = BUILDING_DEFS.dock.sizeTiles;
    // All occupied tiles must be walkable land
    for (let dy = 0; dy < sz; dy++) {
      for (let dx = 0; dx < sz; dx++) {
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (!map.isWalkable(tx, ty)) return false;
        if (this.getBuildingAtTile(tx, ty)) return false;
      }
    }
    // At least one adjacent tile must be water
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

  deselectAll() {
    for (const b of this.buildings) b.selected = false;
  }

  getByTeam(team) {
    return this.buildings.filter(b => b.team === team);
  }
}
