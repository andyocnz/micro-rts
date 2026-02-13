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
    hp: 70,
    damage: 10,
    armor: 1,
    speed: 75,
    attackRange: 3.5,
    attackSpeed: 1.0,
    flying: false,
    hotkey: 's',
    icon: 'S',
  },
  tank: {
    name: 'Tank',
    hp: 210,
    damage: 28,
    armor: 4,
    speed: 45,
    attackRange: 4.5,
    attackSpeed: 2.0,
    flying: false,
    hotkey: 't',
    icon: 'T',
  },
  rocket: {
    name: 'Rocket',
    hp: 80,
    damage: 30,
    armor: 0,
    speed: 60,
    attackRange: 6.0,
    attackSpeed: 2.6,
    flying: false,
    hotkey: 'r',
    icon: 'R',
  },
  bomber: {
    name: 'Helicopter',
    hp: 130,
    damage: 40,
    armor: 1,
    speed: 100,
    attackRange: 3.0,
    attackSpeed: 3.0,
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
    this.buildQueue = []; // queued buildings to construct after current target

    // Visual
    this.animTimer = Math.random() * 2;
    this.lastAttackTime = 999;
    this.lastAttackTarget = null;
    this.facingAngle = 0;
    this._lastX = this.x;
    this._lastY = this.y;
    this._stuckTimer = 0;
    this.commandLockTimer = 0;
  }

  get tileKey() {
    return `${this.tileX},${this.tileY}`;
  }

  update(dt, map, allUnits, buildings, isHostile = (a, b) => a !== b) {
    this.animTimer += dt;
    this.lastAttackTime += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.commandLockTimer = Math.max(0, this.commandLockTimer - dt);

    switch (this.state) {
      case 'moving':
        this._updateMoving(dt, map);
        break;
      case 'attacking':
        this._updateAttacking(dt, map, allUnits, isHostile);
        break;
      case 'gathering':
        this._updateGathering(dt, map, buildings, allUnits);
        break;
      case 'returning':
        this._updateReturning(dt, map, buildings, allUnits);
        break;
      case 'building':
        this._updateBuilding(dt, map, allUnits, buildings);
        break;
      case 'attackingBuilding':
        this._updateAttackingBuilding(dt, map, isHostile);
        break;
      case 'idle':
        if (this.buildQueue.length > 0) {
          this._startNextQueuedBuild();
          break;
        }
        this._checkAggro(allUnits, isHostile);
        break;
    }

    // Update tile position
    this.tileX = Math.floor(this.x / TILE_SIZE);
    this.tileY = Math.floor(this.y / TILE_SIZE);
    this._updateStuckRecovery(dt, map);
  }

  _updateStuckRecovery(dt, map) {
    const activeState = this.state === 'moving' ||
      this.state === 'gathering' ||
      this.state === 'returning' ||
      this.state === 'building' ||
      this.state === 'attacking' ||
      this.state === 'attackingBuilding';
    if (!activeState) {
      this._stuckTimer = 0;
      this._stuckJittered = false;
      this._lastX = this.x;
      this._lastY = this.y;
      return;
    }

    const dx = this.x - this._lastX;
    const dy = this.y - this._lastY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    this._lastX = this.x;
    this._lastY = this.y;

    if (moved < 0.12) {
      this._stuckTimer += dt;
    } else {
      this._stuckTimer = 0;
      this._stuckJittered = false;
    }

    // Phase 1: Jitter - random displacement to break deadlocks
    if (this._stuckTimer > 0.8 && !this._stuckJittered) {
      const angle = Math.random() * Math.PI * 2;
      const jitterDist = TILE_SIZE * 0.4;
      const newX = this.x + Math.cos(angle) * jitterDist;
      const newY = this.y + Math.sin(angle) * jitterDist;
      const tx = Math.floor(newX / TILE_SIZE);
      const ty = Math.floor(newY / TILE_SIZE);
      const valid = this.flying || (this.naval ? map.isSwimmable(tx, ty) : map.isWalkable(tx, ty));
      if (valid) {
        this.x = newX;
        this.y = newY;
      }
      this._stuckJittered = true;
    }

    // Phase 2: Clear path and force re-evaluation
    if (this._stuckTimer > 1.5) {
      this.path = [];
      this._stuckTimer = 0;
      this._stuckJittered = false;
    }
  }

  _checkAggro(allUnits, isHostile) {
    // Respect recent explicit move commands so live combat does not instantly hijack movement.
    if (this.commandLockTimer > 0) return;
    if (this.type === 'worker') return; // workers don't auto-aggro
    const aggroDistPx = AGGRO_RANGE * TILE_SIZE;
    let closest = null;
    let closestDist = aggroDistPx;

    for (const other of allUnits) {
      if (!isHostile(this.team, other.team) || other.hp <= 0) continue;
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
    if (dist > 0.001) {
      this.facingAngle = Math.atan2(dy, dx);
    }

    if (dist < 4) {
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

  _updateAttacking(dt, map, allUnits, isHostile) {
    if (!this.target || this.target.hp <= 0 || !isHostile(this.team, this.target.team)) {
      this.target = null;
      this.state = 'idle';
      return;
    }

    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.001) {
      this.facingAngle = Math.atan2(dy, dx);
    }
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
          sfxExplosion(this.target.x, this.target.y);
        } else {
          sfxAttack(this.target.x, this.target.y);
        }

        if (this.target.hp <= 0) {
          sfxDeath(this.target.x, this.target.y);
          this.target = null;
          this.state = 'idle';
        }
      }
    } else {
      const ttx = Math.floor(this.target.x / TILE_SIZE);
      const tty = Math.floor(this.target.y / TILE_SIZE);
      const tileDist = Math.abs(ttx - this.tileX) + Math.abs(tty - this.tileY);

      if (!this.naval && !this.flying && tileDist <= 4 && this.path.length === 0) {
        // Close range: walk directly toward target, let separation handle collisions
        const mdist = Math.sqrt(dx * dx + dy * dy);
        if (mdist > 0.1) {
          const newX = this.x + (dx / mdist) * this.speed * dt;
          const newY = this.y + (dy / mdist) * this.speed * dt;
          const ntx = Math.floor(newX / TILE_SIZE);
          const nty = Math.floor(newY / TILE_SIZE);
          if (map.isWalkable(ntx, nty)) {
            this.x = newX;
            this.y = newY;
          }
        }
      } else {
        // Far away: use A* pathfinding with cooldown
        this._repathCooldown = Math.max(0, (this._repathCooldown || 0) - dt);
        const needsRepath = (this.path.length === 0 && this._repathCooldown <= 0) || this.animTimer % 1.0 < dt;
        if (needsRepath) {
          if (this.flying) {
            this._flyToward(ttx, tty, map);
          } else if (this.naval) {
            this.path = findPathWater(map, this.tileX, this.tileY, ttx, tty);
          } else {
            this.path = findPath(map, this.tileX, this.tileY, ttx, tty);
          }
          if (this.path.length === 0) this._repathCooldown = 0.5;
        }
        this._updateMoving(dt, map);
      }
      this.state = 'attacking'; // Stay in attacking state
    }
  }

  _updateAttackingBuilding(dt, map, isHostile) {
    if (!this.targetBld || this.targetBld.hp <= 0 || !isHostile(this.team, this.targetBld.team)) {
      this.targetBld = null;
      this.state = 'idle';
      return;
    }

    const bld = this.targetBld;
    const dx = bld.x - this.x;
    const dy = bld.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.001) {
      this.facingAngle = Math.atan2(dy, dx);
    }
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
          sfxExplosion(bld.x, bld.y);
        } else {
          sfxAttack(bld.x, bld.y);
        }

        if (bld.hp <= 0) {
          sfxDeath(bld.x, bld.y);
          this.targetBld = null;
          this.state = 'idle';
        }
      }
    } else {
      const bx = Math.floor(bld.x / TILE_SIZE);
      const by = Math.floor(bld.y / TILE_SIZE);
      const tileDist = Math.abs(bx - this.tileX) + Math.abs(by - this.tileY);

      if (!this.naval && !this.flying && tileDist <= 4 && this.path.length === 0) {
        // Close range: walk directly toward building
        if (dist > 0.1) {
          const newX = this.x + (dx / dist) * this.speed * dt;
          const newY = this.y + (dy / dist) * this.speed * dt;
          const ntx = Math.floor(newX / TILE_SIZE);
          const nty = Math.floor(newY / TILE_SIZE);
          if (map.isWalkable(ntx, nty)) {
            this.x = newX;
            this.y = newY;
          }
        }
      } else {
        // Far away: use A* pathfinding with cooldown
        this._repathCooldown = Math.max(0, (this._repathCooldown || 0) - dt);
        const needsRepath = (this.path.length === 0 && this._repathCooldown <= 0) || this.animTimer % 1.0 < dt;
        if (needsRepath) {
          if (this.flying) {
            this._flyToward(bx, by, map);
          } else if (this.naval) {
            this.path = findPathWater(map, this.tileX, this.tileY, bx, by);
          } else {
            const adj = this._findAdjacentWalkable(map, bx, by);
            if (adj) {
              this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
            }
          }
          if (this.path.length === 0) this._repathCooldown = 0.5;
        }
        this._updateMoving(dt, map);
      }
      this.state = 'attackingBuilding';
    }
  }

  _updateGathering(dt, map, buildings, allUnits) {
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
          sfxMine(gtx * TILE_SIZE + TILE_SIZE / 2, gty * TILE_SIZE + TILE_SIZE / 2);

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
          sfxChop(gtx * TILE_SIZE + TILE_SIZE / 2, gty * TILE_SIZE + TILE_SIZE / 2);

          if (remaining - amount <= 0) {
            map.setTile(gtx, gty, 2); // becomes dirt
            map.woodAmounts.delete(key);
          }
        }

        // Return to base
        this.state = 'returning';
        this._returnToBase(map, buildings, allUnits);
      }
    } else {
      // Walk to an adjacent tile
      if (this.path.length === 0) {
        const adj = this._findAdjacentWalkable(map, gtx, gty, allUnits, buildings);
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

  _updateReturning(dt, map, buildings, allUnits) {
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
      sfxDeposit(this.x, this.y);

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
        const adj = this._findAdjacentWalkable(map, bx, by, allUnits, buildings);
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

  _updateBuilding(dt, map, allUnits, buildings) {
    if (!this.buildTarget || this.buildTarget.hp <= 0) {
      this.buildTarget = null;
      this._startNextQueuedBuild();
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
          this._startNextQueuedBuild();
        }
      }
    } else {
      if (this.path.length === 0) {
        const adj = this._findAdjacentWalkable(map, bx, by, allUnits, buildings, bld);
        if (adj) {
          this.path = findPath(map, this.tileX, this.tileY, adj.x, adj.y);
        }
        if (this.path.length === 0) {
          this.buildTarget = null;
          this._startNextQueuedBuild();
          return;
        }
      }
      this._updateMoving(dt, map);
      this.state = 'building';
    }
  }

  _startNextQueuedBuild() {
    while (this.buildQueue.length > 0) {
      const next = this.buildQueue.shift();
      if (!next || next.hp <= 0 || next.built) continue;
      next.constructionQueued = false;
      this.buildTarget = next;
      this.buildTimer = 0;
      this.state = 'building';
      this.target = null;
      this.targetBld = null;
      this.gatherTarget = null;
      this.path = [];
      return;
    }
    this.state = 'idle';
  }

  _clearBuildQueue(cancelQueuedVisual = true) {
    if (cancelQueuedVisual) {
      for (const b of this.buildQueue) {
        if (b && !b.built) b.constructionQueued = false;
      }
    }
    this.buildQueue = [];
  }

  _returnToBase(map, buildings, allUnits = null) {
    const base = this._findNearestBase(buildings);
    if (!base) return;
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    const adj = this._findAdjacentWalkable(map, bx, by, allUnits, buildings);
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

  _findAdjacentWalkable(map, tx, ty, allUnits = null, buildings = null, ignoreBuilding = null) {
    const offsets = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
    ];
    const shuffled = offsets
      .map((o) => ({ o, r: Math.random() }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.o);
    let best = null;
    let bestDist = Infinity;
    for (const o of shuffled) {
      const nx = tx + o.x;
      const ny = ty + o.y;
      if (!map.isWalkable(nx, ny)) continue;
      if (this._isTileBlockedByBuilding(nx, ny, buildings, ignoreBuilding)) continue;
      const occupied = this._isTileOccupiedByOtherUnit(nx, ny, allUnits);
      const dx = this.tileX - nx;
      const dy = this.tileY - ny;
      // Penalize occupied tiles heavily so workers spread around targets.
      const d = dx * dx + dy * dy + (occupied ? 1000 : 0);
      if (d < bestDist) {
        bestDist = d;
        best = { x: nx, y: ny };
      }
    }
    return best;
  }

  _isTileOccupiedByOtherUnit(tx, ty, allUnits) {
    if (!allUnits) return false;
    for (const u of allUnits) {
      if (u === this || u.hp <= 0) continue;
      if (Math.floor(u.x / TILE_SIZE) === tx && Math.floor(u.y / TILE_SIZE) === ty) {
        return true;
      }
    }
    return false;
  }

  _isTileBlockedByBuilding(tx, ty, buildings, ignoreBuilding = null) {
    if (!buildings) return false;
    for (const b of buildings) {
      if (!b || b.hp <= 0) continue;
      if (ignoreBuilding && b === ignoreBuilding) continue;
      if (b.occupiesTile && b.occupiesTile(tx, ty)) return true;
    }
    return false;
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
      this._clearBuildQueue();
      return;
    }
    const pathFn = this.naval ? findPathWater : findPath;
    const path = pathFn(map, this.tileX, this.tileY, targetTileX, targetTileY);
    if (path.length > 0) {
      this.path = path;
      this.state = 'moving';
      this.commandLockTimer = 1.25;
      this.target = null;
      this.gatherTarget = null;
      this.buildTarget = null;
      this._clearBuildQueue();
    }
  }

  attackTarget(target, map) {
    this.target = target;
    this.targetBld = null;
    this.state = 'attacking';
    this.commandLockTimer = 0;
    this.path = [];
    this.gatherTarget = null;
    this.buildTarget = null;
    this._clearBuildQueue();
  }

  attackBuilding(building, map) {
    this.targetBld = building;
    this.target = null;
    this.state = 'attackingBuilding';
    this.commandLockTimer = 0;
    this.gatherTarget = null;
    this.buildTarget = null;
    this._clearBuildQueue();
    this.path = [];
  }

  gatherFrom(tileX, tileY, map, buildings) {
    this.gatherTarget = { x: tileX, y: tileY };
    this.gatherTimer = 0;
    this.state = 'gathering';
    this.target = null;
    this.buildTarget = null;
    this._clearBuildQueue();
    this.path = [];
  }

  buildBuilding(building, map) {
    if (this.buildTarget === building) return;
    if (this.buildTarget && this.buildTarget !== building) {
      if (this.buildQueue.includes(building)) return;
      building.constructionQueued = true;
      this.buildQueue.push(building);
      return;
    }
    building.constructionQueued = false;
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
    this.gatherTarget = null;
    this.buildTarget = null;
    this._clearBuildQueue();
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

  update(dt, map, buildings, isHostile = (a, b) => a !== b) {
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
      unit.update(dt, map, this.units, buildings, isHostile);
    }

    // Helper: check if a pixel position is on a walkable tile (or swimmable for naval)
    const isValidPos = (unit, px, py) => {
      const tx = Math.floor(px / TILE_SIZE);
      const ty = Math.floor(py / TILE_SIZE);
      return unit.naval ? map.isSwimmable(tx, ty) : (unit.flying || map.isWalkable(tx, ty));
    };

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
          // Asymmetric flow: moving units push idle units aside
          const aHasPath = a.path && a.path.length > 0;
          const bHasPath = b.path && b.path.length > 0;
          let aWeight, bWeight;
          if (aHasPath && !bHasPath) {
            aWeight = 0.15; bWeight = 0.85; // A moves through, B yields
          } else if (!aHasPath && bHasPath) {
            aWeight = 0.85; bWeight = 0.15; // B moves through, A yields
          } else if (aHasPath && bHasPath) {
            aWeight = 0.35; bWeight = 0.35; // Both moving: moderate push
          } else {
            aWeight = 0.5; bWeight = 0.5;   // Both idle: equal push
          }
          // Only push if destination tile is valid (don't push into water/trees)
          const newAx = a.x - pushX * aWeight;
          const newAy = a.y - pushY * aWeight;
          const newBx = b.x + pushX * bWeight;
          const newBy = b.y + pushY * bWeight;
          if (isValidPos(a, newAx, newAy)) { a.x = newAx; a.y = newAy; }
          if (isValidPos(b, newBx, newBy)) { b.x = newBx; b.y = newBy; }
        } else if (dist <= 0.1) {
          // Nearly exact overlap — nudge randomly
          const angle = Math.random() * Math.PI * 2;
          const nudge = sepRadius * 0.5;
          const newAx = a.x - Math.cos(angle) * nudge;
          const newAy = a.y - Math.sin(angle) * nudge;
          const newBx = b.x + Math.cos(angle) * nudge;
          const newBy = b.y + Math.sin(angle) * nudge;
          if (isValidPos(a, newAx, newAy)) { a.x = newAx; a.y = newAy; }
          if (isValidPos(b, newBx, newBy)) { b.x = newBx; b.y = newBy; }
        }
      }
    }

    // Recovery: snap units stuck on invalid tiles back to nearest valid tile
    for (const unit of this.units) {
      if (unit.flying) continue;
      const tx = Math.floor(unit.x / TILE_SIZE);
      const ty = Math.floor(unit.y / TILE_SIZE);
      const valid = unit.naval ? map.isSwimmable(tx, ty) : map.isWalkable(tx, ty);
      if (!valid) {
        // Find nearest valid tile and teleport there
        for (let r = 1; r <= 5; r++) {
          let found = false;
          for (let dy = -r; dy <= r && !found; dy++) {
            for (let dx = -r; dx <= r && !found; dx++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
              const nx = tx + dx;
              const ny = ty + dy;
              const ok = unit.naval ? map.isSwimmable(nx, ny) : map.isWalkable(nx, ny);
              if (ok) {
                unit.x = nx * TILE_SIZE + TILE_SIZE / 2;
                unit.y = ny * TILE_SIZE + TILE_SIZE / 2;
                unit.tileX = nx;
                unit.tileY = ny;
                found = true;
              }
            }
          }
          if (found) break;
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
