import { TILE_SIZE, TILE_WATER, BUILDING_DEFS } from './constants.js';

let nextBuildingId = 1;

export function resetBuildingIdCounter() {
  nextBuildingId = 1;
}

export function setNextBuildingIdCounter(nextId) {
  nextBuildingId = Math.max(1, nextId | 0);
}

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

    this.trainQueue = [];
    this.rallyX = (tileX + def.sizeTiles / 2) * TILE_SIZE;
    this.rallyY = (tileY + def.sizeTiles + 1) * TILE_SIZE;

    this.attackCooldown = 0;
    this.attackTarget = null;
    this.lastShotTarget = null;
    this.lastShotTime = 0;
  }

  update(dt, enemyUnits) {
    if (!this.built) return null;

    if (this.type === 'tower') {
      this._updateTowerAttack(dt, enemyUnits);
    }

    if (this.trainQueue.length > 0) {
      this.trainQueue[0].timeLeft -= dt;
      if (this.trainQueue[0].timeLeft <= 0) {
        const trained = this.trainQueue.shift();
        const def = BUILDING_DEFS[this.type];
        const cx = (this.tileX + def.sizeTiles / 2) * TILE_SIZE;
        const cy = (this.tileY + def.sizeTiles - 0.5) * TILE_SIZE;
        return {
          unitType: trained.type,
          team: this.team,
          x: cx,
          y: cy,
          bTileX: this.tileX,
          bTileY: this.tileY,
          bSize: def.sizeTiles,
        };
      }
    }

    return null;
  }

  _updateTowerAttack(dt, enemyUnits) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.lastShotTime += dt;
    const def = BUILDING_DEFS.tower;
    const rangePx = def.attackRange * TILE_SIZE;

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

    if (this.attackTarget && this.attackCooldown <= 0) {
      const actualDmg = Math.max(1, def.attackDamage - (this.attackTarget.armor || 0));
      this.attackTarget.hp -= actualDmg;
      this.attackCooldown = def.attackSpeed;
      this.lastShotTarget = this.attackTarget;
      this.lastShotTime = 0;
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
    this.trainQueue.push({ type: unitType, timeLeft: def.trainTimes[unitType] });
    return def.trainCosts[unitType];
  }

  occupiesTile(tx, ty) {
    return tx >= this.tileX && tx < this.tileX + this.sizeTiles && ty >= this.tileY && ty < this.tileY + this.sizeTiles;
  }

  toSnapshot() {
    return {
      id: this.id,
      type: this.type,
      team: this.team,
      tileX: this.tileX,
      tileY: this.tileY,
      sizeTiles: this.sizeTiles,
      x: this.x,
      y: this.y,
      hp: this.hp,
      maxHp: this.maxHp,
      built: this.built,
      buildProgress: this.buildProgress,
      buildTime: this.buildTime,
      trainQueue: this.trainQueue.map((item) => ({ ...item })),
      rallyX: this.rallyX,
      rallyY: this.rallyY,
      lastShotTarget: this.lastShotTarget ? { x: this.lastShotTarget.x, y: this.lastShotTarget.y } : null,
      lastShotTime: this.lastShotTime,
    };
  }

  static fromSnapshot(snapshot) {
    const b = new Building(snapshot.tileX, snapshot.tileY, snapshot.type, snapshot.team);
    b.id = snapshot.id;
    b.sizeTiles = snapshot.sizeTiles;
    b.x = snapshot.x;
    b.y = snapshot.y;
    b.hp = snapshot.hp;
    b.maxHp = snapshot.maxHp;
    b.built = !!snapshot.built;
    b.buildProgress = snapshot.buildProgress || 0;
    b.buildTime = snapshot.buildTime || b.buildTime;
    b.trainQueue = Array.isArray(snapshot.trainQueue) ? snapshot.trainQueue.map((t) => ({ ...t })) : [];
    b.rallyX = snapshot.rallyX ?? b.rallyX;
    b.rallyY = snapshot.rallyY ?? b.rallyY;
    b.lastShotTarget = snapshot.lastShotTarget || null;
    b.lastShotTime = snapshot.lastShotTime ?? 0;
    return b;
  }
}

export function getBuildingAtTile(buildings, tx, ty) {
  for (const b of buildings) {
    if (b.occupiesTile(tx, ty)) return b;
  }
  return null;
}

export function canPlaceAt(buildings, tileX, tileY, sizeTiles, map) {
  for (let dy = 0; dy < sizeTiles; dy++) {
    for (let dx = 0; dx < sizeTiles; dx++) {
      const tx = tileX + dx;
      const ty = tileY + dy;
      if (!map.isWalkable(tx, ty)) return false;
      if (getBuildingAtTile(buildings, tx, ty)) return false;
    }
  }
  return true;
}

export function canPlaceDock(buildings, tileX, tileY, map) {
  const sz = BUILDING_DEFS.dock.sizeTiles;

  for (let dy = 0; dy < sz; dy++) {
    for (let dx = 0; dx < sz; dx++) {
      const tx = tileX + dx;
      const ty = tileY + dy;
      if (!map.isWalkable(tx, ty)) return false;
      if (getBuildingAtTile(buildings, tx, ty)) return false;
    }
  }

  for (let dy = -1; dy <= sz; dy++) {
    for (let dx = -1; dx <= sz; dx++) {
      if (dx >= 0 && dx < sz && dy >= 0 && dy < sz) continue;
      const tx = tileX + dx;
      const ty = tileY + dy;
      if (map.inBounds(tx, ty) && map.getTile(tx, ty) === TILE_WATER) return true;
    }
  }

  return false;
}
