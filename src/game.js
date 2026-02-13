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
import { initAudio, setSoundAudibilityChecker, sfxSelect, sfxMove, sfxBuild, sfxError } from './audio.js';

export class Game {
  constructor(canvas, difficulty = 'normal', options = {}) {
    this.canvas = canvas;
    this.difficulty = difficulty;
    this.mode = 'singleplayer';
    this.debugShowAll = !!options.debugShowAll;
    this.alliedAiMode = !!options.alliedAiMode;
    this.combatFrozen = !!options.combatFrozen;
    this.enemyTeams = this._enemyTeamsForDifficulty(difficulty);

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

    // Always spawn all AI teams in single-player; difficulty only changes behavior.
    this.ais = this.enemyTeams.map(t => new SimpleAI(t, difficulty));

    this._configureAiBehaviors(difficulty);

    // Apply hard-mode resource bonus to AI
    for (const ai of this.ais) {
      if (ai.startBonus > 0) {
        this.resources[ai.team].minerals += ai.startBonus;
        this.resources[ai.team].wood += ai.startBonus;
      }
    }

    // Build mode
    this.buildMode = null;

    // Spawn initial setup
    this._spawnStartingSetup();

    // Center camera on player start
    this.camera.centerOn(15 * TILE_SIZE, 15 * TILE_SIZE);

    // Audio
    initAudio();

    // Keyboard listener for build hotkeys
    window.addEventListener('keydown', (e) => this._onKeyDown(e));

    this.running = true;
    this.paused = false;
    this.lastTime = 0;
    this.gameTime = 0;
    this.ended = false;
    this.winnerTeam = null;
    this.defeatedTeams = new Set();

    // Fog of war (single-player perspective: TEAM_BLUE)
    this.fogEnabled = !this.debugShowAll;
    this.fogVisible = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    this.fogExplored = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    this._recomputeFog();
    setSoundAudibilityChecker((wx, wy) => this._isSoundAudibleWorld(wx, wy));
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
      { team: TEAM_BLUE, baseX: 12, baseY: 12 },
      { team: TEAM_RED, baseX: MAP_WIDTH - 18, baseY: 12 },
      { team: TEAM_GREEN, baseX: 12, baseY: MAP_HEIGHT - 18 },
      { team: TEAM_YELLOW, baseX: MAP_WIDTH - 18, baseY: MAP_HEIGHT - 18 },
    ];
    const activeTeams = new Set([TEAM_BLUE, ...this.enemyTeams]);

    for (const { team, baseX, baseY } of corners) {
      if (!activeTeams.has(team)) continue;
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

    if (!this.paused) {
      this._handleInput();
      this._update(dt);
      this.renderer.updateMoveMarkers(dt);
      this.renderer.updateParticles(dt);
    }
    this.renderer.render(this);

    requestAnimationFrame((t) => this._loop(t));
  }

  _update(dt) {
    if (this.ended) return;

    // Tick down thaw cooldown (used to stagger AI after unfreezing combat)
    if (this._thawCooldown > 0) this._thawCooldown -= dt;

    // Update units
    const deaths = this.unitManager.update(dt, this.map, this.buildingManager.buildings, (a, b) => this.isHostile(a, b));

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
    const { produced, destroyed } = this.buildingManager.update(dt, this.unitManager.units, (a, b) => this.isHostile(a, b));

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

    // Spawn produced units — assemble in ordered ring around building
    for (const p of produced) {
      let spawnX = Math.floor(p.x / TILE_SIZE);
      let spawnY = Math.floor(p.y / TILE_SIZE);
      let found = false;
      const isNaval = UNIT_DEFS[p.unitType] && UNIT_DEFS[p.unitType].naval;

      // Try expanding rings around the building perimeter
      for (let d = 1; d <= 5 && !found; d++) {
        const ring = this._getBuildingRingPositions(p.bTileX, p.bTileY, p.bSize, d);
        for (const pos of ring) {
          const tileOk = isNaval ? this.map.isSwimmable(pos.x, pos.y) : this.map.isWalkable(pos.x, pos.y);
          if (tileOk && !this.buildingManager.getBuildingAtTile(pos.x, pos.y) &&
              !this._isTileOccupiedByUnit(pos.x, pos.y)) {
            spawnX = pos.x;
            spawnY = pos.y;
            found = true;
            break;
          }
        }
      }

      const unit = new Unit(spawnX, spawnY, p.unitType, p.team);
      this.unitManager.add(unit);
    }

    // AI — update all 3 opponents
    for (const ai of this.ais) {
      ai.update(dt, this);
    }

    this._checkBaseWinCondition();

    this.gameTime += dt;

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
    this._recomputeFog();
  }

