import { TILE_SIZE, UNIT_SPEED, UNIT_SIZE, TILE_MINERAL, TILE_TREE } from './constants.js';
import { findPath, findPathWater } from './pathfinding.js';
import { sfxAttack, sfxDeath, sfxMine, sfxChop, sfxDeposit, sfxExplosion } from './audio.js';

let nextId = 1;

const AGGRO_RANGE = 6; // tiles - units auto-attack enemies within this range

export const UNIT_DEFS = {
  worker: {
    name: 'Worker',
    hp: 40,
    damage: 5,
    armor: 0,
    speed: 80,
    attackRange: 1.5,
    attackSpeed: 1.5,
    flying: false,
    hotkey: 'w',
    icon: 'W',
  },
  soldier: {
    name: 'Soldier',
    hp: 80,
    damage: 12,
    armor: 2,
    speed: 75,
    attackRange: 3.5,
    attackSpeed: 1.0,
    flying: false,
    hotkey: 's',
    icon: 'S',
  },
  tank: {
    name: 'Tank',
    hp: 220,
    damage: 28,
    armor: 5,
    speed: 45,
    attackRange: 4.5,
    attackSpeed: 2.0,
    flying: false,
    hotkey: 't',
    icon: 'T',
  },
  rocket: {
    name: 'Rocket',
    hp: 60,
    damage: 30,
    armor: 0,
    speed: 60,
    attackRange: 6.0,
    attackSpeed: 3.0,
    flying: false,
    hotkey: 'r',
    icon: 'R',
  },
  bomber: {
    name: 'Helicopter',
    hp: 100,
    damage: 40,
    armor: 1,
    speed: 100,
    attackRange: 3.0,
    attackSpeed: 3.5,
    flying: true,
    hotkey: 'h',
    icon: 'H',
  },
  battleship: {
    name: 'Marine Ship',
    hp: 250,
    damage: 35,
    armor: 4,
    speed: 40,
    attackRange: 7.0,
    attackSpeed: 3.0,
    flying: false,
    naval: true,
    hotkey: 'm',
    icon: 'M',
  },
};

export class Unit {
  constructor(tileX, tileY, type, team) {
    this.id = nextId++;
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

    this.selected = false;
    this.path = [];
    this.state = 'idle'; // 'idle' | 'moving' | 'attacking' | 'gathering' | 'returning' | 'building' | 'attackingBuilding'
    this.target = null;
    this.targetBld = null; // target building for attacking

    // Gathering
    this.carrying = 0;
    this.carryType = null; // 'minerals' | 'wood'
    this.maxCarry = 10;
    this.gatherTarget = null; // { x, y } tile coords of resource
    this.gatherTimer = 0;
    this.gatherTime = 2.0; // seconds to mine/chop

    // Building
    this.buildTarget = null;  // reference to building being constructed
    this.buildTimer = 0;

    // Visual
    this.animTimer = Math.random() * 2;
    this.lastAttackTime = 999;
    this.lastAttackTarget = null;
  }

  get tileKey() {
    return `${this.tileX},${this.tileY}`;
  }

  update(dt, map, allUnits, buildings) {
    this.animTimer += dt;
    this.lastAttackTime += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    switch (this.state) {
      case 'moving':
        this._updateMoving(dt, map);
        break;
      case 'attacking':
        this._updateAttacking(dt, map, allUnits);
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
    }

    // Update tile position
    this.tileX = Math.floor(this.x / TILE_SIZE);
    this.tileY = Math.floor(this.y / TILE_SIZE);
  }

  _checkAggro(allUnits) {
    if (this.type === 'worker') return; // workers don't auto-aggro
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

  _updateMoving(dt, map) {
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
      if (this.path.length === 0) {
        this.state = 'idle';
      }
    } else {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }
  }

