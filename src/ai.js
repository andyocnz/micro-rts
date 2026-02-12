import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TILE_MINERAL, TILE_WATER } from './constants.js';
import { Building, BUILDING_DEFS } from './buildings.js';
import { Unit } from './units.js';

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

export class SimpleAI {
  constructor(team, difficulty = 'normal') {
    this.team = team;
    this.timer = 0;
    this.hasBuiltBarracks = false;
    this.hasBuiltFactory = false;
    this.hasBuiltDock = false;
    this.towerCount = 0;
    this.waveTimer = 0;

    const preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
    this.decisionInterval = preset.decisionInterval;
    this.waveInterval = preset.waveInterval;
    this.maxWorkers = preset.maxWorkers;
    this.maxRockets = preset.maxRockets;
    this.maxTanks = preset.maxTanks;
    this.maxShips = preset.maxShips;
    this.maxTowers = preset.maxTowers;
    this.waveMinFighters = preset.waveMinFighters;
    this.aggroRange = preset.aggroRange;
    this.buildsFactory = preset.buildsFactory;
    this.buildsDock = preset.buildsDock;
    this.startBonus = preset.startBonus;
  }

  setDifficulty(difficulty) {
    const preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
    this.decisionInterval = preset.decisionInterval;
    this.waveInterval = preset.waveInterval;
    this.maxWorkers = preset.maxWorkers;
    this.maxRockets = preset.maxRockets;
    this.maxTanks = preset.maxTanks;
    this.maxShips = preset.maxShips;
    this.maxTowers = preset.maxTowers;
    this.waveMinFighters = preset.waveMinFighters;
    this.aggroRange = preset.aggroRange;
    this.buildsFactory = preset.buildsFactory;
    this.buildsDock = preset.buildsDock;
  }

