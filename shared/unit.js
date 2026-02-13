import { TILE_SIZE, TILE_MINERAL, TILE_TREE, UNIT_DEFS } from './constants.js';
import { findPath, findPathWater } from './pathfinding.js';

const AGGRO_RANGE = 6;

let nextUnitId = 1;

export function resetUnitIdCounter() {
  nextUnitId = 1;
}

export function setNextUnitIdCounter(nextId) {
  nextUnitId = Math.max(1, nextId | 0);
}

export class Unit {
  constructor(tileX, tileY, type, team) {
    this.id = nextUnitId++;
    this.type = type;
    this.team = team;
    this.x = tileX * TILE_SIZE + TILE_SIZE / 2;
    this.y = tileY * TILE_SIZE + TILE_SIZE / 2;
    this.tileX = tileX;
    this.tileY = tileY;

    const def = UNIT_DEFS[type];
    this.speed = def.speed;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.armor = def.armor;
    this.damage = def.damage;
    this.attackRange = def.attackRange;
    this.attackCooldown = 0;
    this.attackSpeed = def.attackSpeed;
    this.flying = def.flying;
    this.naval = def.naval || false;

    this.path = [];
    this.state = 'idle';
    this.target = null;
    this.targetBld = null;

    this.carrying = 0;
    this.carryType = null;
    this.maxCarry = 10;
    this.gatherTarget = null;
    this.gatherTimer = 0;
    this.gatherTime = 2.0;

    this.buildTarget = null;
    this.buildTimer = 0;

    this.animTimer = Math.random() * 2;
    this.lastAttackTime = 999;
    this.lastAttackTarget = null;
  }

  update(dt, map, allUnits, buildings) {
    this.animTimer += dt;
    this.lastAttackTime += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    switch (this.state) {
      case 'moving':
        this._updateMoving(dt);
        break;
      case 'attacking':
        this._updateAttacking(dt, map);
        break;
      case 'gathering':
        this._updateGathering(dt, map, buildings);
        break;
      case 'returning':
        this._updateReturning(dt, map, buildings);
        break;
      case 'building':
        this._updateBuilding(dt, map);
        break;
      case 'attackingBuilding':
        this._updateAttackingBuilding(dt, map);
        break;
      case 'idle':
        this._checkAggro(allUnits);
        break;
      default:
        break;
    }

    this.tileX = Math.floor(this.x / TILE_SIZE);
    this.tileY = Math.floor(this.y / TILE_SIZE);
  }

  _checkAggro(allUnits) {
    if (this.type === 'worker') return;
    const aggroDistPx = AGGRO_RANGE * TILE_SIZE;
    let closest = null;
    let closestDist = aggroDistPx;

    for (const other of allUnits) {
      if (other.team === this.team || other.hp <= 0) continue;
      const dx = other.x - this.x;
      const dy = other.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = other;
      }
    }