  _updateAttacking(dt, map, allUnits) {
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
      // In range - attack
      this.path = [];
      if (this.attackCooldown <= 0) {
        const actualDmg = Math.max(1, this.damage - this.target.armor);
        this.target.hp -= actualDmg;
        this.attackCooldown = this.attackSpeed;
        this.lastAttackTime = 0;
        this.lastAttackTarget = { x: this.target.x, y: this.target.y };

        if (this.type === 'rocket' || this.type === 'bomber') {
          sfxExplosion();
        } else {
          sfxAttack();
        }

        if (this.target.hp <= 0) {
          sfxDeath();
          this.target = null;
          this.state = 'idle';
        }
      }
    } else {
      // Move toward target
      if (this.path.length === 0 || this.animTimer % 1.0 < dt) {
        const ttx = Math.floor(this.target.x / TILE_SIZE);
        const tty = Math.floor(this.target.y / TILE_SIZE);
        if (this.flying) {
          this._flyToward(ttx, tty, map);
        } else if (this.naval) {
          this.path = findPathWater(map, this.tileX, this.tileY, ttx, tty);
        } else {
          this.path = findPath(map, this.tileX, this.tileY, ttx, tty);
        }
      }
      this._updateMoving(dt, map);
      this.state = 'attacking'; // Stay in attacking state
    }
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
      // In range - attack building
      this.path = [];
      if (this.attackCooldown <= 0) {
        bld.hp -= this.damage;
        this.attackCooldown = this.attackSpeed;
        this.lastAttackTime = 0;
        this.lastAttackTarget = { x: bld.x, y: bld.y };

        if (this.type === 'rocket' || this.type === 'bomber') {
          sfxExplosion();
        } else {
          sfxAttack();
        }

        if (bld.hp <= 0) {
          sfxDeath();
          this.targetBld = null;
          this.state = 'idle';
        }
      }
    } else {
      // Move toward building
      if (this.path.length === 0 || this.animTimer % 1.0 < dt) {
        const bx = Math.floor(bld.x / TILE_SIZE);
        const by = Math.floor(bld.y / TILE_SIZE);
        if (this.flying) {
          this._flyToward(bx, by, map);
        } else if (this.naval) {
          // Naval: path to nearest water tile near the building
          this.path = findPathWater(map, this.tileX, this.tileY, bx, by);
        } else {
          const adj = this._findAdjacentWalkable(map, bx, by);
          if (adj) {
            this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
          }
        }
      }
      this._updateMoving(dt, map);
      this.state = 'attackingBuilding';
    }
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

    // Check resource still exists
    if (!isMineral && !isTree) {
      this.gatherTarget = null;
      this.state = 'idle';
      return;
    }

    // Are we adjacent to the resource?
    const dx = Math.abs(this.tileX - gtx);
    const dy = Math.abs(this.tileY - gty);

    if (dx <= 1 && dy <= 1) {
      // Gather!
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
          sfxMine();

          if (remaining - amount <= 0) {
            map.setTile(gtx, gty, 2); // becomes dirt
            map.mineralAmounts.delete(key);
          }
        } else if (isTree) {
          const remaining = map.woodAmounts.get(key) || 0;
          const amount = Math.min(this.maxCarry, remaining);
          this.carrying += amount;
          this.carryType = 'wood';
          map.woodAmounts.set(key, remaining - amount);
          sfxChop();

          if (remaining - amount <= 0) {
            map.setTile(gtx, gty, 2); // becomes dirt
            map.woodAmounts.delete(key);
          }
        }

        // Return to base
        this.state = 'returning';
        this._returnToBase(map, buildings);
      }
    } else {
      // Walk to an adjacent tile
      if (this.path.length === 0) {
        const adj = this._findAdjacentWalkable(map, gtx, gty);
        if (adj) {
          this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
        }
        if (this.path.length === 0) {
          this.gatherTarget = null;
          this.state = 'idle';
          return;
        }
      }
      this._updateMoving(dt, map);
      this.state = 'gathering'; // Stay in gathering
    }
  }

  _updateReturning(dt, map, buildings) {
    // Are we adjacent to our base?
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
      // Deposit
      this.path = [];
      this._onDeposit = true;
      sfxDeposit();

      // Go back to gathering
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
    } else {
      // Walk to base
      if (this.path.length === 0) {
        const adj = this._findAdjacentWalkable(map, bx, by);
        if (adj) {
          this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
        }
        if (this.path.length === 0) {
          this.state = 'idle';
          return;
        }
      }
      this._updateMoving(dt, map);
      this.state = 'returning';
    }
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
      // Build!
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
    } else {
      if (this.path.length === 0) {
        const adj = this._findAdjacentWalkable(map, bx, by);
        if (adj) {
          this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
        }
        if (this.path.length === 0) {
          this.buildTarget = null;
          this.state = 'idle';
          return;
        }
      }
      this._updateMoving(dt, map);
      this.state = 'building';
    }
  }

  _returnToBase(map, buildings) {
    const base = this._findNearestBase(buildings);
    if (!base) return;
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    const adj = this._findAdjacentWalkable(map, bx, by);
    if (adj) {
      this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
    }
  }

  _findNearestBase(buildings) {
    if (!buildings) return null;
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

  _flyToward(targetTileX, targetTileY, map) {
    // Flying units go in a straight line (no pathfinding needed)
    // Generate simple waypoints
    this.path = [{ x: targetTileX, y: targetTileY }];
  }

  // --- Commands ---

  moveTo(map, targetTileX, targetTileY) {
    if (this.flying) {
      this.path = [{ x: targetTileX, y: targetTileY }];
      this.state = 'moving';
      this.target = null;
      this.gatherTarget = null;
      this.buildTarget = null;
      return;
    }
    const pathFn = this.naval ? findPathWater : findPath;
    const path = pathFn(map, this.tileX, this.tileY, targetTileX, targetTileY);
    if (path.length > 0) {
      this.path = path;
      this.state = 'moving';
      this.target = null;
      this.gatherTarget = null;
      this.buildTarget = null;
    }
  }

  attackTarget(target, map) {
    this.target = target;
    this.targetBld = null;
    this.state = 'attacking';
    this.path = [];
    this.gatherTarget = null;
    this.buildTarget = null;
  }

  attackBuilding(building, map) {
    this.targetBld = building;
    this.target = null;
    this.state = 'attackingBuilding';
    this.gatherTarget = null;
    this.buildTarget = null;
    this.path = [];
  }

  gatherFrom(tileX, tileY, map, buildings) {
    this.gatherTarget = { x: tileX, y: tileY };
    this.gatherTimer = 0;
    this.state = 'gathering';
    this.target = null;
    this.buildTarget = null;
    this.path = [];
  }

  buildBuilding(building, map) {
    this.buildTarget = building;
    this.buildTimer = 0;
    this.state = 'building';
    this.target = null;
    this.gatherTarget = null;
    this.path = [];
  }

  stop() {
    this.path = [];
    this.state = 'idle';
    this.target = null;
    this.gatherTarget = null;
    this.buildTarget = null;
  }

  containsScreenPoint(sx, sy, camera) {
    const screen = camera.worldToScreen(this.x, this.y);
    const halfSize = (UNIT_SIZE / 2 + 2) * camera.zoom;
    return sx >= screen.x - halfSize && sx <= screen.x + halfSize &&
      sy >= screen.y - halfSize && sy <= screen.y + halfSize;
  }

  withinScreenBox(box, camera) {
    const screen = camera.worldToScreen(this.x, this.y);
    return screen.x >= box.x1 && screen.x <= box.x2 &&
      screen.y >= box.y1 && screen.y <= box.y2;
  }
}

