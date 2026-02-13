import { TILE_SIZE, TILE_MINERAL, BUILDING_DEFS } from './constants.js';
import { Building, canPlaceAt, canPlaceDock } from './building.js';

const DIFFICULTY_PRESETS = {
  easy: {
    decisionInterval: 4,
    waveInterval: 90,
    maxWorkers: 4,
    maxRockets: 1,
    maxTanks: 1,
    maxShips: 1,
    maxTowers: 1,
    waveMinFighters: 5,
    aggroRange: 8,
    buildsFactory: false,
    buildsDock: false,
    startBonus: 0,
  },
  normal: {
    decisionInterval: 2,
    waveInterval: 45,
    maxWorkers: 6,
    maxRockets: 2,
    maxTanks: 2,
    maxShips: 2,
    maxTowers: 2,
    waveMinFighters: 3,
    aggroRange: 10,
    buildsFactory: true,
    buildsDock: true,
    startBonus: 0,
  },
  hard: {
    decisionInterval: 1,
    waveInterval: 25,
    maxWorkers: 8,
    maxRockets: 3,
    maxTanks: 3,
    maxShips: 3,
    maxTowers: 3,
    waveMinFighters: 2,
    aggroRange: 12,
    buildsFactory: true,
    buildsDock: true,
    startBonus: 100,
  },
};

export class ServerAI {
  constructor(team, difficulty = 'normal') {
    this.team = team;
    this.timer = 0;
    this.hasBuiltBarracks = false;
    this.hasBuiltFactory = false;
    this.hasBuiltDock = false;
    this.towerCount = 0;
    this.waveTimer = 0;

    const preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
    Object.assign(this, preset);
  }

  setDifficulty(difficulty) {
    const preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
    Object.assign(this, preset);
  }

