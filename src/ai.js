import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TILE_MINERAL, TILE_WATER } from './constants.js';
import { Building, BUILDING_DEFS } from './buildings.js';
import { Unit } from './units.js';

export class SimpleAI {
  constructor(team) {
    this.team = team;
    this.timer = 0;
    this.decisionInterval = 2;
    this.hasBuiltBarracks = false;
    this.hasBuiltFactory = false;
    this.hasBuiltDock = false;
    this.towerCount = 0;
    this.waveTimer = 0;
    this.waveInterval = 45;
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

    // 2b. Build factory after barracks
    if (this.hasBuiltBarracks && myFactories.length === 0 && !this.hasBuiltFactory &&
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
    if (this.hasBuiltBarracks && myTowers.length < 2 && res.minerals >= 50 && res.wood >= 50 && myWorkers.length > 0) {
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

    // 2d. Build dock near water
    if (this.hasBuiltBarracks && !this.hasBuiltDock && myDocks.length === 0 &&
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

    // 3. Train units
    for (const base of myBases) {
      if (myWorkers.length < 6 && base.canTrain('worker', res)) {
        game.spend(this.team, base.train('worker'));
      }
    }

    for (const barracks of myBarracks) {
      if (res.minerals >= 75) {
        if (myRockets.length < 2 && barracks.canTrain('rocket', res)) {
          game.spend(this.team, barracks.train('rocket'));
        } else if (barracks.canTrain('soldier', res)) {
          game.spend(this.team, barracks.train('soldier'));
        }
      }
    }

    for (const factory of myFactories) {
      if (res.minerals >= 150 && myTanks.length < 2 && factory.canTrain('tank', res)) {
        game.spend(this.team, factory.train('tank'));
      }
    }

    for (const dock of myDocks) {
      if (myShips.length < 2 && dock.canTrain('battleship', res)) {
        game.spend(this.team, dock.train('battleship'));
      }
    }

    // 4. Idle land combat units aggro nearby enemies
    for (const fighter of myLandFighters) {
      if (fighter.state === 'idle') {
        const nearEnemy = this._findNearest(fighter, enemyUnits.filter(u => !u.naval));
        if (nearEnemy && this._distance(fighter, nearEnemy) < TILE_SIZE * 10) {
          fighter.attackTarget(nearEnemy, game.map);
        }
      }
    }

    // 4b. Idle naval units patrol water near enemies
    for (const ship of myNavalFighters) {
      if (ship.state === 'idle') {
        const nearEnemy = this._findNearest(ship, enemyUnits);
        if (nearEnemy && this._distance(ship, nearEnemy) < TILE_SIZE * 10) {
          ship.attackTarget(nearEnemy, game.map);
        } else {
          // Move to water near an enemy base
          const waterSpot = this._findWaterNearEnemy(game, enemyBuildings);
          if (waterSpot) ship.moveTo(game.map, waterSpot.x, waterSpot.y);
        }
      }
    }

    // 5. Send attack wave periodically
    if (this.waveTimer >= this.waveInterval && myLandFighters.length >= 3) {
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