export class UnitManager {
  constructor() {
    this.units = [];
  }

  add(unit) {
    this.units.push(unit);
    return unit;
  }

  remove(unit) {
    const idx = this.units.indexOf(unit);
    if (idx >= 0) this.units.splice(idx, 1);
  }

  update(dt, map, buildings) {
    const deaths = [];

    // Remove dead units
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].hp <= 0) {
        deaths.push(this.units[i]);
        this.units[i].selected = false;
        this.units.splice(i, 1);
      }
    }

    for (const unit of this.units) {
      unit.update(dt, map, this.units, buildings);
    }

    // Separation: push overlapping units apart
    const sepRadius = UNIT_SIZE * 0.9;
    const sepForce = 120;
    for (let i = 0; i < this.units.length; i++) {
      const a = this.units[i];
      for (let j = i + 1; j < this.units.length; j++) {
        const b = this.units[j];
        // Don't separate land from naval
        if (a.naval !== b.naval) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < sepRadius && dist > 0.1) {
          const overlap = (sepRadius - dist) / sepRadius;
          const pushX = (dx / dist) * overlap * sepForce * dt;
          const pushY = (dy / dist) * overlap * sepForce * dt;
          // Push both units away from each other
          const aMoving = a.state === 'moving' || a.state === 'attacking' || a.state === 'attackingBuilding';
          const bMoving = b.state === 'moving' || b.state === 'attacking' || b.state === 'attackingBuilding';
          // Idle units yield more to moving units
          const aWeight = aMoving ? 0.3 : 0.7;
          const bWeight = bMoving ? 0.3 : 0.7;
          a.x -= pushX * aWeight;
          a.y -= pushY * aWeight;
          b.x += pushX * bWeight;
          b.y += pushY * bWeight;
        } else if (dist <= 0.1) {
          // Nearly exact overlap — nudge randomly
          const angle = Math.random() * Math.PI * 2;
          const nudge = sepRadius * 0.5;
          a.x -= Math.cos(angle) * nudge;
          a.y -= Math.sin(angle) * nudge;
          b.x += Math.cos(angle) * nudge;
          b.y += Math.sin(angle) * nudge;
        }
      }
    }

    return deaths;
  }

  getSelected() {
    return this.units.filter(u => u.selected);
  }

  getPlayerUnits(team) {
    return this.units.filter(u => u.team === team);
  }

  getUnitAtScreen(sx, sy, camera) {
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].containsScreenPoint(sx, sy, camera)) {
        return this.units[i];
      }
    }
    return null;
  }

  getUnitsInScreenBox(box, camera, team = null) {
    return this.units.filter(u => {
      if (team !== null && u.team !== team) return false;
      return u.withinScreenBox(box, camera);
    });
  }

  deselectAll() {
    for (const u of this.units) u.selected = false;
  }
}