    if (closest) {
      this.target = closest;
      this.state = 'attacking';
    }
  }

  _updateMoving(dt) {
    if (this.path.length === 0) {
      this.state = 'idle';
      return;
    }

    const target = this.path[0];
    const targetX = target.x * TILE_SIZE + TILE_SIZE / 2;
    const targetY = target.y * TILE_SIZE + TILE_SIZE / 2;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 2) {
      this.x = targetX;
      this.y = targetY;
      this.path.shift();
      if (this.path.length === 0) this.state = 'idle';
      return;
    }

    this.x += (dx / dist) * this.speed * dt;
    this.y += (dy / dist) * this.speed * dt;
  }

  _updateAttacking(dt, map) {
    if (!this.target || this.target.hp <= 0) {
      this.target = null;
      this.state = 'idle';
      return;
    }

    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rangePx = this.attackRange * TILE_SIZE;

    if (dist <= rangePx) {
      this.path = [];
      if (this.attackCooldown <= 0) {
        const actualDmg = Math.max(1, this.damage - this.target.armor);
        this.target.hp -= actualDmg;
        this.attackCooldown = this.attackSpeed;
        this.lastAttackTime = 0;
        this.lastAttackTarget = { x: this.target.x, y: this.target.y };

        if (this.target.hp <= 0) {
          this.target = null;
          this.state = 'idle';
        }
      }
      return;
    }

    if (this.path.length === 0 || this.animTimer % 1.0 < dt) {
      const ttx = Math.floor(this.target.x / TILE_SIZE);
      const tty = Math.floor(this.target.y / TILE_SIZE);
      this.path = this.flying ? [{ x: ttx, y: tty }] : (this.naval ? findPathWater(map, this.tileX, this.tileY, ttx, tty) : findPath(map, this.tileX, this.tileY, ttx, tty));
    }

    this._updateMoving(dt);
    this.state = 'attacking';
  }

  _updateAttackingBuilding(dt, map) {
    if (!this.targetBld || this.targetBld.hp <= 0) {
      this.targetBld = null;
      this.state = 'idle';
      return;
    }

    const bld = this.targetBld;
    const dx = bld.x - this.x;
    const dy = bld.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rangePx = this.attackRange * TILE_SIZE;

    if (dist <= rangePx + bld.sizeTiles * TILE_SIZE / 2) {
      this.path = [];
      if (this.attackCooldown <= 0) {
        bld.hp -= this.damage;
        this.attackCooldown = this.attackSpeed;
        this.lastAttackTime = 0;
        this.lastAttackTarget = { x: bld.x, y: bld.y };

        if (bld.hp <= 0) {
          this.targetBld = null;
          this.state = 'idle';
        }
      }
      return;
    }

    if (this.path.length === 0 || this.animTimer % 1.0 < dt) {
      const bx = Math.floor(bld.x / TILE_SIZE);
      const by = Math.floor(bld.y / TILE_SIZE);
      if (this.flying) {
        this.path = [{ x: bx, y: by }];
      } else if (this.naval) {
        this.path = findPathWater(map, this.tileX, this.tileY, bx, by);
      } else {
        const adj = this._findAdjacentWalkable(map, bx, by);
        this.path = adj ? findPath(map, this.tileX, this.tileY, adj.x, adj.y) : [];
      }
    }

    this._updateMoving(dt);
    this.state = 'attackingBuilding';
  }

  _updateGathering(dt, map, buildings) {
    if (!this.gatherTarget) {
      this.state = 'idle';
      return;
    }

    const gtx = this.gatherTarget.x;
    const gty = this.gatherTarget.y;
    const tileType = map.getTile(gtx, gty);
    const isMineral = tileType === TILE_MINERAL;
    const isTree = tileType === TILE_TREE;

    if (!isMineral && !isTree) {
      this.gatherTarget = null;
      this.state = 'idle';
      return;
    }

    const dx = Math.abs(this.tileX - gtx);
    const dy = Math.abs(this.tileY - gty);

    if (dx <= 1 && dy <= 1) {
      this.path = [];
      this.gatherTimer += dt;

      if (this.gatherTimer >= this.gatherTime) {
        this.gatherTimer = 0;
        const key = `${gtx},${gty}`;

        if (isMineral) {
          const remaining = map.mineralAmounts.get(key) || 0;
          const amount = Math.min(this.maxCarry, remaining);
          this.carrying += amount;
          this.carryType = 'minerals';
          map.mineralAmounts.set(key, remaining - amount);
          if (remaining - amount <= 0) {
            map.setTile(gtx, gty, 2);
            map.mineralAmounts.delete(key);
          }
        } else {
          const remaining = map.woodAmounts.get(key) || 0;
          const amount = Math.min(this.maxCarry, remaining);
          this.carrying += amount;
          this.carryType = 'wood';
          map.woodAmounts.set(key, remaining - amount);
          if (remaining - amount <= 0) {
            map.setTile(gtx, gty, 2);
            map.woodAmounts.delete(key);
          }
        }

        this.state = 'returning';
        this._returnToBase(map, buildings);
      }
      return;
    }

    if (this.path.length === 0) {
      const adj = this._findAdjacentWalkable(map, gtx, gty);
      if (adj) this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
      if (this.path.length === 0) {
        this.gatherTarget = null;
        this.state = 'idle';
        return;
      }
    }

    this._updateMoving(dt);
    this.state = 'gathering';
  }

  _updateReturning(dt, map, buildings) {
    const base = this._findNearestBase(buildings);
    if (!base) {
      this.state = 'idle';
      return;
    }

    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    const dx = Math.abs(this.tileX - bx);
    const dy = Math.abs(this.tileY - by);

    if (dx <= 2 && dy <= 2) {
      this.path = [];
      this._onDeposit = true;

      if (this.gatherTarget) {
        const tileType = map.getTile(this.gatherTarget.x, this.gatherTarget.y);
        if (tileType === TILE_MINERAL || tileType === TILE_TREE) {
          this.state = 'gathering';
          this.gatherTimer = 0;
        } else {
          this.state = 'idle';
          this.carrying = 0;
          this.carryType = null;
        }
      } else {
        this.state = 'idle';
        this.carrying = 0;
        this.carryType = null;
      }
      return;
    }

    if (this.path.length === 0) {
      const adj = this._findAdjacentWalkable(map, bx, by);
      if (adj) this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
      if (this.path.length === 0) {
        this.state = 'idle';
        return;
      }
    }

    this._updateMoving(dt);
    this.state = 'returning';
  }

  _updateBuilding(dt, map) {
    if (!this.buildTarget || this.buildTarget.hp <= 0) {
      this.buildTarget = null;
      this.state = 'idle';
      return;
    }

    const bld = this.buildTarget;
    const bx = Math.floor(bld.x / TILE_SIZE);
    const by = Math.floor(bld.y / TILE_SIZE);
    const dx = Math.abs(this.tileX - bx);
    const dy = Math.abs(this.tileY - by);

    if (dx <= 2 && dy <= 2) {
      this.path = [];
      this.buildTimer += dt;

      if (this.buildTimer >= 0.5) {
        this.buildTimer = 0;
        bld.buildProgress = Math.min(bld.buildTime, bld.buildProgress + 0.5);
        if (bld.buildProgress >= bld.buildTime) {
          bld.built = true;
          this.buildTarget = null;
          this.state = 'idle';
        }
      }
      return;
    }

    if (this.path.length === 0) {
      const adj = this._findAdjacentWalkable(map, bx, by);
      if (adj) this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
      if (this.path.length === 0) {
        this.buildTarget = null;
        this.state = 'idle';
        return;
      }
    }

    this._updateMoving(dt);
    this.state = 'building';
  }

  _returnToBase(map, buildings) {
    const base = this._findNearestBase(buildings);
    if (!base) return;
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    const adj = this._findAdjacentWalkable(map, bx, by);
    if (adj) this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
  }

  _findNearestBase(buildings) {
    let closest = null;
    let closestDist = Infinity;
    for (const b of buildings) {
      if (b.type !== 'base' || b.team !== this.team || !b.built) continue;
      const dx = b.x - this.x;
      const dy = b.y - this.y;
      const d = dx * dx + dy * dy;
      if (d < closestDist) {
        closestDist = d;
        closest = b;
      }
    }
    return closest;
  }

  _findAdjacentWalkable(map, tx, ty) {
    const offsets = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
    ];
    let best = null;
    let bestDist = Infinity;
    for (const o of offsets) {
      const nx = tx + o.x;
      const ny = ty + o.y;
      if (map.isWalkable(nx, ny)) {
        const dx = this.tileX - nx;
        const dy = this.tileY - ny;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = { x: nx, y: ny };
        }
      }
    }
    return best;
  }

  moveTo(map, targetTileX, targetTileY) {
    this.path = this.flying ? [{ x: targetTileX, y: targetTileY }] : (this.naval ? findPathWater(map, this.tileX, this.tileY, targetTileX, targetTileY) : findPath(map, this.tileX, this.tileY, targetTileX, targetTileY));
    if (this.path.length > 0 || this.flying) {
      this.state = 'moving';
      this.target = null;
      this.targetBld = null;
      this.gatherTarget = null;
      this.buildTarget = null;
    }
  }

  attackTarget(target) {
    this.target = target;
    this.targetBld = null;
    this.state = 'attacking';
    this.path = [];
    this.gatherTarget = null;
    this.buildTarget = null;
  }

  attackBuilding(building) {
    this.targetBld = building;
    this.target = null;
    this.state = 'attackingBuilding';
    this.path = [];
    this.gatherTarget = null;
    this.buildTarget = null;
  }

  gatherFrom(tileX, tileY) {
    this.gatherTarget = { x: tileX, y: tileY };
    this.gatherTimer = 0;
    this.state = 'gathering';
    this.target = null;
    this.targetBld = null;
    this.buildTarget = null;
    this.path = [];
  }

  buildBuilding(building) {
    this.buildTarget = building;
    this.buildTimer = 0;
    this.state = 'building';
    this.target = null;
    this.targetBld = null;
    this.gatherTarget = null;
    this.path = [];
  }

  stop() {
    this.path = [];
    this.state = 'idle';
    this.target = null;
    this.targetBld = null;
    this.gatherTarget = null;
    this.buildTarget = null;
  }

  toSnapshot() {
    return {
      id: this.id,
      type: this.type,
      team: this.team,
      x: this.x,
      y: this.y,
      tileX: this.tileX,
      tileY: this.tileY,
      hp: this.hp,
      maxHp: this.maxHp,
      armor: this.armor,
      damage: this.damage,
      state: this.state,
      carrying: this.carrying,
      carryType: this.carryType,
      flying: this.flying,
      naval: this.naval,
      path: this.path,
      lastAttackTime: this.lastAttackTime,
      lastAttackTarget: this.lastAttackTarget,
      gatherTarget: this.gatherTarget,
      targetId: this.target ? this.target.id : null,
      targetBldId: this.targetBld ? this.targetBld.id : null,
      buildTargetId: this.buildTarget ? this.buildTarget.id : null,
    };
  }

  static fromSnapshot(snapshot) {
    const tileX = Math.floor((snapshot?.x || 0) / TILE_SIZE);
    const tileY = Math.floor((snapshot?.y || 0) / TILE_SIZE);
    const u = new Unit(tileX, tileY, snapshot.type, snapshot.team);
    u.id = snapshot.id;
    u.x = snapshot.x;
    u.y = snapshot.y;
    u.tileX = snapshot.tileX ?? tileX;
    u.tileY = snapshot.tileY ?? tileY;
    u.hp = snapshot.hp;
    u.maxHp = snapshot.maxHp;
    u.armor = snapshot.armor;
    u.damage = snapshot.damage;
    u.state = snapshot.state || 'idle';
    u.carrying = snapshot.carrying || 0;
    u.carryType = snapshot.carryType || null;
    u.path = Array.isArray(snapshot.path) ? snapshot.path.map((p) => ({ x: p.x, y: p.y })) : [];
    u.lastAttackTime = snapshot.lastAttackTime ?? 999;
    u.lastAttackTarget = snapshot.lastAttackTarget || null;
    u.gatherTarget = snapshot.gatherTarget || null;
    return u;
  }
}

export function applyUnitSeparation(units, dt) {
  const sepRadius = 14.4;
  const sepForce = 120;

  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      if (a.naval !== b.naval) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < sepRadius && dist > 0.1) {
        const overlap = (sepRadius - dist) / sepRadius;
        const pushX = (dx / dist) * overlap * sepForce * dt;
        const pushY = (dy / dist) * overlap * sepForce * dt;
        const aMoving = a.state === 'moving' || a.state === 'attacking' || a.state === 'attackingBuilding';
        const bMoving = b.state === 'moving' || b.state === 'attacking' || b.state === 'attackingBuilding';
        const aWeight = aMoving ? 0.3 : 0.7;
        const bWeight = bMoving ? 0.3 : 0.7;
        a.x -= pushX * aWeight;
        a.y -= pushY * aWeight;
        b.x += pushX * bWeight;
        b.y += pushY * bWeight;
      }
    }
  }
}
