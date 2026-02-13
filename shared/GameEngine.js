import {
  TILE_SIZE,
  MAP_WIDTH,
  MAP_HEIGHT,
  TEAM_BLUE,
  TEAM_RED,
  TEAM_GREEN,
  TEAM_YELLOW,
  ALL_TEAMS,
  MAX_UNITS_TOTAL,
  UNIT_DEFS,
  BUILDING_DEFS,
} from './constants.js';
import { GameMap } from './map.js';
import { Unit, applyUnitSeparation, resetUnitIdCounter, setNextUnitIdCounter } from './unit.js';
import { Building, getBuildingAtTile, resetBuildingIdCounter, setNextBuildingIdCounter } from './building.js';

const SPAWN_CORNERS = {
  [TEAM_BLUE]: { baseX: 12, baseY: 12 },
  [TEAM_RED]: { baseX: MAP_WIDTH - 18, baseY: 12 },
  [TEAM_GREEN]: { baseX: 12, baseY: MAP_HEIGHT - 18 },
  [TEAM_YELLOW]: { baseX: MAP_WIDTH - 18, baseY: MAP_HEIGHT - 18 },
};

export class GameEngine {
  constructor({ teams = ALL_TEAMS, seed = null, spawnInitial = true } = {}) {
    this.map = new GameMap(seed || undefined);
    this.units = [];
    this.buildings = [];
    this.activeTeams = [...teams];
    this.resources = {};
    this.tick = 0;
    this.winnerTeam = null;
    this.ended = false;

    for (const team of this.activeTeams) {
      this.resources[team] = { minerals: 200, wood: 100 };
    }

    resetUnitIdCounter();
    resetBuildingIdCounter();
    if (spawnInitial) {
      this._spawnStartingSetup();
    }
  }

  _spawnStartingSetup() {
    for (const team of this.activeTeams) {
      const spawn = SPAWN_CORNERS[team];
      if (!spawn) continue;
      const { baseX, baseY } = spawn;

      const base = new Building(baseX, baseY, 'base', team);
      base.built = true;
      base.buildProgress = base.buildTime;
      this.buildings.push(base);

      for (let i = 0; i < 5; i++) {
        const tx = baseX - 1 + (i % 3);
        const ty = baseY + 3 + Math.floor(i / 3);
        if (this.map.isWalkable(tx, ty)) {
          this.units.push(new Unit(tx, ty, 'worker', team));
        }
      }

      for (let i = 0; i < 2; i++) {
        const tx = baseX + 3 + i;
        const ty = baseY + 3;
        if (this.map.isWalkable(tx, ty)) {
          this.units.push(new Unit(tx, ty, 'soldier', team));
        }
      }
    }
  }

  getTeamUnits(team) {
    return this.units.filter((u) => u.team === team && u.hp > 0);
  }

  getTeamBuildings(team) {
    return this.buildings.filter((b) => b.team === team && b.hp > 0);
  }

  getUnitById(id) {
    return this.units.find((u) => u.id === id);
  }

  getBuildingById(id) {
    return this.buildings.find((b) => b.id === id);
  }

  canAfford(team, cost) {
    const res = this.resources[team];
    if (!res) return false;
    return res.minerals >= (cost.minerals || 0) && res.wood >= (cost.wood || 0);
  }

  spend(team, cost) {
    this.resources[team].minerals -= (cost.minerals || 0);
    this.resources[team].wood -= (cost.wood || 0);
  }

  credit(team, { minerals = 0, wood = 0 }) {
    if (!this.resources[team]) return;
    this.resources[team].minerals += minerals;
    this.resources[team].wood += wood;
  }