  _handleInput() {
    if (this.ended) return;

    // Minimap right-click should issue move command, not camera jump.
    const peekRight = this.input.rightClick;
    if (peekRight) {
      const mmWorldR = this.renderer.screenToMinimapWorld(peekRight.x, peekRight.y);
      if (mmWorldR) {
        this.input.consumeRightClick();
        const selected = this.unitManager.getSelected();
        if (selected.length > 0) {
          const tileX = Math.floor(mmWorldR.worldX / TILE_SIZE);
          const tileY = Math.floor(mmWorldR.worldY / TILE_SIZE);
          const clampedX = Math.max(0, Math.min(MAP_WIDTH - 1, tileX));
          const clampedY = Math.max(0, Math.min(MAP_HEIGHT - 1, tileY));

          const landSelected = selected.filter(u => !u.naval);
          const navalSelected = selected.filter(u => u.naval);
          const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, landSelected.length))));

          for (let i = 0; i < landSelected.length; i++) {
            const offsetX = (i % cols) - Math.floor(cols / 2);
            const offsetY = Math.floor(i / cols) - Math.floor(landSelected.length / cols / 2);
            let tx = Math.max(0, Math.min(MAP_WIDTH - 1, clampedX + offsetX));
            let ty = Math.max(0, Math.min(MAP_HEIGHT - 1, clampedY + offsetY));
            if (!this.map.isWalkable(tx, ty)) {
              tx = clampedX;
              ty = clampedY;
            }
            landSelected[i].moveTo(this.map, tx, ty);
          }
          for (const u of navalSelected) {
            if (this.map.isSwimmable(clampedX, clampedY)) {
              u.moveTo(this.map, clampedX, clampedY);
            }
          }

