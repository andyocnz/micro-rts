import {
  TILE_SIZE, TILE_MINERAL, TILE_TREE,
  TEAM_BLUE, TEAM_RED, TEAM_GREEN, TEAM_YELLOW,
  AI_TEAMS, TEAM_COLORS,
  MAP_WIDTH, MAP_HEIGHT
} from './constants.js';
import { GameMap } from './map.js';
import { Camera } from './camera.js';
import { InputManager } from './input.js';
import { Unit, UnitManager, UNIT_DEFS } from './units.js';
import { Building, BuildingManager, BUILDING_DEFS } from './buildings.js';
import { SpriteSheet } from './sprites.js';
import { Renderer } from './renderer.js';
import { SimpleAI } from './ai.js';
import { initAudio, sfxSelect, sfxMove, sfxBuild, sfxError } from './audio.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;

    // Dual resource system: minerals + wood (all 4 teams)
    this.resources = {
      [TEAM_BLUE]: { minerals: 200, wood: 100 },
      [TEAM_RED]: { minerals: 200, wood: 100 },
      [TEAM_GREEN]: { minerals: 200, wood: 100 },
      [TEAM_YELLOW]: { minerals: 200, wood: 100 },
    };

    // Core systems
    this.sprites = new SpriteSheet();
    this.sprites.generate();

    this.map = new GameMap();
    this.camera = new Camera(canvas.width, canvas.height);
    this.input = new InputManager(canvas);
    this.unitManager = new UnitManager();
    this.buildingManager = new BuildingManager();
    this.renderer = new Renderer(canvas, this.sprites);

    // 3 AI opponents
    this.ais = AI_TEAMS.map(t => new SimpleAI(t));

    // Build mode
    this.buildMode = null;

    // Spawn initial setup
    this._spawnStartingSetup();

    // Center camera on player start
    this.camera.centerOn(5 * TILE_SIZE, 5 * TILE_SIZE);

    // Audio
    initAudio();

    // Keyboard listener for build hotkeys
    window.addEventListener('keydown', (e) => this._onKeyDown(e));

    this.running = true;
    this.lastTime = 0;
  }

  // --- Resource helpers ---

  canAfford(team, cost) {
    const r = this.resources[team];
    return r.minerals >= (cost.minerals || 0) && r.wood >= (cost.wood || 0);
  }

  spend(team, cost) {
    this.resources[team].minerals -= (cost.minerals || 0);
    this.resources[team].wood -= (cost.wood || 0);
  }

  getMinerals(team) {
    return this.resources[team].minerals;
  }

  getWood(team) {
    return this.resources[team].wood;
  }

  getResources(team) {
    return this.resources[team];
  }

  _spawnStartingSetup() {
    const corners = [
      { team: TEAM_BLUE, baseX: 4, baseY: 4 },
      { team: TEAM_RED, baseX: MAP_WIDTH - 6, baseY: 4 },
      { team: TEAM_GREEN, baseX: 4, baseY: MAP_HEIGHT - 6 },
      { team: TEAM_YELLOW, baseX: MAP_WIDTH - 6, baseY: MAP_HEIGHT - 6 },
    ];

    for (const { team, baseX, baseY } of corners) {
      const base = new Building(baseX, baseY, 'base', team);
      base.built = true;
      base.buildProgress = base.buildTime;
      this.buildingManager.add(base);

      for (let i = 0; i < 5; i++) {
        const tx = baseX - 1 + (i % 3);
        const ty = baseY + 3 + Math.floor(i / 3);
        if (this.map.isWalkable(tx, ty)) {
          this.unitManager.add(new Unit(tx, ty, 'worker', team));
        }
      }

      for (let i = 0; i < 2; i++) {
        const tx = baseX + 3 + i;
        const ty = baseY + 3;
        if (this.map.isWalkable(tx, ty)) {
          this.unitManager.add(new Unit(tx, ty, 'soldier', team));
        }
      }
    }
  }

  start() {
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _loop(timestamp) {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this._handleInput();
    this._update(dt);
    this.renderer.updateMoveMarkers(dt);
    this.renderer.updateParticles(dt);
    this.renderer.render(this);

    requestAnimationFrame((t) => this._loop(t));
  }

  _update(dt) {
    // Update units
    const deaths = this.unitManager.update(dt, this.map, this.buildingManager.buildings);

    // SFX and Particles for deaths
    for (const d of deaths) {
      const color = TEAM_COLORS[d.team]?.primary || '#ffffff';
      for (let i = 0; i < 15; i++) {
        this.renderer.addParticle({
          x: d.x + (Math.random() - 0.5) * 10,
          y: d.y + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 120,
          vy: (Math.random() - 0.5) * 120,
          life: 0.5 + Math.random() * 0.5,
          color: Math.random() > 0.3 ? color : '#fff',
          size: 1 + Math.random() * 2
        });
      }
      for (let i = 0; i < 5; i++) {
        this.renderer.addParticle({
          x: d.x, y: d.y,
          vx: (Math.random() - 0.5) * 30,
          vy: -20 - Math.random() * 30,
          life: 1.0 + Math.random(),
          color: '#555',
          size: 4 + Math.random() * 4,
          type: 'smoke'
        });
      }
    }

    // Handle resource deposits
    for (const unit of this.unitManager.units) {
      if (unit._onDeposit) {
        if (unit.carryType === 'wood') {
          this.resources[unit.team].wood += unit.carrying;
        } else {
          this.resources[unit.team].minerals += unit.carrying;
        }
        unit.carrying = 0;
        unit.carryType = null;
        unit._onDeposit = false;
      }
    }

    // Update buildings - spawn trained units, tower attacks
    const { produced, destroyed } = this.buildingManager.update(dt, this.unitManager.units);

    // Building destruction effects
    for (const b of destroyed) {
      const color = TEAM_COLORS[b.team]?.primary || '#ffffff';
      for (let i = 0; i < 40; i++) {
        this.renderer.addParticle({
          x: b.x + (Math.random() - 0.5) * (b.sizeTiles * TILE_SIZE),
          y: b.y + (Math.random() - 0.5) * (b.sizeTiles * TILE_SIZE),
          vx: (Math.random() - 0.5) * 200,
          vy: (Math.random() - 0.5) * 200,
          life: 0.8 + Math.random() * 0.7,
          color: Math.random() > 0.4 ? color : '#777',
          size: 2 + Math.random() * 4
        });
      }
      for (let i = 0; i < 15; i++) {
        this.renderer.addParticle({
          x: b.x + (Math.random() - 0.5) * 20,
          y: b.y + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 50,
          vy: -30 - Math.random() * 50,
          life: 1.5 + Math.random() * 2,
          color: '#333',
          size: 8 + Math.random() * 12,
          type: 'smoke'
        });
      }
    }

    // Spawn produced units
    for (const p of produced) {
      const tx = Math.floor(p.x / TILE_SIZE);
      const ty = Math.floor(p.y / TILE_SIZE);

      // Find a random walkable spot nearby (radius 2-3) so they "stand around" the building
      let spawnX = tx, spawnY = ty;
      const candidates = [];
      const radius = 3;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= 1.5 && dist <= radius) { // Not too close, not too far
            if (this.map.isWalkable(tx + dx, ty + dy)) {
              candidates.push({ x: tx + dx, y: ty + dy });
            }
          }
        }
      }

      if (candidates.length > 0) {
        const spot = candidates[Math.floor(Math.random() * candidates.length)];
        spawnX = spot.x;
        spawnY = spot.y;
      } else {
        // Fallback to original searches if no clear spots found
        let found = false;
        for (let r = 1; r < 5 && !found; r++) {
          for (let dy = -r; dy <= r && !found; dy++) {
            for (let dx = -r; dx <= r && !found; dx++) {
              if (this.map.isWalkable(tx + dx, ty + dy)) {
                spawnX = tx + dx; spawnY = ty + dy; found = true;
              }
            }
          }
        }
      }

      const unit = new Unit(spawnX, spawnY, p.unitType, p.team);
      // Visual: Spawn at the entrance and walk to their spot
      unit.x = p.x;
      unit.y = p.y;
      this.unitManager.add(unit);
    }

    // AI — update all 3 opponents
    for (const ai of this.ais) {
      ai.update(dt, this);
    }

    // Camera
    this.camera.update(dt, this.input.keys, this.input.mouseX, this.input.mouseY);

    // Mouse wheel zoom
    const scroll = this.input.consumeScroll();
    if (scroll !== 0) {
      this.camera.applyZoom(scroll, this.input.mouseX, this.input.mouseY);
    }

    // Minimap click
    const mmClick = this.input.consumeMinimapClick();
    if (mmClick) {
      this.camera.centerOn(mmClick.worldX, mmClick.worldY);
    }

    this.renderer.minimapDirty = true;
  }

  _handleInput() {
    // Check minimap click first
    const peekLeft = this.input.leftClick;
    if (peekLeft && !peekLeft.box) {
      const mmWorld = this.renderer.screenToMinimapWorld(peekLeft.x, peekLeft.y);
      if (mmWorld) {
        this.input.consumeLeftClick();
        this.camera.centerOn(mmWorld.worldX, mmWorld.worldY);
        return;
      }
    }

    // Build mode placement
    if (this.buildMode) {
      const leftClick = this.input.consumeLeftClick();
      if (leftClick && !leftClick.box) {
        const worldPos = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const tileX = Math.floor(worldPos.x / TILE_SIZE);
        const tileY = Math.floor(worldPos.y / TILE_SIZE);
        const def = BUILDING_DEFS[this.buildMode];

        const canPlace = this.buildMode === 'dock'
          ? this.buildingManager.canPlaceDock(tileX, tileY, this.map)
          : this.buildingManager.canPlaceAt(tileX, tileY, def.sizeTiles, this.map);

        if (canPlace && this.canAfford(TEAM_BLUE, def.cost)) {
          const building = new Building(tileX, tileY, this.buildMode, TEAM_BLUE);
          this.buildingManager.add(building);
          this.spend(TEAM_BLUE, def.cost);
          sfxBuild();

          // Send a worker to build it
          const selected = this.unitManager.getSelected();
          const worker = selected.find(u => u.type === 'worker') ||
            this.unitManager.getPlayerUnits(TEAM_BLUE).find(u => u.type === 'worker' && u.state === 'idle') ||
            this.unitManager.getPlayerUnits(TEAM_BLUE).find(u => u.type === 'worker');
          if (worker) {
            worker.buildBuilding(building, this.map);
          }

          this.buildMode = null;
        } else {
          sfxError();
        }
        return;
      }

      const rightClick = this.input.consumeRightClick();
      if (rightClick) {
        this.buildMode = null;
        return;
      }
      return;
    }

    // Normal mode - left click / box select
    const leftClick = this.input.consumeLeftClick();
    if (leftClick) {
      if (leftClick.box) {
        if (!leftClick.shift) {
          this.unitManager.deselectAll();
          this.buildingManager.deselectAll();
        }
        const units = this.unitManager.getUnitsInScreenBox(leftClick.box, this.camera, TEAM_BLUE);
        for (const u of units) u.selected = true;
        if (units.length > 0) sfxSelect();
      } else {
        const clicked = this.unitManager.getUnitAtScreen(leftClick.x, leftClick.y, this.camera);
        const clickedBuilding = this.buildingManager.getBuildingAtScreen(leftClick.x, leftClick.y, this.camera);

        if (!leftClick.shift) {
          this.unitManager.deselectAll();
          this.buildingManager.deselectAll();
        }

        if (clicked && clicked.team === TEAM_BLUE) {
          clicked.selected = true;
          sfxSelect();
        } else if (clickedBuilding && clickedBuilding.team === TEAM_BLUE) {
          clickedBuilding.selected = true;
          sfxSelect();
        }
      }
    }

    // Right click commands
    const rightClick = this.input.consumeRightClick();
    if (rightClick) {
      const selected = this.unitManager.getSelected();
      if (selected.length > 0) {
        const worldPos = this.camera.screenToWorld(rightClick.x, rightClick.y);
        const tileX = Math.floor(worldPos.x / TILE_SIZE);
        const tileY = Math.floor(worldPos.y / TILE_SIZE);

        const targetUnit = this.unitManager.getUnitAtScreen(rightClick.x, rightClick.y, this.camera);
        const targetBuilding = this.buildingManager.getBuildingAtScreen(rightClick.x, rightClick.y, this.camera);

        if (targetUnit && targetUnit.team !== TEAM_BLUE) {
          for (const unit of selected) {
            unit.attackTarget(targetUnit, this.map);
          }
          sfxMove();
        } else if (targetBuilding && targetBuilding.team !== TEAM_BLUE) {
          for (const unit of selected) {
            unit.attackBuilding(targetBuilding, this.map);
          }
          sfxMove();
        } else if (targetBuilding && targetBuilding.team === TEAM_BLUE && !targetBuilding.built) {
          const workers = selected.filter(u => u.type === 'worker');
          for (const w of workers) {
            w.buildBuilding(targetBuilding, this.map);
          }
          if (workers.length > 0) sfxMove();
        } else if (this.map.getTile(tileX, tileY) === TILE_MINERAL || this.map.getTile(tileX, tileY) === TILE_TREE) {
          const workers = selected.filter(u => u.type === 'worker');
          const others = selected.filter(u => u.type !== 'worker' && !u.naval);

          for (const w of workers) {
            w.gatherFrom(tileX, tileY, this.map, this.buildingManager.buildings);
          }
          for (const f of others) {
            f.moveTo(this.map, tileX, tileY);
          }
          sfxMove();

          this.renderer.addMoveMarker(
            tileX * TILE_SIZE + TILE_SIZE / 2,
            tileY * TILE_SIZE + TILE_SIZE / 2
          );
        } else if (this.map.isSwimmable(tileX, tileY)) {
          // Water tile clicked — move naval units
          const navalSelected = selected.filter(u => u.naval);
          for (const u of navalSelected) {
            u.moveTo(this.map, tileX, tileY);
          }
          if (navalSelected.length > 0) {
            sfxMove();
            this.renderer.addMoveMarker(
              tileX * TILE_SIZE + TILE_SIZE / 2,
              tileY * TILE_SIZE + TILE_SIZE / 2
            );
          }
        } else if (this.map.isWalkable(tileX, tileY)) {
          // Move command with formation (land units only)
          const landSelected = selected.filter(u => !u.naval);
          const count = landSelected.length;
          if (count > 0) {
            const cols = Math.ceil(Math.sqrt(count));

            for (let i = 0; i < landSelected.length; i++) {
              const offsetX = (i % cols) - Math.floor(cols / 2);
              const offsetY = Math.floor(i / cols) - Math.floor(count / cols / 2);
              let tx = tileX + offsetX;
              let ty = tileY + offsetY;
              tx = Math.max(0, Math.min(MAP_WIDTH - 1, tx));
              ty = Math.max(0, Math.min(MAP_HEIGHT - 1, ty));
              if (!this.map.isWalkable(tx, ty)) {
                tx = tileX;
                ty = tileY;
              }
              landSelected[i].moveTo(this.map, tx, ty);
            }

            sfxMove();
            this.renderer.addMoveMarker(
              tileX * TILE_SIZE + TILE_SIZE / 2,
              tileY * TILE_SIZE + TILE_SIZE / 2
            );
          }
        }
      }
    }
  }

  _onKeyDown(e) {
    const key = e.key.toLowerCase();

    if (key === 'escape') {
      this.buildMode = null;
      return;
    }

    const selected = this.unitManager.getSelected();
    const selectedBuildings = this.buildingManager.buildings.filter(b => b.selected && b.team === TEAM_BLUE);
    const hasWorker = selected.some(u => u.type === 'worker');
    const res = this.resources[TEAM_BLUE];

    // Build hotkeys (from worker OR from HQ building)
    const selectedHQ = selectedBuildings.find(b => b.type === 'base' && b.built);

    if (hasWorker || selectedHQ) {
      for (const [bType, bDef] of Object.entries(BUILDING_DEFS)) {
        if (bDef.hotkey === key && bDef.hotkey !== undefined) {
          if (this.canAfford(TEAM_BLUE, bDef.cost)) {
            this.buildMode = bType;
          } else {
            sfxError();
          }
          return;
        }
      }
    }

    // Training hotkeys from selected buildings
    for (const b of selectedBuildings) {
      const def = BUILDING_DEFS[b.type];
      for (const unitType of def.produces) {
        const unitDef = UNIT_DEFS[unitType];
        if (unitDef && unitDef.hotkey === key) {
          if (b.canTrain(unitType, res)) {
            this.spend(TEAM_BLUE, b.train(unitType));
          } else {
            sfxError();
          }
          return;
        }
      }
    }
  }

  handleHudAction(action) {
    if (action === 'cancel') {
      this.buildMode = null;
      return;
    }
    if (action.startsWith('build:')) {
      const type = action.split(':')[1];
      const def = BUILDING_DEFS[type];
      if (def && this.canAfford(TEAM_BLUE, def.cost)) {
        this.buildMode = type;
      } else {
        sfxError();
      }
    } else if (action.startsWith('train:')) {
      const parts = action.split(':');
      const unitType = parts[1];
      const buildingId = parseInt(parts[2]);
      const building = this.buildingManager.buildings.find(b => b.id === buildingId);
      if (building && building.canTrain(unitType, this.resources[TEAM_BLUE])) {
        this.spend(TEAM_BLUE, building.train(unitType));
      } else {
        sfxError();
      }
    }
  }

  resize(w, h) {
    this.camera.resize(w, h);
  }
}