  update(dt) {
    if (this.ended) return;

    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].hp <= 0) {
        this.units.splice(i, 1);
      }
    }

    for (const unit of this.units) {
      unit.update(dt, this.map, this.units, this.buildings);
    }

    applyUnitSeparation(this.units, dt, this.map);

    for (const unit of this.units) {
      if (unit._onDeposit) {
        if (unit.carryType === 'wood') {
          this.credit(unit.team, { wood: unit.carrying });
        } else {
          this.credit(unit.team, { minerals: unit.carrying });
        }
        unit.carrying = 0;
        unit.carryType = null;
        unit._onDeposit = false;
      }
    }

    const produced = [];
    for (const b of this.buildings) {
      const enemies = this.units.filter((u) => u.team !== b.team);
      const out = b.update(dt, enemies);
      if (out) produced.push(out);
    }

    for (let i = this.buildings.length - 1; i >= 0; i--) {
      if (this.buildings[i].hp <= 0) {
        this.buildings.splice(i, 1);
      }
    }

    for (const p of produced) {
      if (this.units.length >= MAX_UNITS_TOTAL) break;
      const spawn = this._findSpawnTile(p);
      if (!spawn) continue;
      this.units.push(new Unit(spawn.x, spawn.y, p.unitType, p.team));
    }

    this.tick += 1;
    this._checkWinCondition();
  }

  _findSpawnTile(produced) {
    let spawnX = Math.floor(produced.x / TILE_SIZE);
    let spawnY = Math.floor(produced.y / TILE_SIZE);
    const isNaval = UNIT_DEFS[produced.unitType]?.naval;

    const isTileOk = (tx, ty) => {
      if (!this.map.inBounds(tx, ty)) return false;
      if (getBuildingAtTile(this.buildings, tx, ty)) return false;
      for (const u of this.units) {
        if (Math.floor(u.x / TILE_SIZE) === tx && Math.floor(u.y / TILE_SIZE) === ty) return false;
      }
      return isNaval ? this.map.isSwimmable(tx, ty) : this.map.isWalkable(tx, ty);
    };

    if (isTileOk(spawnX, spawnY)) return { x: spawnX, y: spawnY };

    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = spawnX + dx;
          const ty = spawnY + dy;
          if (isTileOk(tx, ty)) return { x: tx, y: ty };
        }
      }
    }

    return null;
  }

  _checkWinCondition() {
    const aliveTeams = this.activeTeams.filter((team) => {
      const hasUnits = this.units.some((u) => u.team === team && u.hp > 0);
      const hasBuildings = this.buildings.some((b) => b.team === team && b.hp > 0);
      return hasUnits || hasBuildings;
    });

    if (aliveTeams.length <= 1) {
      this.ended = true;
      this.winnerTeam = aliveTeams.length === 1 ? aliveTeams[0] : null;
    }
  }

  getSnapshot(skipMapTiles = false) {
    return {
      tick: this.tick,
      activeTeams: this.activeTeams,
      ended: this.ended,
      winnerTeam: this.winnerTeam,
      map: this.map.toSnapshot(skipMapTiles),
      resources: this.resources,
      units: this.units.map((u) => u.toSnapshot()),
      buildings: this.buildings.map((b) => b.toSnapshot()),
    };
  }

  static fromSnapshot(snapshot) {
    const resourceTeams = Object.keys(snapshot?.resources || {}).map((k) => Number(k)).filter((n) => !Number.isNaN(n));
    const teams = snapshot?.activeTeams || (resourceTeams.length > 0 ? resourceTeams : ALL_TEAMS);
    const engine = new GameEngine({ teams, seed: snapshot?.map?.seed ?? null, spawnInitial: false });

    engine.map = GameMap.fromSnapshot(snapshot.map);
    engine.resources = {};
    for (const [k, v] of Object.entries(snapshot.resources || {})) {
      engine.resources[Number(k)] = { minerals: v.minerals || 0, wood: v.wood || 0 };
    }
    engine.tick = snapshot.tick || 0;
    engine.ended = !!snapshot.ended;
    engine.winnerTeam = snapshot.winnerTeam ?? null;

    engine.units = (snapshot.units || []).map((u) => Unit.fromSnapshot(u));
    engine.buildings = (snapshot.buildings || []).map((b) => Building.fromSnapshot(b));

    const unitById = new Map(engine.units.map((u) => [u.id, u]));
    const buildingById = new Map(engine.buildings.map((b) => [b.id, b]));
    for (const u of engine.units) {
      const raw = (snapshot.units || []).find((s) => s.id === u.id);
      if (!raw) continue;
      if (raw.targetId != null) u.target = unitById.get(raw.targetId) || null;
      if (raw.targetBldId != null) u.targetBld = buildingById.get(raw.targetBldId) || null;
      if (raw.buildTargetId != null) u.buildTarget = buildingById.get(raw.buildTargetId) || null;
    }

    const maxUnitId = engine.units.reduce((m, u) => Math.max(m, u.id), 0);
    const maxBuildingId = engine.buildings.reduce((m, b) => Math.max(m, b.id), 0);
    setNextUnitIdCounter(maxUnitId + 1);
    setNextBuildingIdCounter(maxBuildingId + 1);

    return engine;
  }
}