  update(dt, engine) {
    this.timer += dt;
    this.waveTimer += dt;
    if (this.timer < this.decisionInterval) return;
    this.timer = 0;

    const myUnits = engine.units.filter(u => u.team === this.team && u.hp > 0);
    const myBuildings = engine.buildings.filter(b => b.team === this.team && b.hp > 0);
    const res = engine.resources[this.team];
    if (!res) return;

    const enemyUnits = engine.units.filter(u => u.team !== this.team && u.hp > 0);
    const enemyBuildings = engine.buildings.filter(b => b.team !== this.team && b.hp > 0);

    const myWorkers = myUnits.filter(u => u.type === 'worker');
    const myRockets = myUnits.filter(u => u.type === 'rocket');
    const myTanks = myUnits.filter(u => u.type === 'tank');
    const myShips = myUnits.filter(u => u.type === 'battleship');
    const myLandFighters = myUnits.filter(u => u.type !== 'worker' && !u.naval);
    const myNavalFighters = myUnits.filter(u => u.naval);
    const myBases = myBuildings.filter(b => b.type === 'base' && b.built);
    const myBarracks = myBuildings.filter(b => b.type === 'barracks' && b.built);
    const myFactories = myBuildings.filter(b => b.type === 'factory' && b.built);
    const myDocks = myBuildings.filter(b => b.type === 'dock' && b.built);

    // 1. Put idle workers to gather
    for (const worker of myWorkers) {
      if (worker.state === 'idle' && worker.carrying === 0) {
        const mineral = this._findNearestMineral(worker, engine.map);
        if (mineral) worker.gatherFrom(mineral.x, mineral.y);
      }
    }

    // 2. Build barracks
    if (myBarracks.length === 0 && !this.hasBuiltBarracks && res.minerals >= 100 && myWorkers.length > 0) {
      const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
      if (builder && myBases.length > 0) {
        const spot = this._findBuildSpot(engine, myBases[0], 2);
        if (spot) {
          const barracks = new Building(spot.x, spot.y, 'barracks', this.team);
          engine.buildings.push(barracks);
          engine.spend(this.team, BUILDING_DEFS.barracks.cost);
          builder.buildBuilding(barracks);
          this.hasBuiltBarracks = true;
        }
      }
    }

    // 2b. Build factory
    if (this.buildsFactory && this.hasBuiltBarracks && myFactories.length === 0 && !this.hasBuiltFactory &&
        res.minerals >= 150 && res.wood >= 100 && myWorkers.length > 0) {
      const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
      if (builder && myBases.length > 0) {
        const spot = this._findBuildSpot(engine, myBases[0], 2);
        if (spot) {
          const factory = new Building(spot.x, spot.y, 'factory', this.team);
          engine.buildings.push(factory);
          engine.spend(this.team, BUILDING_DEFS.factory.cost);
          builder.buildBuilding(factory);
          this.hasBuiltFactory = true;
        }
      }
    }

    // 2c. Build towers
    const myTowers = myBuildings.filter(b => b.type === 'tower');
    if (this.hasBuiltBarracks && myTowers.length < this.maxTowers && res.minerals >= 50 && res.wood >= 50 && myWorkers.length > 0) {
      const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
      if (builder && myBases.length > 0) {
        const base = myBases[0];
        const bx = Math.floor(base.x / TILE_SIZE);
        const by = Math.floor(base.y / TILE_SIZE);
        const offsets = [[-2, 0], [0, -2], [3, 0], [0, 3]];
        for (const [ox, oy] of offsets) {
          const tx = bx + ox;
          const ty = by + oy;
          if (canPlaceAt(engine.buildings, tx, ty, 1, engine.map)) {
            const tower = new Building(tx, ty, 'tower', this.team);
            engine.buildings.push(tower);
            engine.spend(this.team, BUILDING_DEFS.tower.cost);
            builder.buildBuilding(tower);
            break;
          }
        }
      }
    }

    // 2d. Build dock
    if (this.buildsDock && this.hasBuiltBarracks && !this.hasBuiltDock && myDocks.length === 0 &&
        res.minerals >= 120 && res.wood >= 80 && myWorkers.length > 0) {
      const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
      if (builder && myBases.length > 0) {
        const spot = this._findDockSpot(engine, myBases[0]);
        if (spot) {
          const dock = new Building(spot.x, spot.y, 'dock', this.team);
          engine.buildings.push(dock);
          engine.spend(this.team, BUILDING_DEFS.dock.cost);
          builder.buildBuilding(dock);
          this.hasBuiltDock = true;
        }
      }
    }

    // 3. Train units
    for (const base of myBases) {
      if (myWorkers.length < this.maxWorkers && base.canTrain('worker', res)) {
        engine.spend(this.team, base.train('worker'));
      }
    }

    for (const barracks of myBarracks) {
      if (res.minerals >= 75) {
        if (myRockets.length < this.maxRockets && barracks.canTrain('rocket', res)) {
          engine.spend(this.team, barracks.train('rocket'));
        } else if (barracks.canTrain('soldier', res)) {
          engine.spend(this.team, barracks.train('soldier'));
        }
      }
    }

    for (const factory of myFactories) {
      if (res.minerals >= 150 && myTanks.length < this.maxTanks && factory.canTrain('tank', res)) {
        engine.spend(this.team, factory.train('tank'));
      }
    }

    for (const dock of myDocks) {
      if (myShips.length < this.maxShips && dock.canTrain('battleship', res)) {
        engine.spend(this.team, dock.train('battleship'));
      }
    }

    // 4. Idle land fighters aggro nearby enemies
    const aggroDist = TILE_SIZE * this.aggroRange;
    for (const fighter of myLandFighters) {
      if (fighter.state === 'idle') {
        const nearEnemy = this._findNearest(fighter, enemyUnits.filter(u => !u.naval));
        if (nearEnemy && this._dist(fighter, nearEnemy) < aggroDist) {
          fighter.attackTarget(nearEnemy);
        }
      }
    }

    // 4b. Naval units
    for (const ship of myNavalFighters) {
      if (ship.state === 'idle') {
        const nearEnemy = this._findNearest(ship, enemyUnits);
        if (nearEnemy && this._dist(ship, nearEnemy) < aggroDist) {
          ship.attackTarget(nearEnemy);
        } else {
          const waterSpot = this._findWaterNearEnemy(engine, enemyBuildings);
          if (waterSpot) ship.moveTo(engine.map, waterSpot.x, waterSpot.y);
        }
      }
    }

    // 5. Send attack wave
    if (this.waveTimer >= this.waveInterval && myLandFighters.length >= this.waveMinFighters) {
      this.waveTimer = 0;
      const targets = [...enemyUnits.filter(u => !u.naval), ...enemyBuildings].filter(t => t.hp > 0);
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        for (const fighter of myLandFighters) {
          if (fighter.state === 'idle' || fighter.state === 'moving') {
            if (target.tileX !== undefined && target.sizeTiles !== undefined) {
              fighter.attackBuilding(target);
            } else {
              fighter.attackTarget(target);
            }
          }
        }
      }
    }
  }

  _findBuildSpot(engine, base, sizeTiles) {
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    const offsets = [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3]];
    for (const [ox, oy] of offsets) {
      const tx = bx + ox;
      const ty = by + oy;
      if (canPlaceAt(engine.buildings, tx, ty, sizeTiles, engine.map)) {
        return { x: tx, y: ty };
      }
    }
    for (let r = 4; r < 10; r++) {
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const tx = bx + ox;
        const ty = by + oy;
        if (canPlaceAt(engine.buildings, tx, ty, sizeTiles, engine.map)) {
          return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  _findDockSpot(engine, base) {
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    for (let r = 3; r < 25; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = bx + dx;
          const ty = by + dy;
          if (canPlaceDock(engine.buildings, tx, ty, engine.map)) {
            return { x: tx, y: ty };
          }
        }
      }
    }
    return null;
  }

  _findWaterNearEnemy(engine, enemyBuildings) {
    const targets = enemyBuildings.filter(b => b.hp > 0);
    if (targets.length === 0) return null;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const tx = Math.floor(target.x / TILE_SIZE);
    const ty = Math.floor(target.y / TILE_SIZE);
    for (let r = 1; r < 20; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (engine.map.isSwimmable(nx, ny)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  _findNearestMineral(unit, map) {
    let closest = null;
    let closestDist = Infinity;
    for (const [key, amount] of map.mineralAmounts) {
      if (amount <= 0) continue;
      const [mx, my] = key.split(',').map(Number);
      const wx = mx * TILE_SIZE + TILE_SIZE / 2;
      const wy = my * TILE_SIZE + TILE_SIZE / 2;
      const d = (unit.x - wx) ** 2 + (unit.y - wy) ** 2;
      if (d < closestDist) {
        closestDist = d;
        closest = { x: mx, y: my };
      }
    }
    return closest;
  }

  _findNearest(unit, targets) {
    let closest = null;
    let closestDist = Infinity;
    for (const t of targets) {
      if (t.hp <= 0) continue;
      const d = this._dist(unit, t);
      if (d < closestDist) {
        closestDist = d;
        closest = t;
      }
    }
    return closest;
  }

  _dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
}