  update(dt, game) {
    this.timer += dt;
    this.waveTimer += dt;

    if (this.timer < this.decisionInterval) return;
    this.timer = 0;

    const myUnits = game.unitManager.getPlayerUnits(this.team);
    const myBuildings = game.buildingManager.getByTeam(this.team);
    const res = game.getResources(this.team);
    // All non-self teams are enemies
    const enemyUnits = game.unitManager.units.filter(u => u.team !== this.team);
    const enemyBuildings = game.buildingManager.buildings.filter(b => b.team !== this.team);

    const myWorkers = myUnits.filter(u => u.type === 'worker');
    const mySoldiers = myUnits.filter(u => u.type === 'soldier');
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
        const mineral = this._findNearestMineral(worker, game.map);
        if (mineral) {
          worker.gatherFrom(mineral.x, mineral.y, game.map, game.buildingManager.buildings);
        }
      }
    }

    // 2. Build barracks
    if (myBarracks.length === 0 && !this.hasBuiltBarracks && res.minerals >= 100 && myWorkers.length > 0) {
      const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
      if (builder && myBases.length > 0) {
        const spot = this._findBuildSpot(game, myBases[0], 2);
        if (spot) {
          const barracks = new Building(spot.x, spot.y, 'barracks', this.team);
          game.buildingManager.add(barracks);
          game.spend(this.team, BUILDING_DEFS.barracks.cost);
          builder.buildBuilding(barracks, game.map);
          this.hasBuiltBarracks = true;
        }
      }
    }

    // 2b. Build factory after barracks (if difficulty allows)
    if (this.buildsFactory && this.hasBuiltBarracks && myFactories.length === 0 && !this.hasBuiltFactory &&
        res.minerals >= 150 && res.wood >= 100 && myWorkers.length > 0) {
      const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
      if (builder && myBases.length > 0) {
        const spot = this._findBuildSpot(game, myBases[0], 2);
        if (spot) {
          const factory = new Building(spot.x, spot.y, 'factory', this.team);
          game.buildingManager.add(factory);
          game.spend(this.team, BUILDING_DEFS.factory.cost);
          builder.buildBuilding(factory, game.map);
          this.hasBuiltFactory = true;
        }
      }
    }

    // 2c. Build towers near base for defense
    const myTowers = myBuildings.filter(b => b.type === 'tower');
    if (this.hasBuiltBarracks && myTowers.length < this.maxTowers && res.minerals >= 50 && res.wood >= 50 && myWorkers.length > 0) {
      const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
      if (builder && myBases.length > 0) {
        const base = myBases[0];
        const offsets = [[-2, 0], [0, -2], [3, 0], [0, 3]];
        for (const [ox, oy] of offsets) {
          const tx = Math.floor(base.x / TILE_SIZE) + ox;
          const ty = Math.floor(base.y / TILE_SIZE) + oy;
          if (game.buildingManager.canPlaceAt(tx, ty, 1, game.map)) {
            const tower = new Building(tx, ty, 'tower', this.team);
            game.buildingManager.add(tower);
            game.spend(this.team, BUILDING_DEFS.tower.cost);
            builder.buildBuilding(tower, game.map);
            break;
          }
        }
      }
    }

    // 2d. Build dock near water (if difficulty allows)
    if (this.buildsDock && this.hasBuiltBarracks && !this.hasBuiltDock && myDocks.length === 0 &&
        res.minerals >= 120 && res.wood >= 80 && myWorkers.length > 0) {
      const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
      if (builder && myBases.length > 0) {
        const spot = this._findDockPlacement(game, myBases[0]);
        if (spot) {
          const dock = new Building(spot.x, spot.y, 'dock', this.team);
          game.buildingManager.add(dock);
          game.spend(this.team, BUILDING_DEFS.dock.cost);
          builder.buildBuilding(dock, game.map);
          this.hasBuiltDock = true;
        }
      }
    }

    // 3. Train units (caps based on difficulty)
    for (const base of myBases) {
      if (myWorkers.length < this.maxWorkers && base.canTrain('worker', res)) {
        game.spend(this.team, base.train('worker'));
      }
    }

    for (const barracks of myBarracks) {
      if (res.minerals >= 75) {
        if (myRockets.length < this.maxRockets && barracks.canTrain('rocket', res)) {
          game.spend(this.team, barracks.train('rocket'));
        } else if (barracks.canTrain('soldier', res)) {
          game.spend(this.team, barracks.train('soldier'));
        }
      }
    }

    for (const factory of myFactories) {
      if (res.minerals >= 150 && myTanks.length < this.maxTanks && factory.canTrain('tank', res)) {
        game.spend(this.team, factory.train('tank'));
      }
    }

    for (const dock of myDocks) {
      if (myShips.length < this.maxShips && dock.canTrain('battleship', res)) {
        game.spend(this.team, dock.train('battleship'));
      }
    }

    // 4. Idle land combat units aggro nearby enemies
    const aggroDist = TILE_SIZE * this.aggroRange;
    for (const fighter of myLandFighters) {
      if (fighter.state === 'idle') {
        const nearEnemy = this._findNearest(fighter, enemyUnits.filter(u => !u.naval));
        if (nearEnemy && this._distance(fighter, nearEnemy) < aggroDist) {
          fighter.attackTarget(nearEnemy, game.map);
        }
      }
    }

    // 4b. Idle naval units patrol water near enemies
    for (const ship of myNavalFighters) {
      if (ship.state === 'idle') {
        const nearEnemy = this._findNearest(ship, enemyUnits);
        if (nearEnemy && this._distance(ship, nearEnemy) < aggroDist) {
          ship.attackTarget(nearEnemy, game.map);
        } else {
          const waterSpot = this._findWaterNearEnemy(game, enemyBuildings);
          if (waterSpot) ship.moveTo(game.map, waterSpot.x, waterSpot.y);
        }
      }
    }

    // 5. Send attack wave periodically
    if (this.waveTimer >= this.waveInterval && myLandFighters.length >= this.waveMinFighters) {
      this.waveTimer = 0;
      const targets = [...enemyUnits.filter(u => !u.naval), ...enemyBuildings].filter(t => t.hp > 0);
      if (targets.length > 0) {
        const attackTarget = targets[Math.floor(Math.random() * targets.length)];
        for (const fighter of myLandFighters) {
          if (fighter.state === 'idle' || fighter.state === 'moving') {
            if (attackTarget.tileX !== undefined && attackTarget.sizeTiles !== undefined) {
              fighter.attackBuilding(attackTarget, game.map);
            } else {
              fighter.attackTarget(attackTarget, game.map);
            }
          }
        }
      }
    }
  }

  _findBuildSpot(game, base, sizeTiles) {
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    const offsets = [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3]];
    for (const [ox, oy] of offsets) {
      const tx = bx + ox;
      const ty = by + oy;
      if (game.buildingManager.canPlaceAt(tx, ty, sizeTiles, game.map)) {
        return { x: tx, y: ty };
      }
    }
    // Wider search
    for (let r = 4; r < 10; r++) {
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const tx = bx + ox;
        const ty = by + oy;
        if (game.buildingManager.canPlaceAt(tx, ty, sizeTiles, game.map)) {
          return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  _findDockPlacement(game, base) {
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    for (let r = 3; r < 25; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = bx + dx;
          const ty = by + dy;
          if (game.buildingManager.canPlaceDock(tx, ty, game.map)) {
            return { x: tx, y: ty };
          }
        }
      }
    }
    return null;
  }

  _findWaterNearEnemy(game, enemyBuildings) {
    const targets = enemyBuildings.filter(b => b.hp > 0);
    if (targets.length === 0) return null;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const tx = Math.floor(target.x / TILE_SIZE);
    const ty = Math.floor(target.y / TILE_SIZE);
    // Find nearest water tile to this building
    for (let r = 1; r < 20; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (game.map.isSwimmable(nx, ny)) {
            return { x: nx, y: ny };
          }
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
      const dx = unit.x - wx;
      const dy = unit.y - wy;
      const d = dx * dx + dy * dy;
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
      const d = this._distance(unit, t);
      if (d < closestDist) {
        closestDist = d;
        closest = t;
      }
    }
    return closest;
  }

  _distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
