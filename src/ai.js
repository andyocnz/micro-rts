import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TILE_MINERAL, TILE_TREE } from './constants.js';
import { Building, BUILDING_DEFS } from './buildings.js';

const AI_DEBUG = (() => {
  if (typeof window === 'undefined') return false;
  const v = new URLSearchParams(window.location.search).get('debugai');
  return v === '1' || v === 'true';
})();

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
    workerPerBase: 5,
    waveMinFighters: 6,
    aggroRange: 8,
    buildsFactory: true,
    buildsDock: false,
    waveStartDelay: 100,
    minWorkersBeforeAttack: 4,
    targetBaseCount: 1,
    expansionInterval: 10,
    startBonus: 0,
    scoutInterval: 20,
    retreatThreshold: 0,
    harassEnabled: false,
    multiProngEnabled: false,
    adaptiveComp: false,
    squadSize: 8,
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
    workerPerBase: 6,
    waveMinFighters: 4,
    aggroRange: 12,
    buildsFactory: true,
    buildsDock: true,
    waveStartDelay: 45,
    minWorkersBeforeAttack: 5,
    targetBaseCount: 2,
    expansionInterval: 6,
    startBonus: 100,
    scoutInterval: 12,
    retreatThreshold: 0.3,
    harassEnabled: true,
    multiProngEnabled: false,
    adaptiveComp: true,
    squadSize: 8,
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
    workerPerBase: 8,
    waveMinFighters: 3,
    aggroRange: 18,
    buildsFactory: true,
    buildsDock: true,
    waveStartDelay: 15,
    minWorkersBeforeAttack: 3,
    targetBaseCount: 5,
    expansionInterval: 2,
    startBonus: 800,
    scoutInterval: 5,
    retreatThreshold: 0.5,
    harassEnabled: true,
    multiProngEnabled: true,
    adaptiveComp: true,
    squadSize: 12,
    greedyExpansion: true,
    minExpansionDist: 5,
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
    this.expansionTimer = 0;
    this.scoutTimer = 0;

    // Smart AI state
    this.squads = [];           // { units: [], target: null, state: 'rally'|'attack'|'retreat' }
    this.knownEnemyBases = [];  // [{x, y, team}]
    this.lastDefenseTime = 0;
    this.harassSquad = null;    // separate harass group
    this.enemyComposition = {}; // track what enemies build

    // Copycat mode: observe a target team and mirror their composition
    this.copycatTarget = null;  // team number to copy, null = disabled
    this.copycatMultiplier = 1.2; // build slightly more than the target
    this._copycatDesired = null; // filled by _copycatObserve when active

    this._applyPreset(DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal);
  }

  _applyPreset(preset) {
    Object.assign(this, preset);
  }

  setDifficulty(difficulty) {
    this._applyPreset(DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal);
  }

  update(dt, game) {
    this.timer += dt;
    this.waveTimer += dt;
    this.expansionTimer += dt;
    this.scoutTimer += dt;

    if (this.timer < this.decisionInterval) return;
    this.timer = 0;

    const myUnits = game.unitManager.getPlayerUnits(this.team);
    const myBuildings = game.buildingManager.getByTeam(this.team);
    const res = game.getResources(this.team);
    const enemyUnits = game.unitManager.units.filter(u => game.isHostile(this.team, u.team));
    const enemyBuildings = game.buildingManager.buildings.filter(b => game.isHostile(this.team, b.team));

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

    // Track enemy composition for adaptive counters
    this._trackEnemyComposition(enemyUnits);

    // 0. Copycat: observe target team and adjust our desired counts to mirror them
    if (this.copycatTarget !== null) {
      this._copycatObserve(game);
    }

    // 1. Building first so we do not keep yanking the same worker between gather/build in one cycle.
    this._manageBuilding(myWorkers, myBases, allMyBases, allMyBarracks, allMyFactories, allMyDocks, myBarracks, myTowers, res, game);

    // 2. Worker management (including stuck-carry recovery)
    this._manageWorkers(myWorkers, myBases, game);

    // 3. Scouting
    this._manageScouting(myLandFighters, enemyBuildings, game);

    // 4. Training with adaptive composition
    this._manageTraining(myUnits, myBases, myBarracks, myFactories, myDocks, myWorkers, res, game);

    // 5. Squad management + combat
    // Skip combat commands while thawing (units are spreading out after unfreeze)
    const thawing = game._thawCooldown > 0;
    const canAttack = !thawing && game.gameTime >= this.waveStartDelay && myWorkers.length >= this.minWorkersBeforeAttack && myBarracks.length > 0;
    if (!canAttack) this.waveTimer = 0;

    if (!thawing) {
      this._defendBases(myLandFighters, enemyLandUnits, myBases, game);

      // 5b. Allied protection: defend allied AI bases under attack
      this._defendAllies(myLandFighters, enemyLandUnits, myBases, game);
    }

    this._manageSquads(myLandFighters, enemyLandUnits, enemyBuildings, myBases, canAttack, game);

    // 6. Harassment
    if (this.harassEnabled && canAttack) {
      this._manageHarass(myLandFighters, enemyUnits, enemyBuildings, myBases, game);
    }

    // 7. Naval
    if (!thawing) {
      this._manageNaval(myNavalFighters, enemyUnits, enemyBuildings, game);
    }
  }

  // ── Worker Management ──

  _manageWorkers(myWorkers, myBases, game) {
    const reservations = new Map();
    const baseStats = new Map();

    for (const base of myBases) {
      baseStats.set(base, {
        total: 0,
        minerals: 0,
        wood: 0,
        desiredTotal: 10,
        desiredMinerals: 5,
        desiredWood: 5,
      });
    }

    for (const w of myWorkers) {
      if (w.gatherTarget && (w.state === 'gathering' || w.state === 'returning')) {
        const key = `${w.gatherTarget.x},${w.gatherTarget.y}`;
        reservations.set(key, (reservations.get(key) || 0) + 1);
        const base = this._findClosestBaseByTile(w.gatherTarget.x, w.gatherTarget.y, myBases);
        if (base && baseStats.has(base)) {
          const s = baseStats.get(base);
          s.total += 1;
          const tile = game.map.getTile(w.gatherTarget.x, w.gatherTarget.y);
          if (tile === TILE_MINERAL) s.minerals += 1;
          if (tile === TILE_TREE) s.wood += 1;
        }
      }
    }

    for (const worker of myWorkers) {
      // Recovery: workers can become idle while still carrying resources after interrupted tasks.
      if (worker.state === 'idle' && worker.carrying > 0) {
        worker.state = 'returning';
        if (typeof worker._returnToBase === 'function') {
          worker._returnToBase(game.map, game.buildingManager.buildings);
        }
        continue;
      }

      if (worker.state === 'idle' && worker.carrying === 0) {
        const anchorBase = this._pickEconomyAnchorBase(worker, myBases, baseStats);
        let needWood = false;
        if (anchorBase && baseStats.has(anchorBase)) {
          const s = baseStats.get(anchorBase);
          if (s.total < s.desiredTotal) {
            needWood = s.wood < s.desiredWood;
          } else {
            needWood = s.wood < s.minerals;
          }
        } else {
          const res = game.getResources(this.team);
          needWood = res.wood < res.minerals * 0.6;
        }

        const target = this._chooseWorkerResourceTarget(worker, game.map, reservations, needWood, anchorBase);
        if (target) {
          worker.gatherFrom(target.x, target.y, game.map, game.buildingManager.buildings);
          const key = `${target.x},${target.y}`;
          reservations.set(key, (reservations.get(key) || 0) + 1);
          if (anchorBase && baseStats.has(anchorBase)) {
            const s = baseStats.get(anchorBase);
            s.total += 1;
            const tile = game.map.getTile(target.x, target.y);
            if (tile === TILE_MINERAL) s.minerals += 1;
            if (tile === TILE_TREE) s.wood += 1;
          }
        }
      }
    }
  }

  _chooseWorkerResourceTarget(worker, map, reservations, preferWood, anchorBase = null) {
    const orderedTypes = preferWood ? ['wood', 'minerals'] : ['minerals', 'wood'];
    const anchorX = anchorBase ? Math.floor(anchorBase.x / TILE_SIZE) : null;
    const anchorY = anchorBase ? Math.floor(anchorBase.y / TILE_SIZE) : null;
    for (const type of orderedTypes) {
      const amounts = type === 'wood' ? map.woodAmounts : map.mineralAmounts;
      const cap = type === 'wood' ? 2 : 3;
      const maxAnchorDist = 30;
      let best = null;
      let bestScore = Infinity;
      for (const [key, amount] of amounts) {
        if (amount <= 0) continue;
        const [rx, ry] = key.split(',').map(Number);
        const wx = rx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ry * TILE_SIZE + TILE_SIZE / 2;
        const dx = worker.x - wx;
        const dy = worker.y - wy;
        const dist2 = dx * dx + dy * dy;
        const assigned = reservations.get(key) || 0;
        if (assigned >= cap) continue;
        let anchorPenalty = 0;
        if (anchorBase) {
          const adx = rx - anchorX;
          const ady = ry - anchorY;
          const aDist = Math.sqrt(adx * adx + ady * ady);
          if (aDist > maxAnchorDist) continue;
          anchorPenalty = aDist * aDist * 120;
        }
        // Spread workers across nearby nodes instead of all picking one.
        const score = dist2 + assigned * 70000 + anchorPenalty;
        if (score < bestScore) {
          bestScore = score;
          best = { x: rx, y: ry };
        }
      }
      // Fallback if every node is at/over cap.
      if (!best) {
        for (const [key, amount] of amounts) {
          if (amount <= 0) continue;
          const [rx, ry] = key.split(',').map(Number);
          const wx = rx * TILE_SIZE + TILE_SIZE / 2;
          const wy = ry * TILE_SIZE + TILE_SIZE / 2;
          const dx = worker.x - wx;
          const dy = worker.y - wy;
          const dist2 = dx * dx + dy * dy;
          const assigned = reservations.get(key) || 0;
          let anchorPenalty = 0;
          if (anchorBase) {
            const adx = rx - anchorX;
            const ady = ry - anchorY;
            const aDist = Math.sqrt(adx * adx + ady * ady);
            anchorPenalty = aDist * aDist * 120;
          }
          const score = dist2 + assigned * 70000 + anchorPenalty;
          if (score < bestScore) {
            bestScore = score;
            best = { x: rx, y: ry };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // ── Scouting ──

  _manageScouting(myFighters, enemyBuildings, game) {
    if (this.scoutTimer < this.scoutInterval) return;
    this.scoutTimer = 0;

    // Update known enemy bases
    for (const b of enemyBuildings) {
      if (b.type !== 'base' || b.hp <= 0) continue;
      const bx = Math.floor(b.x / TILE_SIZE);
      const by = Math.floor(b.y / TILE_SIZE);
      const existing = this.knownEnemyBases.find(k => Math.abs(k.x - bx) < 5 && Math.abs(k.y - by) < 5);
      if (!existing) {
        this.knownEnemyBases.push({ x: bx, y: by, team: b.team });
      }
    }

    // Send an idle fighter to scout unexplored areas
    const scout = myFighters.find(f => f.state === 'idle');
    if (!scout) return;

    // Pick a random unexplored quadrant direction
    const scoutTargets = [
      { x: MAP_WIDTH * 0.25, y: MAP_HEIGHT * 0.25 },
      { x: MAP_WIDTH * 0.75, y: MAP_HEIGHT * 0.25 },
      { x: MAP_WIDTH * 0.25, y: MAP_HEIGHT * 0.75 },
      { x: MAP_WIDTH * 0.75, y: MAP_HEIGHT * 0.75 },
      { x: MAP_WIDTH * 0.5, y: MAP_HEIGHT * 0.5 },
      { x: MAP_WIDTH * 0.5, y: MAP_HEIGHT * 0.25 },
      { x: MAP_WIDTH * 0.25, y: MAP_HEIGHT * 0.5 },
      { x: MAP_WIDTH * 0.75, y: MAP_HEIGHT * 0.5 },
      { x: MAP_WIDTH * 0.5, y: MAP_HEIGHT * 0.75 },
    ];

    // Pick the target farthest from any known enemy base
    let bestTarget = scoutTargets[Math.floor(Math.random() * scoutTargets.length)];
    if (this.knownEnemyBases.length < 3) {
      let bestDist = -1;
      for (const t of scoutTargets) {
        let minDist = Infinity;
        for (const kb of this.knownEnemyBases) {
          minDist = Math.min(minDist, this._distanceTiles(t.x, t.y, kb.x, kb.y));
        }
        // Also distance from own position
        const sx = Math.floor(scout.x / TILE_SIZE);
        const sy = Math.floor(scout.y / TILE_SIZE);
        const selfDist = this._distanceTiles(t.x, t.y, sx, sy);
        if (selfDist > 10 && minDist > bestDist) {
          bestDist = minDist;
          bestTarget = t;
        }
      }
    }

    const tx = Math.max(1, Math.min(MAP_WIDTH - 2, Math.floor(bestTarget.x)));
    const ty = Math.max(1, Math.min(MAP_HEIGHT - 2, Math.floor(bestTarget.y)));
    scout.moveTo(game.map, tx, ty);
  }

  // ── Building Construction ──

  _manageBuilding(myWorkers, myBases, allMyBases, allMyBarracks, allMyFactories, allMyDocks, myBarracks, myTowers, res, game) {
    const scaling = this._getScalingCaps(game.gameTime, myBases.length);
    const underAttack = this._countEnemiesNearBases(
      game.unitManager.units.filter(u => game.isHostile(this.team, u.team) && !u.naval),
      myBases, TILE_SIZE * 12
    ) > 0;

    const greedy = this.greedyExpansion;
    // Greedy: want 2 bases immediately, ramp to targetBaseCount quickly
    const desiredBases = greedy
      ? Math.min(this.targetBaseCount, 2 + Math.floor(game.gameTime / 30))
      : Math.max(this._desiredCount(this.targetBaseCount, game.gameTime, 55), scaling.maxBases);
    const desiredBarracks = Math.max(this._desiredCount(this.maxBarracks, game.gameTime, greedy ? 20 : 45), scaling.maxBarracks);
    const desiredFactories = Math.max(this._desiredCount(this.maxFactories, game.gameTime, greedy ? 35 : 85), scaling.maxFactories);
    const desiredDocks = Math.max(this._desiredCount(this.maxDocks, game.gameTime, greedy ? 50 : 110), scaling.maxDocks);
    const desiredTowers = Math.min(
      scaling.maxTowers,
      Math.max(underAttack ? 3 : 1, Math.floor(myBases.length * 1.5) + (underAttack ? 2 : 0))
    );

    const availableBuilders = myWorkers.filter(w => w.state === 'idle' || w.state === 'gathering');
    // Greedy AI spends aggressively; normal AI reserves for military queues.
    const reserveScale = greedy ? 0.3 : 1;
    const reserveMinerals = Math.min(
      greedy ? 400 : 1400,
      (myBarracks.length * 95 +
      allMyFactories.length * 150 +
      allMyDocks.length * 200 +
      myBases.length * 50) * reserveScale
    );
    const reserveWood = Math.min(
      greedy ? 200 : 700,
      (myBarracks.length * 30 +
      allMyFactories.length * 50 +
      allMyDocks.length * 100 +
      myBases.length * 10) * reserveScale
    );
    const maxBuildActions = Math.min(
      greedy ? 6 : 3,
      Math.max(1, availableBuilders.length),
      1 + Math.floor((res.minerals + res.wood) / (greedy ? 300 : 550))
    );
    let buildActions = 0;
    let plannedBases = allMyBases.length;
    let plannedBarracks = allMyBarracks.length;
    let plannedFactories = allMyFactories.length;
    let plannedDocks = allMyDocks.length;
    let plannedTowers = myTowers.length;

    const takeBuilder = () => availableBuilders.shift() || null;
    const canSpend = (cost) => (
      (res.minerals - (cost.minerals || 0)) >= reserveMinerals &&
      (res.wood - (cost.wood || 0)) >= reserveWood
    );
    const canSpendEmergency = (cost) => (
      res.minerals >= (cost.minerals || 0) &&
      res.wood >= (cost.wood || 0)
    );

    // Expansion (prioritize on bigger map)
    // Greedy AI: expand as soon as they can afford it
    const expansionReady = this.expansionTimer >= this.expansionInterval ||
      (greedy && this.expansionTimer >= 1 && res.minerals >= 200);
    if (plannedBases < desiredBases && game.gameTime > 10) {
      // Log expansion state periodically for diagnostics
      if (Math.floor(game.gameTime * 4) % 40 === 0) {
        console.log(`[AI ${this.team}] expand check: desired=${desiredBases} planned=${plannedBases} ready=${expansionReady} workers=${myWorkers.length} min=${res.minerals} wood=${res.wood}`);
      }
    }
    while (buildActions < maxBuildActions &&
        expansionReady &&
        plannedBases < desiredBases &&
        myWorkers.length >= (greedy ? 2 : Math.max(3, this.workerPerBase)) &&
        canSpendEmergency(BUILDING_DEFS.base.cost)) {
      const builder = takeBuilder();
      if (builder) {
        const spot = this._findExpansionSpot(game, myBases);
        if (spot) {
          const newBase = new Building(spot.x, spot.y, 'base', this.team);
          game.buildingManager.add(newBase);
          game.spend(this.team, BUILDING_DEFS.base.cost);
          builder.buildBuilding(newBase, game.map);
          this.expansionTimer = 0;
          plannedBases++;
          buildActions++;
          console.log(`[AI ${this.team}] EXPAND base at (${spot.x},${spot.y}) t=${Math.floor(game.gameTime)}s`);
        } else {
          console.warn(`[AI ${this.team}] expansion FAILED: no valid spot found t=${Math.floor(game.gameTime)}s`);
          break;
        }
      } else {
        console.warn(`[AI ${this.team}] expansion delayed: no builder available`);
        break;
      }
    }

    // Bootstrap production chain step-by-step so AI does not stall on one building type.
    if (buildActions < maxBuildActions && plannedBarracks === 0 && myBases.length > 0 && canSpendEmergency(BUILDING_DEFS.barracks.cost)) {
      const builder = takeBuilder();
      if (builder) {
        const anchor = myBases[0];
        const spot = this._findBuildSpot(game, anchor, BUILDING_DEFS.barracks.sizeTiles);
        if (spot) {
          const barracks = new Building(spot.x, spot.y, 'barracks', this.team);
          game.buildingManager.add(barracks);
          game.spend(this.team, BUILDING_DEFS.barracks.cost);
          builder.buildBuilding(barracks, game.map);
          this.hasBuiltBarracks = true;
          plannedBarracks++;
          buildActions++;
        }
      }
    }
    if (buildActions < maxBuildActions && this.buildsFactory && plannedFactories === 0 && plannedBarracks > 0 &&
        myBases.length > 0 && canSpendEmergency(BUILDING_DEFS.factory.cost)) {
      const builder = takeBuilder();
      if (builder) {
        const anchor = myBases[0];
        const spot = this._findBuildSpot(game, anchor, BUILDING_DEFS.factory.sizeTiles);
        if (spot) {
          const factory = new Building(spot.x, spot.y, 'factory', this.team);
          game.buildingManager.add(factory);
          game.spend(this.team, BUILDING_DEFS.factory.cost);
          builder.buildBuilding(factory, game.map);
          this.hasBuiltFactory = true;
          plannedFactories++;
          buildActions++;
        }
      }
    }
    if (buildActions < maxBuildActions && this.buildsDock && plannedDocks === 0 && plannedFactories > 0 &&
        myBases.length > 0 && canSpendEmergency(BUILDING_DEFS.dock.cost)) {
      const builder = takeBuilder();
      if (builder) {
        const anchor = myBases[0];
        const spot = this._findDockPlacement(game, anchor);
        if (spot) {
          const dock = new Building(spot.x, spot.y, 'dock', this.team);
          game.buildingManager.add(dock);
          game.spend(this.team, BUILDING_DEFS.dock.cost);
          builder.buildBuilding(dock, game.map);
          this.hasBuiltDock = true;
          plannedDocks++;
          buildActions++;
        }
      }
    }

    // Barracks
    while (buildActions < maxBuildActions &&
        plannedBarracks < desiredBarracks &&
        canSpend(BUILDING_DEFS.barracks.cost) &&
        myBases.length > 0) {
      const builder = takeBuilder();
      if (!builder) break;
      const anchor = myBases[plannedBarracks % myBases.length];
      const spot = this._findBuildSpot(game, anchor, BUILDING_DEFS.barracks.sizeTiles);
      if (spot) {
        const barracks = new Building(spot.x, spot.y, 'barracks', this.team);
        game.buildingManager.add(barracks);
        game.spend(this.team, BUILDING_DEFS.barracks.cost);
        builder.buildBuilding(barracks, game.map);
        this.hasBuiltBarracks = true;
        plannedBarracks++;
        buildActions++;
        if (AI_DEBUG) console.log(`[AI ${this.team}] build barracks at (${spot.x},${spot.y})`);
      }
    }

    // Factory
    while (buildActions < maxBuildActions && this.buildsFactory && myBarracks.length > 0 &&
        plannedFactories < desiredFactories &&
        canSpend(BUILDING_DEFS.factory.cost) &&
        myBases.length > 0) {
      const builder = takeBuilder();
      if (!builder) break;
      const anchor = myBases[plannedFactories % myBases.length];
      const spot = this._findBuildSpot(game, anchor, BUILDING_DEFS.factory.sizeTiles);
      if (spot) {
        const factory = new Building(spot.x, spot.y, 'factory', this.team);
        game.buildingManager.add(factory);
        game.spend(this.team, BUILDING_DEFS.factory.cost);
        builder.buildBuilding(factory, game.map);
        this.hasBuiltFactory = true;
        plannedFactories++;
        buildActions++;
        if (AI_DEBUG) console.log(`[AI ${this.team}] build factory at (${spot.x},${spot.y})`);
      }
    }

    // Dock
    while (buildActions < maxBuildActions && this.buildsDock && myBarracks.length > 0 &&
        plannedDocks < desiredDocks &&
        canSpend(BUILDING_DEFS.dock.cost) &&
        myBases.length > 0) {
      const builder = takeBuilder();
      if (!builder) break;
      const anchor = myBases[plannedDocks % myBases.length];
      const spot = this._findDockPlacement(game, anchor);
      if (spot) {
        const dock = new Building(spot.x, spot.y, 'dock', this.team);
        game.buildingManager.add(dock);
        game.spend(this.team, BUILDING_DEFS.dock.cost);
        builder.buildBuilding(dock, game.map);
        this.hasBuiltDock = true;
        plannedDocks++;
        buildActions++;
        if (AI_DEBUG) console.log(`[AI ${this.team}] build dock at (${spot.x},${spot.y})`);
      }
    }

    // Towers
    while (buildActions < maxBuildActions && myBarracks.length > 0 && plannedTowers < desiredTowers &&
        canSpend(BUILDING_DEFS.tower.cost) &&
        myBases.length > 0) {
      const builder = takeBuilder();
      if (!builder) break;
      const base = myBases[plannedTowers % myBases.length];
      const offsets = [[-2, 0], [0, -2], [3, 0], [0, 3], [2, 2], [-2, -2], [4, 0], [0, 4], [-3, 3], [3, -3]];
      for (const [ox, oy] of offsets) {
        const tx = Math.floor(base.x / TILE_SIZE) + ox;
        const ty = Math.floor(base.y / TILE_SIZE) + oy;
        if (game.buildingManager.canPlaceAt(tx, ty, 1, game.map)) {
          const tower = new Building(tx, ty, 'tower', this.team);
          game.buildingManager.add(tower);
          game.spend(this.team, BUILDING_DEFS.tower.cost);
          builder.buildBuilding(tower, game.map);
          plannedTowers++;
          buildActions++;
          if (AI_DEBUG) console.log(`[AI ${this.team}] build tower at (${tx},${ty})`);
          break;
        }
      }
    }
  }

  // ── Training with Adaptive Composition ──

  _manageTraining(myUnits, myBases, myBarracks, myFactories, myDocks, myWorkers, res, game) {
    const scaling = this._getScalingCaps(game.gameTime, myBases.length);
    const greedy = this.greedyExpansion;
    const mySoldiers = myUnits.filter(u => u.type === 'soldier');
    const myRockets = myUnits.filter(u => u.type === 'rocket');
    const myTanks = myUnits.filter(u => u.type === 'tank');
    const myBombers = myUnits.filter(u => u.type === 'bomber');
    const myShips = myUnits.filter(u => u.type === 'battleship');
    const myLandFighters = myUnits.filter(u => u.type !== 'worker' && !u.naval);

    // Copycat mode: use mirrored desired counts if available
    const cc = this._copycatDesired;

    // Workers - greedy AI always wants more workers to fuel its economy
    const desiredWorkers = cc
      ? cc.workers
      : Math.min(
        scaling.maxWorkers,
        Math.max(10 * Math.max(1, myBases.length), this.workerPerBase * Math.max(1, myBases.length), this.minWorkersBeforeAttack + 1)
      );
    const workerQueueMax = greedy ? 5 : 3;
    for (const base of myBases) {
      let queued = 0;
      while (myWorkers.length + queued < desiredWorkers && base.canTrain('worker', res) && queued < workerQueueMax) {
        game.spend(this.team, base.train('worker'));
        queued++;
      }
    }

    // Decide unit composition using planned counts (so queueing doesn't lock into one type).
    let wantMoreRockets, wantMoreTanks, wantMoreBombers, wantMoreSoldiers;
    let plannedSoldiers = mySoldiers.length;
    let plannedRockets = myRockets.length;
    let plannedTanks = myTanks.length;
    let plannedBombers = myBombers.length;
    const baselineSoldiers = 10 + myBases.length * 3;
    const baselineRockets = 4 + myBases.length * 2 + Math.floor(game.gameTime / 140);
    const baselineTanks = 3 + Math.floor(myBases.length * 1.5) + Math.floor(game.gameTime / 180);
    const baselineBombers = 2 + Math.floor(myBases.length / 2) + Math.floor(game.gameTime / 220);
    const desiredSoldiers = cc ? Math.max(cc.soldiers || 0, baselineSoldiers) : baselineSoldiers;
    const desiredRockets = cc ? Math.max(cc.rockets || 0, baselineRockets) : scaling.maxRockets;
    const desiredTanks = cc ? Math.max(cc.tanks || 0, baselineTanks) : scaling.maxTanks;
    const desiredBombers = cc ? Math.max(cc.bombers || 0, baselineBombers) : scaling.maxBombers;

    if (cc) {
      // Copycat mode: mirror player's army composition
      wantMoreSoldiers = mySoldiers.length < desiredSoldiers;
      wantMoreRockets = myRockets.length < desiredRockets;
      wantMoreTanks = myTanks.length < desiredTanks;
      wantMoreBombers = myBombers.length < desiredBombers;
    } else {
      wantMoreSoldiers = true; // always want soldiers as baseline
      wantMoreRockets = myRockets.length < desiredRockets;
      wantMoreTanks = myTanks.length < desiredTanks;
      wantMoreBombers = myBombers.length < desiredBombers;

      if (this.adaptiveComp) {
        const ec = this.enemyComposition;
        const enemyTanks = (ec.tank || 0);
        const enemyRockets = (ec.rocket || 0);
        const enemySoldiers = (ec.soldier || 0);

        if (enemyTanks > enemySoldiers) {
          wantMoreRockets = myRockets.length < Math.min(scaling.maxRockets, enemyTanks + 4);
        }
        if (enemyRockets > enemyTanks) {
          wantMoreTanks = false;
        }
        if (enemySoldiers + enemyTanks > 10) {
          wantMoreBombers = myBombers.length < Math.max(1, scaling.maxBombers);
        }
      }
    }

    // Barracks training: choose by deficit/ratio each queue slot to keep mix.
    const barracksQueueMax = greedy ? 5 : 3;
    const rocketTimeThreshold = greedy ? 40 : 100;
    for (const barracks of myBarracks) {
      let queued = 0;
      while (queued < barracksQueueMax) {
        if (cc) {
          const soldierDeficit = Math.max(0, desiredSoldiers - plannedSoldiers);
          const rocketDeficit = Math.max(0, desiredRockets - plannedRockets);
          const pickRocket = rocketDeficit > soldierDeficit;

          if (pickRocket && barracks.canTrain('rocket', res)) {
            game.spend(this.team, barracks.train('rocket'));
            plannedRockets++;
            queued++;
          } else if (barracks.canTrain('soldier', res)) {
            game.spend(this.team, barracks.train('soldier'));
            plannedSoldiers++;
            queued++;
          } else if (barracks.canTrain('rocket', res)) {
            game.spend(this.team, barracks.train('rocket'));
            plannedRockets++;
            queued++;
          } else break;
        } else {
          const barracksTotal = Math.max(1, plannedSoldiers + plannedRockets);
          const desiredRocketShare = game.gameTime > 140 ? 0.4 : (game.gameTime > 90 ? 0.33 : 0.22);
          const currentRocketShare = plannedRockets / barracksTotal;
          const shouldPreferRocket =
            wantMoreRockets &&
            (myLandFighters.length > 4 || game.gameTime > rocketTimeThreshold) &&
            currentRocketShare < desiredRocketShare;

          if (shouldPreferRocket && barracks.canTrain('rocket', res)) {
            game.spend(this.team, barracks.train('rocket'));
            plannedRockets++;
            queued++;
          } else if (barracks.canTrain('soldier', res)) {
            game.spend(this.team, barracks.train('soldier'));
            plannedSoldiers++;
            queued++;
          } else if (wantMoreRockets && barracks.canTrain('rocket', res)) {
            game.spend(this.team, barracks.train('rocket'));
            plannedRockets++;
            queued++;
          } else break;
        }
      }
    }

    // Factory training: choose by deficit/ratio each queue slot to keep mix.
    const factoryQueueMax = greedy ? 4 : 2;
    for (const factory of myFactories) {
      let queued = 0;
      while (queued < factoryQueueMax) {
        if (cc) {
          const tankDeficit = Math.max(0, desiredTanks - plannedTanks);
          const bomberDeficit = Math.max(0, desiredBombers - plannedBombers);
          const pickBomber = bomberDeficit > tankDeficit;

          if (pickBomber && factory.canTrain('bomber', res)) {
            game.spend(this.team, factory.train('bomber'));
            plannedBombers++;
            queued++;
          } else if (factory.canTrain('tank', res)) {
            game.spend(this.team, factory.train('tank'));
            plannedTanks++;
            queued++;
          } else if (factory.canTrain('bomber', res)) {
            game.spend(this.team, factory.train('bomber'));
            plannedBombers++;
            queued++;
          } else break;
        } else {
          const factoryTotal = Math.max(1, plannedTanks + plannedBombers);
          const desiredBomberShare = this.adaptiveComp ? 0.35 : 0.25;
          const currentBomberShare = plannedBombers / factoryTotal;
          const shouldPreferBomber =
            wantMoreBombers &&
            plannedBombers < scaling.maxBombers &&
            currentBomberShare < desiredBomberShare;

          if (shouldPreferBomber && factory.canTrain('bomber', res)) {
            game.spend(this.team, factory.train('bomber'));
            plannedBombers++;
            queued++;
          } else if (wantMoreTanks && factory.canTrain('tank', res)) {
            game.spend(this.team, factory.train('tank'));
            plannedTanks++;
            queued++;
          } else if (wantMoreBombers && factory.canTrain('bomber', res)) {
            game.spend(this.team, factory.train('bomber'));
            plannedBombers++;
            queued++;
          } else break;
        }
      }
    }

    // Dock training
    const dockQueueMax = greedy ? 3 : 2;
    const baselineShips = 1 + Math.floor(game.gameTime / 240);
    const desiredShips = cc ? Math.max(cc.ships || 0, baselineShips) : scaling.maxShips;
    for (const dock of myDocks) {
      let queued = 0;
      while (myShips.length + queued < desiredShips && dock.canTrain('battleship', res) && queued < dockQueueMax) {
        game.spend(this.team, dock.train('battleship'));
        queued++;
      }
    }
  }

  // ── Squad Management ──

  _manageSquads(myLandFighters, enemyLandUnits, enemyBuildings, myBases, canAttack, game) {
    // Clean up dead units from squads
    for (const squad of this.squads) {
      squad.units = squad.units.filter(u => u.hp > 0 && u.team === this.team);
    }
    this.squads = this.squads.filter(s => s.units.length > 0);

    if (!canAttack) return;

    // Get fighters not in any squad and not defending
    const assignedIds = new Set();
    for (const squad of this.squads) {
      for (const u of squad.units) assignedIds.add(u.id);
    }
    if (this.harassSquad) {
      for (const u of this.harassSquad.units) assignedIds.add(u.id);
    }

    const unassigned = myLandFighters.filter(u => !assignedIds.has(u.id) && (u.state === 'idle' || u.state === 'moving'));

    // Form new squads from unassigned fighters
    if (unassigned.length >= this.squadSize) {
      const squadUnits = unassigned.splice(0, this.squadSize);
      this.squads.push({
        units: squadUnits,
        target: null,
        state: 'rally',
        initialSize: squadUnits.length,
      });
    }

    // Process each squad
    for (const squad of this.squads) {
      if (squad.state === 'rally') {
        // Rally near our base before attacking
        if (squad.units.length >= Math.ceil(squad.initialSize * 0.7)) {
          squad.state = 'attack';
          squad.target = this._pickStrategicTarget(enemyLandUnits, enemyBuildings, myBases);
        } else if (myBases.length > 0) {
          // Move to rally point near base
          const rallyBase = myBases[0];
          const rx = Math.floor(rallyBase.x / TILE_SIZE) + 5;
          const ry = Math.floor(rallyBase.y / TILE_SIZE) + 5;
          for (const u of squad.units) {
            if (u.state === 'idle') {
              u.moveTo(game.map, Math.min(MAP_WIDTH - 2, rx), Math.min(MAP_HEIGHT - 2, ry));
            }
          }
        }
      }

      if (squad.state === 'attack') {
        // Check for retreat
        if (this.retreatThreshold > 0 && squad.units.length < squad.initialSize * (1 - this.retreatThreshold)) {
          squad.state = 'retreat';
          continue;
        }

        if (!squad.target || squad.target.hp <= 0) {
          squad.target = this._pickStrategicTarget(enemyLandUnits, enemyBuildings, myBases);
        }

        if (squad.target) {
          // Focus fire: all squad units attack the same target
          const focusTarget = this._pickFocusTarget(squad, enemyLandUnits, game);

          for (const u of squad.units) {
            if (focusTarget) {
              this._issueAttackOrder(u, focusTarget, game);
            } else {
              this._issueAttackOrder(u, squad.target, game);
            }
          }
        }
      }

      if (squad.state === 'retreat') {
        // Retreat to nearest base
        if (myBases.length > 0) {
          const base = this._findClosestBase(squad.units[0], myBases);
          const bx = Math.floor(base.x / TILE_SIZE);
          const by = Math.floor(base.y / TILE_SIZE);
          for (const u of squad.units) {
            u.moveTo(game.map, bx, by);
          }
        }
        // Reset to rally after retreat
        if (squad.units.every(u => u.state === 'idle')) {
          squad.state = 'rally';
          squad.initialSize = squad.units.length;
        }
      }
    }

    // Multi-prong: split into two attack groups when we have enough squads
    if (this.multiProngEnabled && this.squads.filter(s => s.state === 'attack').length >= 2) {
      const attackSquads = this.squads.filter(s => s.state === 'attack');
      // First squad attacks closest enemy base, second attacks a different target
      const targets = this._getAllStrategicTargets(enemyLandUnits, enemyBuildings, myBases);
      if (targets.length >= 2) {
        attackSquads[0].target = targets[0];
        attackSquads[1].target = targets[1];
      }
    }

    // Wave timer: when wave timer fires, any idle fighters join existing squads or form ad-hoc attack
    if (this.waveTimer >= this.waveInterval && myLandFighters.length >= this.waveMinFighters) {
      this.waveTimer = 0;

      // Assign all idle unassigned fighters to attack
      const nowUnassigned = myLandFighters.filter(u => !assignedIds.has(u.id) && (u.state === 'idle' || u.state === 'moving'));
      if (nowUnassigned.length > 0) {
        const target = this._pickStrategicTarget(enemyLandUnits, enemyBuildings, myBases);
        if (target) {
          // Add to an existing attack squad or create ad-hoc
          const existingSquad = this.squads.find(s => s.state === 'attack');
          if (existingSquad) {
            for (const u of nowUnassigned) existingSquad.units.push(u);
          } else {
            this.squads.push({
              units: nowUnassigned,
              target,
              state: 'attack',
              initialSize: nowUnassigned.length,
            });
          }
        }
      }
    }
  }

  // ── Focus Fire ──

  _pickFocusTarget(squad, enemyUnits, game) {
    // Find the nearest enemy to the squad center, prefer lowest HP
    if (squad.units.length === 0) return null;

    const cx = squad.units.reduce((s, u) => s + u.x, 0) / squad.units.length;
    const cy = squad.units.reduce((s, u) => s + u.y, 0) / squad.units.length;
    const engageRange = TILE_SIZE * 8;

    let bestTarget = null;
    let bestScore = Infinity;

    for (const e of enemyUnits) {
      if (e.hp <= 0) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > engageRange) continue;

      // Score: prefer low HP targets nearby (focus fire efficiency)
      const score = e.hp + dist * 0.5;
      if (score < bestScore) {
        bestScore = score;
        bestTarget = e;
      }
    }

    return bestTarget;
  }

  // ── Base Defense ──

  _defendBases(myLandFighters, enemyLandUnits, myBases, game) {
    if (enemyLandUnits.length === 0 || myBases.length === 0) return;

    const defenseTarget = this._findNearestToAnyBase(enemyLandUnits, myBases);
    if (!defenseTarget) return;

    const threatDist = TILE_SIZE * 12;
    const threatCount = this._countEnemiesNearBases(enemyLandUnits, myBases, threatDist);
    if (threatCount === 0) return;

    // Scale defenders to threat
    const defendersNeeded = Math.min(myLandFighters.length, Math.max(4, threatCount + 2));
    let assigned = 0;

    // Prefer idle fighters closest to the threat
    const sortedFighters = [...myLandFighters]
      .filter(f => f.state === 'idle')
      .sort((a, b) => this._distance(a, defenseTarget) - this._distance(b, defenseTarget));

    for (const fighter of sortedFighters) {
      if (assigned >= defendersNeeded) break;
      this._issueAttackOrder(fighter, defenseTarget, game);
      assigned++;
    }

    // Track defense time for counter-attack
    this.lastDefenseTime = game.gameTime;
  }

  // ── Allied Protection ──

  _defendAllies(myLandFighters, enemyLandUnits, myBases, game) {
    if (enemyLandUnits.length === 0) return;

    // Find allied bases (teams that are not hostile to us and not our own)
    const alliedBases = game.buildingManager.buildings.filter(b =>
      b.type === 'base' && b.hp > 0 && b.built &&
      b.team !== this.team && !game.isHostile(this.team, b.team)
    );
    if (alliedBases.length === 0) return;

    // Check if any allied base is under attack
    const allyThreatDist = TILE_SIZE * 14;
    let worstThreat = null;
    let worstThreatCount = 0;

    for (const allyBase of alliedBases) {
      let threatCount = 0;
      let nearestEnemy = null;
      let nearestDist = Infinity;
      for (const e of enemyLandUnits) {
        const d = this._distance(e, allyBase);
        if (d <= allyThreatDist) {
          threatCount++;
          if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
        }
      }
      if (threatCount > worstThreatCount) {
        worstThreatCount = threatCount;
        worstThreat = nearestEnemy;
      }
    }

    if (!worstThreat || worstThreatCount === 0) return;

    // Don't send help if our own bases are under heavy attack (self-preservation first)
    const ownThreatCount = this._countEnemiesNearBases(enemyLandUnits, myBases, TILE_SIZE * 12);
    if (ownThreatCount > worstThreatCount) return;

    // Send a portion of idle fighters to help (don't leave ourselves defenseless)
    const idleFighters = myLandFighters.filter(f => f.state === 'idle');
    const helpersToSend = Math.min(
      idleFighters.length,
      Math.max(2, Math.floor(idleFighters.length * 0.4)),
      worstThreatCount + 3
    );

    // Pick fighters closest to the threat
    const sorted = [...idleFighters].sort((a, b) =>
      this._distance(a, worstThreat) - this._distance(b, worstThreat)
    );

    for (let i = 0; i < helpersToSend && i < sorted.length; i++) {
      this._issueAttackOrder(sorted[i], worstThreat, game);
    }
  }

  // ── Worker Harassment ──

  _manageHarass(myLandFighters, enemyUnits, enemyBuildings, myBases, game) {
    // Clean up harass squad
    if (this.harassSquad) {
      this.harassSquad.units = this.harassSquad.units.filter(u => u.hp > 0 && u.team === this.team);
      if (this.harassSquad.units.length === 0) this.harassSquad = null;
    }

    // Form harass squad from idle soldiers (fast units)
    if (!this.harassSquad && myLandFighters.length >= 8) {
      const harassCandidates = myLandFighters
        .filter(u => u.type === 'soldier' && u.state === 'idle')
        .slice(0, 3);

      if (harassCandidates.length >= 2) {
        this.harassSquad = { units: harassCandidates, retreating: false };
      }
    }

    if (!this.harassSquad) return;

    const squad = this.harassSquad;

    // Find enemy workers to harass
    const enemyWorkers = enemyUnits.filter(u => u.type === 'worker' && u.hp > 0);
    if (enemyWorkers.length > 0 && !squad.retreating) {
      // Find enemy worker nearest to an enemy base (mineral line)
      const targetWorker = this._findNearestToAnyBase(enemyWorkers,
        enemyBuildings.filter(b => b.type === 'base' && b.hp > 0));

      if (targetWorker) {
        for (const u of squad.units) {
          this._issueAttackOrder(u, targetWorker, game);
        }
      }
    }

    // Retreat if too many defenders nearby
    if (!squad.retreating) {
      const cx = squad.units.reduce((s, u) => s + u.x, 0) / squad.units.length;
      const cy = squad.units.reduce((s, u) => s + u.y, 0) / squad.units.length;
      const nearbyEnemyFighters = enemyUnits.filter(u => u.type !== 'worker' && u.hp > 0 &&
        Math.abs(u.x - cx) < TILE_SIZE * 8 && Math.abs(u.y - cy) < TILE_SIZE * 8);
      if (nearbyEnemyFighters.length > squad.units.length + 1) {
        squad.retreating = true;
      }
    }

    if (squad.retreating && myBases.length > 0) {
      const base = myBases[0];
      const bx = Math.floor(base.x / TILE_SIZE);
      const by = Math.floor(base.y / TILE_SIZE);
      for (const u of squad.units) {
        u.moveTo(game.map, bx, by);
      }
      if (squad.units.every(u => u.state === 'idle')) {
        this.harassSquad = null; // Disbanded, will reform later
      }
    }
  }

  // ── Naval ──

  _manageNaval(myNavalFighters, enemyUnits, enemyBuildings, game) {
    const aggroDist = TILE_SIZE * this.aggroRange;
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
  }

  // ── Enemy Composition Tracking ──

  _trackEnemyComposition(enemyUnits) {
    this.enemyComposition = {};
    for (const u of enemyUnits) {
      if (u.hp <= 0 || u.type === 'worker') continue;
      this.enemyComposition[u.type] = (this.enemyComposition[u.type] || 0) + 1;
    }
  }

  _issueAttackOrder(unit, target, game) {
    if (!unit || !target || target.hp <= 0) return;
    const isBuilding = target.tileX !== undefined && target.sizeTiles !== undefined;

    if (isBuilding) {
      if (unit.state === 'attackingBuilding' && unit.targetBld === target) return;
      if (unit.state === 'moving' && unit.targetBld === target) return;
      unit.attackBuilding(target, game.map);
      return;
    }

    if (unit.state === 'attacking' && unit.target === target) return;
    if (unit.state === 'moving' && unit.target === target) return;
    unit.attackTarget(target, game.map);
  }

  // ── Copycat (Tit-for-Tat) AI ──
  // Observes a target team and dynamically adjusts own caps to mirror their composition.

  _copycatObserve(game) {
    const target = this.copycatTarget;
    const m = this.copycatMultiplier;
    const targetUnits = game.unitManager.getPlayerUnits(target);
    const targetBuildings = game.buildingManager.getByTeam(target);

    // Count target's buildings
    const tBases = targetBuildings.filter(b => b.type === 'base').length;
    const tBarracks = targetBuildings.filter(b => b.type === 'barracks').length;
    const tFactories = targetBuildings.filter(b => b.type === 'factory').length;
    const tDocks = targetBuildings.filter(b => b.type === 'dock').length;
    const tTowers = targetBuildings.filter(b => b.type === 'tower').length;

    // Count target's units
    const tWorkers = targetUnits.filter(u => u.type === 'worker').length;
    const tSoldiers = targetUnits.filter(u => u.type === 'soldier').length;
    const tRockets = targetUnits.filter(u => u.type === 'rocket').length;
    const tTanks = targetUnits.filter(u => u.type === 'tank').length;
    const tBombers = targetUnits.filter(u => u.type === 'bomber').length;
    const tShips = targetUnits.filter(u => u.type === 'battleship').length;

    // Direct mirroring: set caps to EXACTLY what we want to copy (multiplied)
    // Use direct assignment instead of Math.max so we actively match the player's composition
    this.targetBaseCount = Math.max(this.targetBaseCount, Math.ceil(tBases * m) + 1);

    // Building caps: always at least match player + multiplier
    this.maxBarracks = Math.max(2, Math.ceil(tBarracks * m) + 1);
    this.maxFactories = Math.max(1, Math.ceil(tFactories * m) + (tFactories > 0 ? 1 : 0));
    this.maxDocks = Math.max(0, Math.ceil(tDocks * m));
    this.maxTowers = Math.max(3, Math.ceil(tTowers * m));

    // Unit caps: DIRECTLY mirror the player's composition at multiplier rate
    // This is the key change - instead of Math.max with already-high caps,
    // we SET the desired counts to mirror the player's army composition
    this._copycatDesired = {
      workers: Math.max(8, Math.ceil(tWorkers * m)),
      soldiers: Math.ceil(tSoldiers * m),
      rockets: Math.ceil(tRockets * m),
      tanks: Math.ceil(tTanks * m),
      bombers: Math.ceil(tBombers * m),
      ships: Math.ceil(tShips * m),
    };

    // If target just expanded, force expansion timer ready
    if (tBases > (this._lastSeenTargetBases || 0)) {
      this.expansionTimer = Math.max(this.expansionTimer, this.expansionInterval);
    }
    this._lastSeenTargetBases = tBases;

    // If target is building factories/docks, make sure we do too
    if (tFactories > 0) this.buildsFactory = true;
    if (tDocks > 0) this.buildsDock = true;
  }

  // ── Strategic Target Selection ──

  _pickStrategicTarget(enemyUnits, enemyBuildings, myBases) {
    const targets = this._getAllStrategicTargets(enemyUnits, enemyBuildings, myBases);
    return targets.length > 0 ? targets[0] : null;
  }

  _getAllStrategicTargets(enemyUnits, enemyBuildings, myBases) {
    const targets = [];

    // Priority 1: Enemy bases (closest first)
    const enemyBases = enemyBuildings.filter(b => b.type === 'base' && b.hp > 0);
    if (enemyBases.length > 0) {
      const sorted = this._sortByDistToMyBases(enemyBases, myBases);
      for (const t of sorted) targets.push(t);
    }

    // Priority 2: Production buildings
    const production = enemyBuildings.filter(b => (b.type === 'barracks' || b.type === 'factory' || b.type === 'dock') && b.hp > 0);
    if (production.length > 0) {
      const sorted = this._sortByDistToMyBases(production, myBases);
      for (const t of sorted) targets.push(t);
    }

    // Priority 3: Enemy army concentrations
    const landUnits = enemyUnits.filter(u => u.hp > 0 && !u.naval);
    if (landUnits.length > 0) {
      targets.push(this._closestToMyBases(landUnits, myBases));
    }

    return targets.filter(Boolean);
  }

  _sortByDistToMyBases(targets, myBases) {
    if (myBases.length === 0) return [...targets];
    return [...targets].sort((a, b) => {
      const distA = Math.min(...myBases.map(base => this._distance(a, base)));
      const distB = Math.min(...myBases.map(base => this._distance(b, base)));
      return distA - distB;
    });
  }

  // ── Helper Methods ──

  _findBuildSpot(game, base, sizeTiles) {
    const bx = Math.floor(base.x / TILE_SIZE);
    const by = Math.floor(base.y / TILE_SIZE);
    const offsets = [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3], [5, 0], [0, 5], [-5, 0], [0, -5]];
    for (const [ox, oy] of offsets) {
      const tx = bx + ox;
      const ty = by + oy;
      if (game.buildingManager.canPlaceAt(tx, ty, sizeTiles, game.map)) {
        return { x: tx, y: ty };
      }
    }
    for (let r = 4; r < 15; r++) {
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
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
    for (let r = 3; r < 40; r++) {
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

  _desiredCount(maxCount, gameTime, secondsPerStep) {
    if (maxCount <= 1) return maxCount;
    const steps = 1 + Math.floor(gameTime / secondsPerStep);
    return Math.max(1, Math.min(maxCount, steps));
  }

  _countEnemiesNearBases(enemyUnits, myBases, rangePx) {
    if (myBases.length === 0 || enemyUnits.length === 0) return 0;
    let count = 0;
    for (const e of enemyUnits) {
      for (const base of myBases) {
        if (this._distance(e, base) <= rangePx) {
          count++;
          break;
        }
      }
    }
    return count;
  }

  _findNearestToAnyBase(targets, myBases) {
    let bestTarget = null;
    let bestDist = Infinity;
    for (const t of targets) {
      if (t.hp <= 0) continue;
      for (const base of myBases) {
        const d = this._distance(t, base);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = t;
        }
      }
    }
    return bestTarget;
  }

  _closestToMyBases(targets, myBases) {
    if (targets.length === 0) return null;
    if (myBases.length === 0) return targets[0];
    let best = targets[0];
    let bestDist = Infinity;
    for (const t of targets) {
      for (const b of myBases) {
        const d = this._distance(t, b);
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
      }
    }
    return best;
  }

  _findClosestBase(unit, myBases) {
    let closest = myBases[0];
    let closestDist = Infinity;
    for (const base of myBases) {
      const d = this._distance(unit, base);
      if (d < closestDist) {
        closestDist = d;
        closest = base;
      }
    }
    return closest;
  }

  _findExpansionSpot(game, myBases) {
    if (myBases.length === 0) return null;

    const allBases = game.buildingManager.buildings.filter(b => b.type === 'base');
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

    // Find best resource hub not yet covered by existing HQ chain.
    const hubs = [];
    for (const [key, amount] of game.map.mineralAmounts) {
      if (amount <= 0) continue;
      const [hx, hy] = key.split(',').map(Number);
      const nearbyMinerals = this._sumNearbyResources(game.map.mineralAmounts, hx, hy, 9);
      const nearbyWood = this._sumNearbyResources(game.map.woodAmounts, hx, hy, 11);
      const richness = nearbyMinerals * 1.9 + nearbyWood * 1.2 + amount * 0.7;
      if (richness <= 0) continue;

      let nearestMyBase = null;
      let nearestMyDist = Infinity;
      for (const c of myBaseCenters) {
        const d = this._distanceTiles(hx, hy, c.x, c.y);
        if (d < nearestMyDist) {
          nearestMyDist = d;
          nearestMyBase = c;
        }
      }

      let nearestAnyBaseDist = Infinity;
      for (const c of baseCenters) {
        nearestAnyBaseDist = Math.min(nearestAnyBaseDist, this._distanceTiles(hx, hy, c.x, c.y));
      }

      if (nearestAnyBaseDist < minDist) continue;
      if (nearestMyDist < 10) continue;
      hubs.push({ hx, hy, richness, nearestMyBase, nearestMyDist });
    }

    if (hubs.length === 0) return null;
    hubs.sort((a, b) => (b.richness + b.nearestMyDist * 0.45) - (a.richness + a.nearestMyDist * 0.45));
    const hub = hubs[0];

    // Progressive stepping toward best hub: if very far, place next HQ partway closer.
    const stepDist = 26;
    let anchorX = hub.hx;
    let anchorY = hub.hy;
    if (hub.nearestMyDist > stepDist && hub.nearestMyBase) {
      const dx = hub.hx - hub.nearestMyBase.x;
      const dy = hub.hy - hub.nearestMyBase.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      anchorX = Math.floor(hub.nearestMyBase.x + (dx / len) * stepDist);
      anchorY = Math.floor(hub.nearestMyBase.y + (dy / len) * stepDist);
    }

    return this._findBuildableBaseSpotNear(game, anchorX, anchorY, sizeTiles, baseCenters, minDist);
  }

  _findBuildableBaseSpotNear(game, cx, cy, sizeTiles, baseCenters, minDist) {
    for (let r = 0; r <= 16; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = cx + dx - 1;
          const ty = cy + dy - 1;
          if (tx < 2 || ty < 2 || tx >= MAP_WIDTH - 4 || ty >= MAP_HEIGHT - 4) continue;
          let tooClose = false;
          for (const bc of baseCenters) {
            if (this._distanceTiles(tx, ty, bc.x, bc.y) < minDist) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;
          if (game.buildingManager.canPlaceAt(tx, ty, sizeTiles, game.map)) {
            return { x: tx, y: ty };
          }
        }
      }
    }
    return null;
  }

  _findClosestBaseByTile(tx, ty, myBases) {
    if (!myBases || myBases.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const base of myBases) {
      const bx = Math.floor(base.x / TILE_SIZE);
      const by = Math.floor(base.y / TILE_SIZE);
      const d = this._distanceTiles(tx, ty, bx, by);
      if (d < bestDist) {
        bestDist = d;
        best = base;
      }
    }
    return best;
  }

  _pickEconomyAnchorBase(worker, myBases, baseStats) {
    if (!myBases || myBases.length === 0) return null;
    let bestBase = null;
    let bestScore = Infinity;
    for (const base of myBases) {
      const s = baseStats.get(base);
      const dx = worker.x - base.x;
      const dy = worker.y - base.y;
      const dist2 = dx * dx + dy * dy;
      const deficit = s ? Math.max(0, s.desiredTotal - s.total) : 0;
      const score = dist2 - deficit * 25000;
      if (score < bestScore) {
        bestScore = score;
        bestBase = base;
      }
    }
    return bestBase;
  }

  _findWaterNearEnemy(game, enemyBuildings) {
    const targets = enemyBuildings.filter(b => b.hp > 0);
    if (targets.length === 0) return null;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const tx = Math.floor(target.x / TILE_SIZE);
    const ty = Math.floor(target.y / TILE_SIZE);
    for (let r = 1; r < 30; r++) {
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

  _findNearestResource(unit, map, type) {
    const amounts = type === 'wood' ? map.woodAmounts : map.mineralAmounts;
    let closest = null;
    let closestDist = Infinity;
    for (const [key, amount] of amounts) {
      if (amount <= 0) continue;
      const [rx, ry] = key.split(',').map(Number);
      const wx = rx * TILE_SIZE + TILE_SIZE / 2;
      const wy = ry * TILE_SIZE + TILE_SIZE / 2;
      const dx = unit.x - wx;
      const dy = unit.y - wy;
      const d = dx * dx + dy * dy;
      if (d < closestDist) {
        closestDist = d;
        closest = { x: rx, y: ry };
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

  _distanceTiles(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _sumNearbyResources(resourceMap, cx, cy, radius) {
    let sum = 0;
    const r2 = radius * radius;
    for (const [key, amount] of resourceMap) {
      if (amount <= 0) continue;
      const [rx, ry] = key.split(',').map(Number);
      const dx = rx - cx;
      const dy = ry - cy;
      if (dx * dx + dy * dy <= r2) {
        sum += amount;
      }
    }
    return sum;
  }

  _getScalingCaps(gameTime, baseCount) {
    const t = Math.max(0, gameTime);
    const bases = Math.max(1, baseCount);
    const greedy = this.greedyExpansion;
    // Greedy mode: time scales much faster, no hard ceilings
    const timeScale = greedy ? (1 + Math.floor(t / 45)) : (1 + Math.floor(t / 120));
    return {
      maxBases: greedy
        ? Math.min(14, Math.max(this.targetBaseCount, 2 + Math.floor(t / 30)))
        : Math.min(10, Math.max(this.targetBaseCount, 2 + Math.floor(t / 70))),
      maxWorkers: Math.max(this.maxWorkers, this.workerPerBase * bases + timeScale * (greedy ? 18 : 12)),
      maxBarracks: greedy
        ? Math.max(this.maxBarracks, 2 + bases + Math.floor(t / 50))
        : Math.max(this.maxBarracks, Math.min(16, 2 + bases + Math.floor(t / 120))),
      maxFactories: greedy
        ? Math.max(this.maxFactories, 1 + bases + Math.floor(t / 60))
        : Math.max(this.maxFactories, Math.min(10, 1 + Math.floor(bases * 0.7) + Math.floor(t / 150))),
      maxDocks: greedy
        ? Math.max(this.maxDocks, 1 + Math.floor(t / 80))
        : Math.max(this.maxDocks, Math.min(5, 1 + Math.floor(t / 200))),
      maxTowers: greedy
        ? Math.max(this.maxTowers, 4 + bases * 2 + Math.floor(t / 60))
        : Math.max(this.maxTowers, Math.min(22, 3 + bases * 2)),
      maxRockets: greedy
        ? Math.max(this.maxRockets, 8 + bases * 3 + timeScale * 5)
        : Math.max(this.maxRockets, 5 + bases * 2 + timeScale * 3),
      maxTanks: greedy
        ? Math.max(this.maxTanks, 6 + bases * 2 + timeScale * 4)
        : Math.max(this.maxTanks, 4 + Math.floor(bases * 1.8) + timeScale * 2),
      maxBombers: greedy
        ? Math.max(this.maxBombers || 0, 3 + bases + timeScale * 2)
        : Math.max(this.maxBombers || 0, Math.max(2, Math.floor(bases / 2) + timeScale)),
      maxShips: greedy
        ? Math.max(this.maxShips, 3 + bases + Math.floor(t / 80))
        : Math.max(this.maxShips, Math.min(12, 2 + bases + Math.floor(t / 160))),
    };
  }
}
