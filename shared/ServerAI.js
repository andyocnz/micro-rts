import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TILE_MINERAL, BUILDING_DEFS } from './constants.js';
import { Building, canPlaceAt, canPlaceDock } from './building.js';

const DIFFICULTY_PRESETS = {
  easy: {
    decisionInterval: 2.5,
    waveInterval: 80,
    maxWorkers: 12,
    maxRockets: 3,
    maxTanks: 2,
    maxBombers: 1,
    maxShips: 2,
    maxTowers: 3,
    maxBarracks: 2,
    maxFactories: 1,
    maxDocks: 1,
    waveMinFighters: 6,
    aggroRange: 8,
    buildsFactory: true,
    buildsDock: false,
    startBonus: 0,
    waveStartDelay: 100,
    targetBaseCount: 1,
    expansionInterval: 10,
    squadSize: 8,
    retreatThreshold: 0,
    harassEnabled: false,
    adaptiveComp: false,
  },
  normal: {
    decisionInterval: 0.8,
    waveInterval: 28,
    maxWorkers: 22,
    maxRockets: 6,
    maxTanks: 6,
    maxBombers: 3,
    maxShips: 3,
    maxTowers: 6,
    maxBarracks: 4,
    maxFactories: 3,
    maxDocks: 1,
    waveMinFighters: 4,
    aggroRange: 12,
    buildsFactory: true,
    buildsDock: true,
    startBonus: 100,
    waveStartDelay: 45,
    targetBaseCount: 2,
    expansionInterval: 6,
    squadSize: 8,
    retreatThreshold: 0.3,
    harassEnabled: true,
    adaptiveComp: true,
  },
  hard: {
    decisionInterval: 0.25,
    waveInterval: 10,
    maxWorkers: 100,
    maxRockets: 50,
    maxTanks: 50,
    maxBombers: 50,
    maxShips: 8,
    maxTowers: 16,
    maxBarracks: 10,
    maxFactories: 8,
    maxDocks: 3,
    waveMinFighters: 3,
    aggroRange: 18,
    buildsFactory: true,
    buildsDock: true,
    startBonus: 800,
    waveStartDelay: 15,
    targetBaseCount: 5,
    expansionInterval: 2,
    squadSize: 12,
    retreatThreshold: 0.5,
    harassEnabled: true,
    adaptiveComp: true,
    greedyExpansion: true,
    minExpansionDist: 5,
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
    this.expansionTimer = 0;
    this.gameTime = 0;

    // Smart AI state
    this.squads = [];
    this.harassSquad = null;
    this.enemyComposition = {};

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
    this.expansionTimer += dt;
    this.gameTime += dt;
    if (this.timer < this.decisionInterval) return;
    this.timer = 0;

    const myUnits = engine.units.filter(u => u.team === this.team && u.hp > 0);
    const myBuildings = engine.buildings.filter(b => b.team === this.team && b.hp > 0);
    const res = engine.resources[this.team];
    if (!res) return;

    const enemyUnits = engine.units.filter(u => u.team !== this.team && u.hp > 0);
    const enemyBuildings = engine.buildings.filter(b => b.team !== this.team && b.hp > 0);

    const myWorkers = myUnits.filter(u => u.type === 'worker');
    const myLandFighters = myUnits.filter(u => u.type !== 'worker' && !u.naval);
    const myNavalFighters = myUnits.filter(u => u.naval);
    const myBases = myBuildings.filter(b => b.type === 'base' && b.built);
    const allMyBases = myBuildings.filter(b => b.type === 'base');
    const allMyBarracks = myBuildings.filter(b => b.type === 'barracks');
    const allMyFactories = myBuildings.filter(b => b.type === 'factory');
    const allMyDocks = myBuildings.filter(b => b.type === 'dock');
    const myBarracks = myBuildings.filter(b => b.type === 'barracks' && b.built);
    const myFactories = myBuildings.filter(b => b.type === 'factory' && b.built);
    const myDocks = myBuildings.filter(b => b.type === 'dock' && b.built);
    const myTowers = myBuildings.filter(b => b.type === 'tower');
    const enemyLandUnits = enemyUnits.filter(u => !u.naval);

    // Track enemy composition
    this._trackEnemyComposition(enemyUnits);

    // 1. Worker management
    this._manageWorkers(myWorkers, res, engine);

    // 2. Building
    this._manageBuilding(myWorkers, myBases, allMyBases, allMyBarracks, allMyFactories, allMyDocks, myBarracks, myTowers, res, engine);

    // 3. Training
    this._manageTraining(myUnits, myBases, myBarracks, myFactories, myDocks, myWorkers, res, engine);

    // 4. Defense
    this._defendBases(myLandFighters, enemyLandUnits, myBases, engine);

    // 4b. Allied protection
    if (engine.isHostile) {
      this._defendAllies(myLandFighters, enemyLandUnits, myBases, engine);
    }

    // 5. Squad combat
    const canAttack = this.gameTime >= this.waveStartDelay && myWorkers.length >= 3 && myBarracks.length > 0;
    if (!canAttack) this.waveTimer = 0;
    this._manageSquads(myLandFighters, enemyLandUnits, enemyBuildings, myBases, canAttack, engine);

    // 6. Harassment
    if (this.harassEnabled && canAttack) {
      this._manageHarass(myLandFighters, enemyUnits, enemyBuildings, myBases, engine);
    }

    // 7. Naval
    this._manageNaval(myNavalFighters, enemyUnits, enemyBuildings, engine);
  }

  _manageWorkers(myWorkers, res, engine) {
    for (const worker of myWorkers) {
      if (worker.state === 'idle' && worker.carrying === 0) {
        const needWood = res.wood < res.minerals * 0.5;
        let target = null;
        if (needWood) target = this._findNearestResource(worker, engine.map, 'wood');
        if (!target) target = this._findNearestMineral(worker, engine.map);
        if (!target && !needWood) target = this._findNearestResource(worker, engine.map, 'wood');
        if (target) worker.gatherFrom(target.x, target.y);
      }
    }
  }

  _manageBuilding(myWorkers, myBases, allMyBases, allMyBarracks, allMyFactories, allMyDocks, myBarracks, myTowers, res, engine) {
    const greedy = this.greedyExpansion;
    const enemyLand = engine.units.filter(u => u.team !== this.team && u.hp > 0 && !u.naval);
    const underAttack = this._countEnemiesNearBases(enemyLand, myBases, TILE_SIZE * 12) > 0;

    // Greedy: want 2 bases immediately, ramp to targetBaseCount quickly
    const desiredBases = greedy
      ? Math.min(this.targetBaseCount, 2 + Math.floor(this.gameTime / 30))
      : this._desiredCount(this.targetBaseCount, this.gameTime, 80);
    const desiredBarracks = this._desiredCount(this.maxBarracks, this.gameTime, greedy ? 20 : 60);
    const desiredFactories = this._desiredCount(this.maxFactories, this.gameTime, greedy ? 35 : 100);
    const desiredDocks = this._desiredCount(this.maxDocks, this.gameTime, greedy ? 50 : 130);
    const desiredTowers = Math.min(this.maxTowers, Math.max(underAttack ? 3 : 1, Math.floor(myBases.length * 1.5) + (underAttack ? 2 : 0)));

    const builder = myWorkers.find(w => w.state === 'idle' || w.state === 'gathering');
    let builtThisCycle = false;

    // Expansion - greedy AI expands as soon as they can afford it
    const expansionReady = this.expansionTimer >= this.expansionInterval ||
      (greedy && this.expansionTimer >= 1 && res.minerals >= 200);
    if (!builtThisCycle && expansionReady &&
        allMyBases.length < desiredBases && myWorkers.length >= (greedy ? 2 : 3) &&
        res.minerals >= BUILDING_DEFS.base.cost.minerals && res.wood >= BUILDING_DEFS.base.cost.wood) {
      if (builder) {
        const spot = this._findExpansionSpot(engine, myBases);
        if (spot) {
          const newBase = new Building(spot.x, spot.y, 'base', this.team);
          engine.buildings.push(newBase);
          engine.spend(this.team, BUILDING_DEFS.base.cost);
          builder.buildBuilding(newBase);
          this.expansionTimer = 0;
          builtThisCycle = true;
        }
      }
    }

    // Barracks
    if (!builtThisCycle && allMyBarracks.length < desiredBarracks &&
        res.minerals >= BUILDING_DEFS.barracks.cost.minerals && res.wood >= BUILDING_DEFS.barracks.cost.wood &&
        builder && myBases.length > 0) {
      const anchor = myBases[allMyBarracks.length % myBases.length];
      const spot = this._findBuildSpot(engine, anchor, BUILDING_DEFS.barracks.sizeTiles);
      if (spot) {
        const barracks = new Building(spot.x, spot.y, 'barracks', this.team);
        engine.buildings.push(barracks);
        engine.spend(this.team, BUILDING_DEFS.barracks.cost);
        builder.buildBuilding(barracks);
        this.hasBuiltBarracks = true;
        builtThisCycle = true;
      }
    }

    // Factory
    if (!builtThisCycle && this.buildsFactory && myBarracks.length > 0 &&
        allMyFactories.length < desiredFactories &&
        res.minerals >= BUILDING_DEFS.factory.cost.minerals && res.wood >= BUILDING_DEFS.factory.cost.wood &&
        builder && myBases.length > 0) {
      const anchor = myBases[allMyFactories.length % myBases.length];
      const spot = this._findBuildSpot(engine, anchor, BUILDING_DEFS.factory.sizeTiles);
      if (spot) {
        const factory = new Building(spot.x, spot.y, 'factory', this.team);
        engine.buildings.push(factory);
        engine.spend(this.team, BUILDING_DEFS.factory.cost);
        builder.buildBuilding(factory);
        this.hasBuiltFactory = true;
        builtThisCycle = true;
      }
    }

    // Dock
    if (!builtThisCycle && this.buildsDock && myBarracks.length > 0 &&
        allMyDocks.length < desiredDocks &&
        res.minerals >= BUILDING_DEFS.dock.cost.minerals && res.wood >= BUILDING_DEFS.dock.cost.wood &&
        builder && myBases.length > 0) {
      const anchor = myBases[allMyDocks.length % myBases.length];
      const spot = this._findDockSpot(engine, anchor);
      if (spot) {
        const dock = new Building(spot.x, spot.y, 'dock', this.team);
        engine.buildings.push(dock);
        engine.spend(this.team, BUILDING_DEFS.dock.cost);
        builder.buildBuilding(dock);
        this.hasBuiltDock = true;
        builtThisCycle = true;
      }
    }

    // Towers
    if (!builtThisCycle && myBarracks.length > 0 && myTowers.length < desiredTowers &&
        res.minerals >= BUILDING_DEFS.tower.cost.minerals && res.wood >= BUILDING_DEFS.tower.cost.wood &&
        builder && myBases.length > 0) {
      const base = myBases[myTowers.length % myBases.length];
      const bx = Math.floor(base.x / TILE_SIZE);
      const by = Math.floor(base.y / TILE_SIZE);
      const offsets = [[-2, 0], [0, -2], [3, 0], [0, 3], [2, 2], [-2, -2], [4, 0], [0, 4]];
      for (const [ox, oy] of offsets) {
        if (canPlaceAt(engine.buildings, bx + ox, by + oy, 1, engine.map)) {
          const tower = new Building(bx + ox, by + oy, 'tower', this.team);
          engine.buildings.push(tower);
          engine.spend(this.team, BUILDING_DEFS.tower.cost);
          builder.buildBuilding(tower);
          break;
        }
      }
    }
  }

  _manageTraining(myUnits, myBases, myBarracks, myFactories, myDocks, myWorkers, res, engine) {
    const greedy = this.greedyExpansion;
    const myRockets = myUnits.filter(u => u.type === 'rocket');
    const myTanks = myUnits.filter(u => u.type === 'tank');
    const myBombers = myUnits.filter(u => u.type === 'bomber');
    const myShips = myUnits.filter(u => u.type === 'battleship');
    const myLandFighters = myUnits.filter(u => u.type !== 'worker' && !u.naval);

    const workerPerBase = greedy ? 8 : 6;
    const desiredWorkers = Math.min(this.maxWorkers, Math.max(workerPerBase * Math.max(1, myBases.length), 4));
    const workerQueueMax = greedy ? 5 : 1;
    for (const base of myBases) {
      let queued = 0;
      while (myWorkers.length + queued < desiredWorkers && base.canTrain('worker', res) && queued < workerQueueMax) {
        engine.spend(this.team, base.train('worker'));
        queued++;
      }
    }

    let wantMoreRockets = myRockets.length < this.maxRockets;
    let wantMoreTanks = myTanks.length < this.maxTanks;
    let wantMoreBombers = myBombers.length < (this.maxBombers || 0);

    if (this.adaptiveComp) {
      const ec = this.enemyComposition;
      if ((ec.tank || 0) > (ec.soldier || 0)) wantMoreRockets = myRockets.length < Math.min(this.maxRockets, (ec.tank || 0) + 4);
      if ((ec.rocket || 0) > (ec.tank || 0)) wantMoreTanks = false;
      if ((ec.soldier || 0) + (ec.tank || 0) > 10) wantMoreBombers = myBombers.length < (this.maxBombers || 3);
    }

    const barracksQueueMax = greedy ? 5 : 1;
    const rocketTimeThreshold = greedy ? 40 : 100;
    for (const barracks of myBarracks) {
      let queued = 0;
      while (queued < barracksQueueMax && res.minerals >= 75) {
        if (wantMoreRockets && (myLandFighters.length > 4 || this.gameTime > rocketTimeThreshold) && barracks.canTrain('rocket', res)) {
          engine.spend(this.team, barracks.train('rocket'));
          queued++;
        } else if (barracks.canTrain('soldier', res)) {
          engine.spend(this.team, barracks.train('soldier'));
          queued++;
        } else {
          break;
        }
      }
    }

    const factoryQueueMax = greedy ? 4 : 1;
    for (const factory of myFactories) {
      let queued = 0;
      while (queued < factoryQueueMax) {
        if (wantMoreBombers && myBombers.length < (this.maxBombers || 0) && factory.canTrain('bomber', res)) {
          engine.spend(this.team, factory.train('bomber'));
          queued++;
        } else if (wantMoreTanks && factory.canTrain('tank', res)) {
          engine.spend(this.team, factory.train('tank'));
          queued++;
        } else {
          break;
        }
      }
    }

    const dockQueueMax = greedy ? 3 : 1;
    for (const dock of myDocks) {
      let queued = 0;
      while (myShips.length + queued < this.maxShips && dock.canTrain('battleship', res) && queued < dockQueueMax) {
        engine.spend(this.team, dock.train('battleship'));
        queued++;
      }
    }
  }

  _defendBases(myLandFighters, enemyLandUnits, myBases, engine) {
    if (enemyLandUnits.length === 0 || myBases.length === 0) return;
    const threatDist = TILE_SIZE * 12;
    const threatCount = this._countEnemiesNearBases(enemyLandUnits, myBases, threatDist);
    if (threatCount === 0) return;

    const defenseTarget = this._findNearestToAnyBase(enemyLandUnits, myBases);
    if (!defenseTarget) return;

    const defendersNeeded = Math.min(myLandFighters.length, Math.max(4, threatCount + 2));
    const sortedFighters = [...myLandFighters]
      .filter(f => f.state === 'idle' || f.state === 'moving')
      .sort((a, b) => this._dist(a, defenseTarget) - this._dist(b, defenseTarget));

    let assigned = 0;
    for (const fighter of sortedFighters) {
      if (assigned >= defendersNeeded) break;
      fighter.attackTarget(defenseTarget);
      assigned++;
    }
  }

  _defendAllies(myLandFighters, enemyLandUnits, myBases, engine) {
    if (enemyLandUnits.length === 0 || !engine.isHostile) return;
    const alliedBases = engine.buildings.filter(b =>
      b.type === 'base' && b.hp > 0 && b.built &&
      b.team !== this.team && !engine.isHostile(this.team, b.team)
    );
    if (alliedBases.length === 0) return;

    const allyThreatDist = TILE_SIZE * 14;
    let worstThreat = null, worstCount = 0;
    for (const ab of alliedBases) {
      let count = 0, nearest = null, nd = Infinity;
      for (const e of enemyLandUnits) {
        const d = this._dist(e, ab);
        if (d <= allyThreatDist) { count++; if (d < nd) { nd = d; nearest = e; } }
      }
      if (count > worstCount) { worstCount = count; worstThreat = nearest; }
    }
    if (!worstThreat) return;

    const ownThreatCount = this._countEnemiesNearBases(enemyLandUnits, myBases, TILE_SIZE * 12);
    if (ownThreatCount > worstCount) return;

    const idle = myLandFighters.filter(f => f.state === 'idle' || f.state === 'moving');
    const helpCount = Math.min(idle.length, Math.max(2, Math.floor(idle.length * 0.4)), worstCount + 3);
    const sorted = [...idle].sort((a, b) => this._dist(a, worstThreat) - this._dist(b, worstThreat));
    for (let i = 0; i < helpCount && i < sorted.length; i++) {
      sorted[i].attackTarget(worstThreat);
    }
  }

  _manageSquads(myLandFighters, enemyLandUnits, enemyBuildings, myBases, canAttack, engine) {
    // Clean up dead units
    for (const squad of this.squads) {
      squad.units = squad.units.filter(u => u.hp > 0 && u.team === this.team);
    }
    this.squads = this.squads.filter(s => s.units.length > 0);

    if (!canAttack) return;

    const assignedIds = new Set();
    for (const squad of this.squads) for (const u of squad.units) assignedIds.add(u.id);
    if (this.harassSquad) for (const u of this.harassSquad.units) assignedIds.add(u.id);

    const unassigned = myLandFighters.filter(u => !assignedIds.has(u.id) && (u.state === 'idle' || u.state === 'moving'));

    if (unassigned.length >= this.squadSize) {
      const squadUnits = unassigned.splice(0, this.squadSize);
      this.squads.push({ units: squadUnits, target: null, state: 'attack', initialSize: squadUnits.length });
    }

    for (const squad of this.squads) {
      if (squad.state === 'attack') {
        if (this.retreatThreshold > 0 && squad.units.length < squad.initialSize * (1 - this.retreatThreshold)) {
          squad.state = 'retreat';
          continue;
        }

        if (!squad.target || squad.target.hp <= 0) {
          squad.target = this._pickStrategicTarget(enemyLandUnits, enemyBuildings, myBases);
        }

        if (squad.target) {
          const focusTarget = this._pickFocusTarget(squad, enemyLandUnits);
          for (const u of squad.units) {
            if (u.state === 'idle' || u.state === 'moving') {
              const t = focusTarget || squad.target;
              if (t.tileX !== undefined && t.sizeTiles !== undefined) {
                u.attackBuilding(t);
              } else {
                u.attackTarget(t);
              }
            }
          }
        }
      }

      if (squad.state === 'retreat' && myBases.length > 0) {
        const base = myBases[0];
        const bx = Math.floor(base.x / TILE_SIZE);
        const by = Math.floor(base.y / TILE_SIZE);
        for (const u of squad.units) u.moveTo(engine.map, bx, by);
        if (squad.units.every(u => u.state === 'idle')) {
          squad.state = 'attack';
          squad.initialSize = squad.units.length;
        }
      }
    }

    if (this.waveTimer >= this.waveInterval && myLandFighters.length >= this.waveMinFighters) {
      this.waveTimer = 0;
      const nowUnassigned = myLandFighters.filter(u => !assignedIds.has(u.id) && (u.state === 'idle' || u.state === 'moving'));
      if (nowUnassigned.length > 0) {
        const target = this._pickStrategicTarget(enemyLandUnits, enemyBuildings, myBases);
        if (target) {
          const existing = this.squads.find(s => s.state === 'attack');
          if (existing) {
            for (const u of nowUnassigned) existing.units.push(u);
          } else {
            this.squads.push({ units: nowUnassigned, target, state: 'attack', initialSize: nowUnassigned.length });
          }
        }
      }
    }
  }

  _pickFocusTarget(squad, enemyUnits) {
    if (squad.units.length === 0) return null;
    const cx = squad.units.reduce((s, u) => s + u.x, 0) / squad.units.length;
    const cy = squad.units.reduce((s, u) => s + u.y, 0) / squad.units.length;
    const engageRange = TILE_SIZE * 8;
    let bestTarget = null;
    let bestScore = Infinity;
    for (const e of enemyUnits) {
      if (e.hp <= 0) continue;
      const dist = Math.sqrt((e.x - cx) ** 2 + (e.y - cy) ** 2);
      if (dist > engageRange) continue;
      const score = e.hp + dist * 0.5;
      if (score < bestScore) { bestScore = score; bestTarget = e; }
    }
    return bestTarget;
  }

  _manageHarass(myLandFighters, enemyUnits, enemyBuildings, myBases, engine) {
    if (this.harassSquad) {
      this.harassSquad.units = this.harassSquad.units.filter(u => u.hp > 0 && u.team === this.team);
      if (this.harassSquad.units.length === 0) this.harassSquad = null;
    }

    if (!this.harassSquad && myLandFighters.length >= 8) {
      const candidates = myLandFighters.filter(u => u.type === 'soldier' && u.state === 'idle').slice(0, 3);
      if (candidates.length >= 2) this.harassSquad = { units: candidates, retreating: false };
    }

    if (!this.harassSquad) return;
    const squad = this.harassSquad;

    const enemyWorkers = enemyUnits.filter(u => u.type === 'worker' && u.hp > 0);
    if (enemyWorkers.length > 0 && !squad.retreating) {
      const targetWorker = this._findNearestToAnyBase(enemyWorkers, enemyBuildings.filter(b => b.type === 'base' && b.hp > 0));
      if (targetWorker) {
        for (const u of squad.units) u.attackTarget(targetWorker);
      }
    }

    if (!squad.retreating) {
      const cx = squad.units.reduce((s, u) => s + u.x, 0) / squad.units.length;
      const cy = squad.units.reduce((s, u) => s + u.y, 0) / squad.units.length;
      const nearbyFighters = enemyUnits.filter(u => u.type !== 'worker' && u.hp > 0 &&
        Math.abs(u.x - cx) < TILE_SIZE * 8 && Math.abs(u.y - cy) < TILE_SIZE * 8);
      if (nearbyFighters.length > squad.units.length + 1) squad.retreating = true;
    }

    if (squad.retreating && myBases.length > 0) {
      const bx = Math.floor(myBases[0].x / TILE_SIZE);
      const by = Math.floor(myBases[0].y / TILE_SIZE);
      for (const u of squad.units) u.moveTo(engine.map, bx, by);
      if (squad.units.every(u => u.state === 'idle')) this.harassSquad = null;
    }
  }

  _manageNaval(myNavalFighters, enemyUnits, enemyBuildings, engine) {
    const aggroDist = TILE_SIZE * this.aggroRange;
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
  }

  _trackEnemyComposition(enemyUnits) {
    this.enemyComposition = {};
    for (const u of enemyUnits) {
      if (u.hp <= 0 || u.type === 'worker') continue;
      this.enemyComposition[u.type] = (this.enemyComposition[u.type] || 0) + 1;
    }
  }

  _pickStrategicTarget(enemyUnits, enemyBuildings, myBases) {
    const enemyBases = enemyBuildings.filter(b => b.type === 'base' && b.hp > 0);
    if (enemyBases.length > 0) return this._closestToMyBases(enemyBases, myBases);
    const production = enemyBuildings.filter(b => (b.type === 'barracks' || b.type === 'factory' || b.type === 'dock') && b.hp > 0);
    if (production.length > 0) return this._closestToMyBases(production, myBases);
    const landUnits = enemyUnits.filter(u => u.hp > 0 && !u.naval);
    if (landUnits.length > 0) return this._closestToMyBases(landUnits, myBases);
    const anything = [...enemyBuildings, ...enemyUnits].filter(t => t.hp > 0);
    return anything.length > 0 ? anything[Math.floor(Math.random() * anything.length)] : null;
  }

  _desiredCount(maxCount, gameTime, secondsPerStep) {
    if (maxCount <= 1) return maxCount;
    return Math.max(1, Math.min(maxCount, 1 + Math.floor(gameTime / secondsPerStep)));
  }

  _countEnemiesNearBases(enemyUnits, myBases, rangePx) {
    if (myBases.length === 0 || enemyUnits.length === 0) return 0;
    let count = 0;
    for (const e of enemyUnits) {
      for (const base of myBases) {
        if (this._dist(e, base) <= rangePx) { count++; break; }
      }
    }
    return count;
  }

  _findNearestToAnyBase(targets, bases) {
    let best = null, bestDist = Infinity;
    for (const t of targets) {
      if (t.hp <= 0) continue;
      for (const b of bases) {
        const d = this._dist(t, b);
        if (d < bestDist) { bestDist = d; best = t; }
      }
    }
    return best;
  }

  _closestToMyBases(targets, myBases) {
    if (targets.length === 0) return null;
    if (myBases.length === 0) return targets[0];
    let best = targets[0], bestDist = Infinity;
    for (const t of targets) {
      for (const b of myBases) {
        const d = this._dist(t, b);
        if (d < bestDist) { bestDist = d; best = t; }
      }
    }
    return best;
  }

  _findExpansionSpot(engine, myBases) {
    if (myBases.length === 0) return null;

    const allBases = engine.buildings.filter(b => b.type === 'base');
    const baseCenters = allBases.map(b => ({
      x: Math.floor(b.x / TILE_SIZE),
      y: Math.floor(b.y / TILE_SIZE),
    }));
    const sizeTiles = BUILDING_DEFS.base.sizeTiles;
    const minDist = this.minExpansionDist || 12;

    const myBaseCenters = myBases.map(b => ({
      x: Math.floor(b.x / TILE_SIZE),
      y: Math.floor(b.y / TILE_SIZE),
    }));

    const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);

    const sumNearbyRes = (resMap, cx, cy, radius) => {
      let sum = 0;
      const r2 = radius * radius;
      for (const [key, amount] of resMap) {
        if (amount <= 0) continue;
        const [rx, ry] = key.split(',').map(Number);
        if ((rx - cx) ** 2 + (ry - cy) ** 2 <= r2) sum += amount;
      }
      return sum;
    };

    // Scan outward from each base, find best buildable spot near resources
    for (const base of myBaseCenters) {
      let bestSpot = null;
      let bestScore = -Infinity;

      for (let r = minDist; r <= 50; r += 2) {
        for (let dy = -r; dy <= r; dy += 2) {
          for (let dx = -r; dx <= r; dx += 2) {
            if (Math.abs(dx) < r - 2 && Math.abs(dy) < r - 2) continue;
            const tx = base.x + dx;
            const ty = base.y + dy;
            if (tx < 2 || ty < 2 || tx >= MAP_WIDTH - 4 || ty >= MAP_HEIGHT - 4) continue;

            let tooClose = false;
            for (const bc of baseCenters) {
              if (dist(tx, ty, bc.x, bc.y) < minDist) { tooClose = true; break; }
            }
            if (tooClose) continue;
            if (!canPlaceAt(engine.buildings, tx, ty, sizeTiles, engine.map)) continue;

            const nearbyMinerals = sumNearbyRes(engine.map.mineralAmounts, tx, ty, 7);
            const nearbyWood = sumNearbyRes(engine.map.woodAmounts, tx, ty, 7);
            if (nearbyMinerals === 0 && nearbyWood === 0) continue;

            const score = nearbyMinerals * 2.0 + nearbyWood * 1.0;
            if (score > bestScore) { bestScore = score; bestSpot = { x: tx, y: ty }; }
          }
        }
        if (bestSpot) return bestSpot;
      }
    }

    // Fallback: find any buildable spot at increasing distance
    for (const base of myBaseCenters) {
      for (let r = minDist; r <= 60; r += 3) {
        const offsets = [
          [r, 0], [-r, 0], [0, r], [0, -r],
          [r, r], [-r, -r], [r, -r], [-r, r],
        ];
        for (const [ox, oy] of offsets) {
          const tx = base.x + ox;
          const ty = base.y + oy;
          if (tx < 2 || ty < 2 || tx >= MAP_WIDTH - 4 || ty >= MAP_HEIGHT - 4) continue;
          let tooClose = false;
          for (const bc of baseCenters) {
            if (dist(tx, ty, bc.x, bc.y) < minDist) { tooClose = true; break; }
          }
          if (tooClose) continue;
          if (canPlaceAt(engine.buildings, tx, ty, sizeTiles, engine.map)) return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  _findBuildSpot(engine, base, sizeTiles) {
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    const offsets = [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3], [5, 0], [0, 5]];
    for (const [ox, oy] of offsets) {
      if (canPlaceAt(engine.buildings, bx + ox, by + oy, sizeTiles, engine.map)) return { x: bx + ox, y: by + oy };
    }
    for (let r = 4; r < 15; r++) {
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
        if (canPlaceAt(engine.buildings, bx + ox, by + oy, sizeTiles, engine.map)) return { x: bx + ox, y: by + oy };
      }
    }
    return null;
  }

  _findDockSpot(engine, base) {
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    for (let r = 3; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (canPlaceDock(engine.buildings, bx + dx, by + dy, engine.map)) return { x: bx + dx, y: by + dy };
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
    for (let r = 1; r < 30; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (engine.map.isSwimmable(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
        }
      }
    }
    return null;
  }

  _findNearestMineral(unit, map) {
    let closest = null, closestDist = Infinity;
    for (const [key, amount] of map.mineralAmounts) {
      if (amount <= 0) continue;
      const [mx, my] = key.split(',').map(Number);
      const d = (unit.x - (mx * TILE_SIZE + TILE_SIZE / 2)) ** 2 + (unit.y - (my * TILE_SIZE + TILE_SIZE / 2)) ** 2;
      if (d < closestDist) { closestDist = d; closest = { x: mx, y: my }; }
    }
    return closest;
  }

  _findNearestResource(unit, map, type) {
    const amounts = type === 'wood' ? map.woodAmounts : map.mineralAmounts;
    let closest = null, closestDist = Infinity;
    for (const [key, amount] of amounts) {
      if (amount <= 0) continue;
      const [rx, ry] = key.split(',').map(Number);
      const d = (unit.x - (rx * TILE_SIZE + TILE_SIZE / 2)) ** 2 + (unit.y - (ry * TILE_SIZE + TILE_SIZE / 2)) ** 2;
      if (d < closestDist) { closestDist = d; closest = { x: rx, y: ry }; }
    }
    return closest;
  }

  _findNearest(unit, targets) {
    let closest = null, closestDist = Infinity;
    for (const t of targets) {
      if (t.hp <= 0) continue;
      const d = this._dist(unit, t);
      if (d < closestDist) { closestDist = d; closest = t; }
    }
    return closest;
  }

  _dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
}