          if (landSelected.length > 0 || navalSelected.length > 0) {
            sfxMove();
            this.renderer.addMoveMarker(
              clampedX * TILE_SIZE + TILE_SIZE / 2,
              clampedY * TILE_SIZE + TILE_SIZE / 2
            );
          }
        }
        // Swallow any simultaneous minimap left-click that could center camera.
        const peekLeftAfter = this.input.leftClick;
        if (peekLeftAfter && !peekLeftAfter.box) {
          const mmWorldL = this.renderer.screenToMinimapWorld(peekLeftAfter.x, peekLeftAfter.y);
          if (mmWorldL) this.input.consumeLeftClick();
        }
        return;
      }
    }

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
          if ((leftClick.clickCount || 1) >= 2) {
            this._selectVisibleSameTypeUnits(clicked.type, TEAM_BLUE);
          } else {
            clicked.selected = true;
          }
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
        const mmWorld = this.renderer.screenToMinimapWorld(rightClick.x, rightClick.y);
        const worldPos = mmWorld || this.camera.screenToWorld(rightClick.x, rightClick.y);
        const tileX = Math.floor(worldPos.x / TILE_SIZE);
        const tileY = Math.floor(worldPos.y / TILE_SIZE);

        // Minimap right-click: always treat as move order to that world location.
        if (mmWorld) {
          const clampedX = Math.max(0, Math.min(MAP_WIDTH - 1, tileX));
          const clampedY = Math.max(0, Math.min(MAP_HEIGHT - 1, tileY));
          const landSelected = selected.filter(u => !u.naval);
          const navalSelected = selected.filter(u => u.naval);
          const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, landSelected.length))));

          for (let i = 0; i < landSelected.length; i++) {
            const offsetX = (i % cols) - Math.floor(cols / 2);
            const offsetY = Math.floor(i / cols) - Math.floor(landSelected.length / cols / 2);
            let tx = Math.max(0, Math.min(MAP_WIDTH - 1, clampedX + offsetX));
            let ty = Math.max(0, Math.min(MAP_HEIGHT - 1, clampedY + offsetY));
            if (!this.map.isWalkable(tx, ty)) {
              tx = clampedX;
              ty = clampedY;
            }
            landSelected[i].moveTo(this.map, tx, ty);
          }
          for (const u of navalSelected) {
            if (this.map.isSwimmable(clampedX, clampedY)) {
              u.moveTo(this.map, clampedX, clampedY);
            }
          }

          if (landSelected.length > 0 || navalSelected.length > 0) {
            sfxMove();
            this.renderer.addMoveMarker(
              clampedX * TILE_SIZE + TILE_SIZE / 2,
              clampedY * TILE_SIZE + TILE_SIZE / 2
            );
          }
          return;
        }

        const targetUnit = this.unitManager.getUnitAtScreen(rightClick.x, rightClick.y, this.camera);
        const targetBuilding = this.buildingManager.getBuildingAtScreen(rightClick.x, rightClick.y, this.camera);
        const canSeeUnit = targetUnit ? this.isWorldVisible(targetUnit.x, targetUnit.y) : false;
        const canSeeBuilding = targetBuilding ? this.isWorldVisible(targetBuilding.x, targetBuilding.y) : false;

        if (targetUnit && this.isHostile(TEAM_BLUE, targetUnit.team) && canSeeUnit) {
          for (const unit of selected) {
            unit.attackTarget(targetUnit, this.map);
          }
          sfxMove();
        } else if (targetBuilding && this.isHostile(TEAM_BLUE, targetBuilding.team) && canSeeBuilding) {
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
    // Ignore game hotkeys when typing in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key.toLowerCase();

    if (key === 'escape') {
      this.buildMode = null;
      return;
    }

    if (key === 'p') {
      this.togglePause();
      return;
    }

    // Theme hotkeys
    if (key === '1') { this.switchTheme('verdant'); return; }
    if (key === '2') { this.switchTheme('obsidian'); return; }
    if (key === '3') { this.switchTheme('frozen'); return; }

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

  switchTheme(theme) {
    this.sprites.generate(theme);
  }

  togglePause() {
    this.paused = !this.paused;
  }

  setDifficulty(difficulty) {
    if (this.ended) return;
    this.difficulty = difficulty;
    for (const ai of this.ais) {
      ai.setDifficulty(difficulty);
    }
    this._configureAiBehaviors(difficulty);
  }

  setAlliedAiMode(enabled) {
    if (this.ended) return;
    this.alliedAiMode = !!enabled;
    this._sanitizeCombatTargets();
  }

  setCombatFrozen(enabled) {
    if (this.ended) return;
    const wasFrozen = this.combatFrozen;
    this.combatFrozen = !!enabled;
    this._sanitizeCombatTargets();

    // When unfreezing, de-stack overlapping units and stagger combat activation
    if (wasFrozen && !this.combatFrozen) {
      this._thawCooldown = 3.0;
      this._deStackUnits();
      for (const u of this.unitManager.units) {
        if (u.type === 'worker') continue;
        u.commandLockTimer = Math.random() * 3.0;
        u.path = [];
      }
    }
  }

  // Spread overlapping units to unique tiles so they don't fight over the same space
  _deStackUnits() {
    const occupied = new Set();

    // Mark building tiles as occupied
    for (const b of this.buildingManager.buildings) {
      if (b.hp <= 0) continue;
      const bx = b.tileX;
      const by = b.tileY;
      for (let dy = 0; dy < b.sizeTiles; dy++) {
        for (let dx = 0; dx < b.sizeTiles; dx++) {
          occupied.add(`${bx + dx},${by + dy}`);
        }
      }
    }

    for (const u of this.unitManager.units) {
      if (u.flying) continue;
      const key = `${u.tileX},${u.tileY}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        continue;
      }
      // Unit is overlapping - find nearest free walkable tile
      for (let r = 1; r <= 15; r++) {
        let found = false;
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const nx = u.tileX + dx;
            const ny = u.tileY + dy;
            const nkey = `${nx},${ny}`;
            if (occupied.has(nkey)) continue;
            const walkable = u.naval
              ? this.map.isSwimmable(nx, ny)
              : this.map.isWalkable(nx, ny);
            if (walkable) {
              u.x = nx * TILE_SIZE + TILE_SIZE / 2;
              u.y = ny * TILE_SIZE + TILE_SIZE / 2;
              u.tileX = nx;
              u.tileY = ny;
              occupied.add(nkey);
              found = true;
            }
          }
        }
        if (found) break;
      }
    }
  }

  isHostile(teamA, teamB) {
    if (this.combatFrozen) return false;
    if (teamA === teamB) return false;
    if (this.alliedAiMode && teamA !== TEAM_BLUE && teamB !== TEAM_BLUE) return false;
    return true;
  }

  _sanitizeCombatTargets() {
    for (const u of this.unitManager.units) {
      if (u.target && !this.isHostile(u.team, u.target.team)) {
        u.target = null;
      }
      if (u.targetBld && !this.isHostile(u.team, u.targetBld.team)) {
        u.targetBld = null;
      }
      if ((u.state === 'attacking' && !u.target) || (u.state === 'attackingBuilding' && !u.targetBld)) {
        u.state = 'idle';
      }
    }
    for (const b of this.buildingManager.buildings) {
      if (b.attackTarget && !this.isHostile(b.team, b.attackTarget.team)) {
        b.attackTarget = null;
      }
    }
  }

  _enemyTeamsForDifficulty(difficulty) {
    return [TEAM_RED, TEAM_GREEN, TEAM_YELLOW];
  }

  _configureAiBehaviors(difficulty) {
    // Make all AI use copycat behavior so they are consistently competitive.
    let multipliers = [1.0, 1.0, 1.05];
    if (difficulty === 'normal') {
      multipliers = [1.05, 1.1, 1.15];
    } else if (difficulty === 'hard') {
      multipliers = [1.15, 1.22, 1.3];
    }
    for (let i = 0; i < this.ais.length; i++) {
      const ai = this.ais[i];
      ai.copycatTarget = TEAM_BLUE;
      ai.copycatMultiplier = multipliers[i] || multipliers[multipliers.length - 1];
    }
  }

  _teamHasBase(team) {
    return this.buildingManager.buildings.some((b) => b.team === team && b.type === 'base' && b.hp > 0);
  }

  _teamHasWorkers(team) {
    return this.unitManager.units.some((u) => u.team === team && u.type === 'worker' && u.hp > 0);
  }

  _eliminateTeam(team) {
    this.unitManager.units = this.unitManager.units.filter((u) => u.team !== team);
    this.buildingManager.buildings = this.buildingManager.buildings.filter((b) => b.team !== team);
    this.ais = this.ais.filter((ai) => ai.team !== team);
    this.defeatedTeams.add(team);
    this._sanitizeCombatTargets();
  }

  _checkBaseWinCondition() {
    const teams = [TEAM_BLUE, ...this.enemyTeams];
    for (const team of teams) {
      const noBase = !this._teamHasBase(team);
      const noWorkers = !this._teamHasWorkers(team);
      if (!this.defeatedTeams.has(team) && noBase && noWorkers) {
        this._eliminateTeam(team);
      }
    }

    const aliveTeams = teams.filter((team) => !this.defeatedTeams.has(team));
    const aliveAiTeams = this.enemyTeams.filter((team) => !this.defeatedTeams.has(team));

    if (this.defeatedTeams.has(TEAM_BLUE)) {
      this.ended = true;
      this.winnerTeam = aliveAiTeams.length === 1 ? aliveAiTeams[0] : null;
      this.paused = true;
      return;
    }

    if (aliveAiTeams.length === 0 && !this.defeatedTeams.has(TEAM_BLUE)) {
      this.ended = true;
      this.winnerTeam = TEAM_BLUE;
      this.paused = true;
      return;
    }

    if (aliveTeams.length <= 1) {
      this.ended = true;
      this.winnerTeam = aliveTeams.length === 1 ? aliveTeams[0] : null;
      this.paused = true;
    }
  }

  resize(w, h) {
    this.camera.resize(w, h);
  }

  // Generate ordered ring positions around a building perimeter at distance d
  _getBuildingRingPositions(bx, by, s, d) {
    const positions = [];
    const minX = bx - d;
    const maxX = bx + s - 1 + d;
    const minY = by - d;
    const maxY = by + s - 1 + d;

    // Bottom edge (left to right)
    for (let x = minX; x <= maxX; x++) positions.push({ x, y: maxY });
    // Right edge (bottom-1 to top)
    for (let y = maxY - 1; y >= minY; y--) positions.push({ x: maxX, y });
    // Top edge (right-1 to left)
    for (let x = maxX - 1; x >= minX; x--) positions.push({ x, y: minY });
    // Left edge (top+1 to bottom-1)
    for (let y = minY + 1; y < maxY; y++) positions.push({ x: minX, y });

    // Sort by distance from building's south-center exit so units fill near the door first
    const exitX = bx + s / 2;
    const exitY = by + s;
    positions.sort((a, b) => {
      const da = (a.x - exitX) ** 2 + (a.y - exitY) ** 2;
      const db = (b.x - exitX) ** 2 + (b.y - exitY) ** 2;
      return da - db;
    });

    return positions;
  }

  // Check if a tile is already occupied by a living unit
  _isTileOccupiedByUnit(tx, ty) {
    for (const u of this.unitManager.units) {
      if (u.hp <= 0) continue;
      const ux = Math.floor(u.x / TILE_SIZE);
      const uy = Math.floor(u.y / TILE_SIZE);
      if (ux === tx && uy === ty) return true;
    }
    return false;
  }

  // --- Save / Load ---

  saveToSlot(slotName) {
    try {
      const save = {
        version: 2,
        name: slotName,
        timestamp: Date.now(),
        seed: this.map.seed,
        difficulty: this.difficulty,
        alliedAiMode: this.alliedAiMode,
        combatFrozen: this.combatFrozen,
        ended: this.ended,
        winnerTeam: this.winnerTeam,
        defeatedTeams: Array.from(this.defeatedTeams),
        gameTime: this.gameTime,
        resources: this.resources,
        camera: { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom },
        mineralAmounts: Array.from(this.map.mineralAmounts.entries()),
        woodAmounts: Array.from(this.map.woodAmounts.entries()),
        mapTiles: Array.from(this.map.tiles),
        fogEnabled: this.fogEnabled,
        fogVisible: Array.from(this.fogVisible),
        fogExplored: Array.from(this.fogExplored),
        buildings: this.buildingManager.buildings.map(b => ({
          id: b.id, tileX: b.tileX, tileY: b.tileY, type: b.type, team: b.team,
          hp: b.hp, built: b.built, buildProgress: b.buildProgress, constructionQueued: !!b.constructionQueued,
          trainQueue: b.trainQueue.map(q => ({ type: q.type, timeLeft: q.timeLeft })),
          rallyX: b.rallyX, rallyY: b.rallyY,
        })),
        units: this.unitManager.units.map(u => ({
          type: u.type, team: u.team, x: u.x, y: u.y, hp: u.hp,
          state: u.state, carrying: u.carrying, carryType: u.carryType,
          gatherTarget: u.gatherTarget, buildTimer: u.buildTimer,
          buildTargetId: u.buildTarget ? u.buildTarget.id : null,
          buildQueueIds: Array.isArray(u.buildQueue) ? u.buildQueue.map(b => b.id) : [],
        })),
        ai: this.ais.map(a => ({
          team: a.team, timer: a.timer, waveTimer: a.waveTimer,
          hasBuiltBarracks: a.hasBuiltBarracks,
          hasBuiltFactory: a.hasBuiltFactory,
          hasBuiltDock: a.hasBuiltDock,
          towerCount: a.towerCount,
        })),
      };
      localStorage.setItem('microRts_' + slotName, JSON.stringify(save));
      // Update save index
      const index = Game.getSaveIndex();
      if (!index.includes(slotName)) index.push(slotName);
      localStorage.setItem('microRts_index', JSON.stringify(index));
      return true;
    } catch (e) {
      console.warn('Save failed:', e);
      return false;
    }
  }

  static getSaveIndex() {
    try {
      return JSON.parse(localStorage.getItem('microRts_index') || '[]');
    } catch { return []; }
  }

  static getSaveList() {
    const index = Game.getSaveIndex();
    const saves = [];
    for (const name of index) {
      try {
        const raw = localStorage.getItem('microRts_' + name);
        if (!raw) continue;
        const save = JSON.parse(raw);
        const age = Date.now() - save.timestamp;
        const mins = Math.floor(age / 60000);
        const gameMin = Math.floor((save.gameTime || 0) / 60);
        saves.push({ name, timestamp: save.timestamp, mins, gameMin, difficulty: save.difficulty });
      } catch { /* skip corrupt */ }
    }
    saves.sort((a, b) => b.timestamp - a.timestamp);
    return saves;
  }

  static deleteSave(slotName) {
    localStorage.removeItem('microRts_' + slotName);
    const index = Game.getSaveIndex().filter(n => n !== slotName);
    localStorage.setItem('microRts_index', JSON.stringify(index));
  }

  loadFromSlot(slotName) {
    try {
      const raw = localStorage.getItem('microRts_' + slotName);
      if (!raw) return false;
      const save = JSON.parse(raw);
      if (save.version !== 1 && save.version !== 2) return false;

      // Restore map from seed, then overwrite tiles and resource amounts
      this.map = new GameMap(save.seed);
      if (save.mapTiles) {
        this.map.tiles = new Uint8Array(save.mapTiles);
      }
      this.map.mineralAmounts = new Map(save.mineralAmounts);
      this.map.woodAmounts = new Map(save.woodAmounts);

      this.fogEnabled = save.fogEnabled !== undefined ? !!save.fogEnabled : !this.debugShowAll;
      if (Array.isArray(save.fogVisible) && Array.isArray(save.fogExplored)) {
        this.fogVisible = new Uint8Array(save.fogVisible);
        this.fogExplored = new Uint8Array(save.fogExplored);
      } else {
        this.fogVisible = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
        this.fogExplored = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
        this._recomputeFog();
      }

      // Restore resources
      this.resources = save.resources;

      // Restore difficulty
      this.difficulty = save.difficulty;
      this.alliedAiMode = !!save.alliedAiMode;
      this.combatFrozen = !!save.combatFrozen;
      this.ended = !!save.ended;
      this.winnerTeam = save.winnerTeam ?? null;
      this.defeatedTeams = new Set(Array.isArray(save.defeatedTeams) ? save.defeatedTeams : []);
      for (const ai of this.ais) ai.setDifficulty(save.difficulty);
      this._configureAiBehaviors(save.difficulty);

      // Restore camera
      this.camera.x = save.camera.x;
      this.camera.y = save.camera.y;
      this.camera.zoom = save.camera.zoom;

      // Restore buildings
      this.buildingManager.buildings = [];
      for (const bd of save.buildings) {
        const b = new Building(bd.tileX, bd.tileY, bd.type, bd.team);
        b.id = bd.id;
        b.hp = bd.hp;
        b.built = bd.built;
        b.buildProgress = bd.buildProgress;
        b.constructionQueued = !!bd.constructionQueued;
        b.trainQueue = bd.trainQueue || [];
        if (bd.rallyX != null) { b.rallyX = bd.rallyX; b.rallyY = bd.rallyY; }
        this.buildingManager.add(b);
      }

      // Restore units
      this.unitManager.units = [];
      for (const ud of save.units) {
        const tileX = Math.floor(ud.x / TILE_SIZE);
        const tileY = Math.floor(ud.y / TILE_SIZE);
        const u = new Unit(tileX, tileY, ud.type, ud.team);
        u.x = ud.x;
        u.y = ud.y;
        u.hp = ud.hp;
        u.carrying = ud.carrying || 0;
        u.carryType = ud.carryType || null;
        u.gatherTarget = ud.gatherTarget || null;
        u.buildTimer = ud.buildTimer || 0;
        // Reconnect build targets
        if (ud.buildTargetId != null) {
          u.buildTarget = this.buildingManager.buildings.find(b => b.id === ud.buildTargetId) || null;
          if (u.buildTarget) u.state = 'building';
        }
        if (Array.isArray(ud.buildQueueIds) && ud.buildQueueIds.length > 0) {
          u.buildQueue = ud.buildQueueIds
            .map(id => this.buildingManager.buildings.find(b => b.id === id))
            .filter(Boolean);
        }
        // Workers gathering go back to gathering state
        if (ud.state === 'gathering' && ud.gatherTarget) {
          u.state = 'gathering';
        } else if (ud.state === 'returning') {
          u.state = 'returning';
        } else {
          u.state = 'idle';
        }
        this.unitManager.add(u);
      }

      // Restore AI state
      if (save.ai) {
        for (const aState of save.ai) {
          const ai = this.ais.find(a => a.team === aState.team);
          if (ai) {
            ai.timer = aState.timer;
            ai.waveTimer = aState.waveTimer;
            ai.hasBuiltBarracks = aState.hasBuiltBarracks;
            ai.hasBuiltFactory = aState.hasBuiltFactory;
            ai.hasBuiltDock = aState.hasBuiltDock;
            ai.towerCount = aState.towerCount;
          }
        }
      }

      this.gameTime = save.gameTime || 0;
      this._sanitizeCombatTargets();
      this.renderer.minimapDirty = true;
      return true;
    } catch (e) {
      console.warn('Load failed:', e);
      return false;
    }
  }

  _selectVisibleSameTypeUnits(unitType, team) {
    for (const u of this.unitManager.units) {
      if (u.team !== team || u.type !== unitType) continue;
      const screen = this.camera.worldToScreen(u.x, u.y);
      if (screen.x >= 0 && screen.x <= this.canvas.width && screen.y >= 0 && screen.y <= this.canvas.height) {
        u.selected = true;
      }
    }
  }

  _tileIndex(tx, ty) {
    return ty * MAP_WIDTH + tx;
  }

  _markVisionCircle(cx, cy, radiusTiles) {
    const r2 = radiusTiles * radiusTiles;
    const minX = Math.max(0, cx - radiusTiles);
    const maxX = Math.min(MAP_WIDTH - 1, cx + radiusTiles);
    const minY = Math.max(0, cy - radiusTiles);
    const maxY = Math.min(MAP_HEIGHT - 1, cy + radiusTiles);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = this._tileIndex(x, y);
          this.fogVisible[i] = 1;
          this.fogExplored[i] = 1;
        }
      }
    }
  }

  _recomputeFog() {
    if (!this.fogEnabled) {
      this.fogVisible.fill(1);
      this.fogExplored.fill(1);
      return;
    }

    this.fogVisible.fill(0);

    const unitVision = {
      worker: 8,
      soldier: 10,
      tank: 11,
      rocket: 11,
      bomber: 13,
      battleship: 14,
    };

    const buildingVision = {
      base: 12,
      barracks: 10,
      factory: 10,
      dock: 12,
      tower: 14,
    };

    for (const u of this.unitManager.units) {
      if (u.team !== TEAM_BLUE || u.hp <= 0) continue;
      const tx = Math.floor(u.x / TILE_SIZE);
      const ty = Math.floor(u.y / TILE_SIZE);
      this._markVisionCircle(tx, ty, unitVision[u.type] || 6);
    }

    for (const b of this.buildingManager.buildings) {
      if (b.team !== TEAM_BLUE || b.hp <= 0) continue;
      const tx = Math.floor(b.x / TILE_SIZE);
      const ty = Math.floor(b.y / TILE_SIZE);
      this._markVisionCircle(tx, ty, buildingVision[b.type] || 7);
    }
  }

  isTileVisible(tx, ty) {
    if (!this.fogEnabled) return true;
    if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return false;
    return this.fogVisible[this._tileIndex(tx, ty)] === 1;
  }

  isTileExplored(tx, ty) {
    if (!this.fogEnabled) return true;
    if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return false;
    return this.fogExplored[this._tileIndex(tx, ty)] === 1;
  }

  isWorldVisible(wx, wy) {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    return this.isTileVisible(tx, ty);
  }

  _isSoundAudibleWorld(wx, wy) {
    const s = this.camera.worldToScreen(wx, wy);
    const pad = 24;
    const onScreen = s.x >= -pad && s.x <= this.canvas.width + pad &&
      s.y >= -pad && s.y <= this.canvas.height + pad;
    if (!onScreen) return false;
    return this.isWorldVisible(wx, wy);
  }
}
