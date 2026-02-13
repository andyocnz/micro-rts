import {
  TILE_SIZE,
  TEAM_BLUE,
  MAP_WIDTH,
  MAP_HEIGHT,
  TILE_MINERAL,
  TILE_TREE,
  BUILDING_DEFS,
  UNIT_DEFS,
} from '../shared/constants.js';
import { Camera } from './camera.js';
import { InputManager } from './input.js';
import { SpriteSheet } from './sprites.js';
import { Renderer } from './renderer.js';
import { SnapshotMap, ClientUnitManager, ClientBuildingManager } from './clientState.js';

export class MultiplayerGame {
  constructor(canvas, network) {
    this.canvas = canvas;
    this.network = network;

    this.localPlayerTeam = TEAM_BLUE;
    this.roomCode = null;
    this.status = 'WAITING';
    this.mode = 'multiplayer';
    this.paused = false;

    this.map = new SnapshotMap();
    this.camera = new Camera(canvas.width, canvas.height);
    this.input = new InputManager(canvas);
    this.unitManager = new ClientUnitManager();
    this.buildingManager = new ClientBuildingManager();

    this.sprites = new SpriteSheet();
    this.sprites.generate();
    this.renderer = new Renderer(canvas, this.sprites);

    this.resources = {};
    this.buildMode = null;
    this.running = true;
    this.lastTime = 0;

    // Client-side fog of war
    this.fogEnabled = true;
    this.fogVisible = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    this.fogExplored = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);

    window.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  setRoomContext({ roomCode, playerSlot, status, paused }) {
    if (roomCode) this.roomCode = roomCode;
    if (typeof playerSlot === 'number') this.localPlayerTeam = playerSlot;
    if (status) this.status = status;
    if (typeof paused === 'boolean') this.paused = paused;

    const home = this._getHomeCameraTarget(this.localPlayerTeam);
    this.camera.centerOn(home.x, home.y);
  }

  applySnapshot(snapshot) {
    const selectedUnits = new Set(this.unitManager.getSelected().map((u) => u.id));
    const selectedBuildings = new Set(this.buildingManager.buildings.filter((b) => b.selected).map((b) => b.id));

    this.map.apply(snapshot.map);
    this.resources = snapshot.resources || {};
    this.unitManager.applySnapshot(snapshot.units, selectedUnits);
    this.buildingManager.applySnapshot(snapshot.buildings, selectedBuildings);

    if (snapshot.ended) {
      this.status = 'ENDED';
    }

    this._recomputeFog();
    this.renderer.minimapDirty = true;
  }

  start() {
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _loop(timestamp) {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    if (this.status === 'RUNNING' && !this.paused) {
      this._handleInput();
      this.renderer.updateMoveMarkers(dt);
      this.renderer.updateParticles(dt);
    }

    this.camera.update(dt, this.input.keys, this.input.mouseX, this.input.mouseY);

    const scroll = this.input.consumeScroll();
    if (scroll !== 0) {
      this.camera.applyZoom(scroll, this.input.mouseX, this.input.mouseY);
    }

    const mmClick = this.input.consumeMinimapClick();
    if (mmClick) {
      this.camera.centerOn(mmClick.worldX, mmClick.worldY);
    }

    this.renderer.render(this);
    requestAnimationFrame((t) => this._loop(t));
  }

  getResources(team) {
    return this.resources[team] || { minerals: 0, wood: 0 };
  }

  _getHomeCameraTarget(team) {
    const cornerTile = {
      0: { x: 5, y: 5 },
      1: { x: MAP_WIDTH - 5, y: 5 },
      2: { x: 5, y: MAP_HEIGHT - 5 },
      3: { x: MAP_WIDTH - 5, y: MAP_HEIGHT - 5 },
    }[team] || { x: 5, y: 5 };

    return { x: cornerTile.x * TILE_SIZE, y: cornerTile.y * TILE_SIZE };
  }

  _onKeyDown(e) {
    if (this.status !== 'RUNNING') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key.toLowerCase();
    if (key === 'escape') {
      this.buildMode = null;
      return;
    }

    const selectedUnits = this.unitManager.getSelected().filter((u) => u.team === this.localPlayerTeam);
    const selectedBuildings = this.buildingManager.buildings.filter((b) => b.selected && b.team === this.localPlayerTeam);

    if (selectedUnits.some((u) => u.type === 'worker') || selectedBuildings.some((b) => b.type === 'base' && b.built)) {
      for (const [type, def] of Object.entries(BUILDING_DEFS)) {
        const hotkey = type === 'base' ? 'h' : type === 'barracks' ? 'b' : type === 'factory' ? 'f' : type === 'tower' ? 'd' : type === 'dock' ? 'n' : null;
        if (hotkey === key) {
          if (this.canAfford(this.localPlayerTeam, def.cost)) {
            this.buildMode = type;
          }
          return;
        }
      }
    }

    for (const b of selectedBuildings) {
      const bDef = BUILDING_DEFS[b.type];
      for (const unitType of bDef.produces) {
        const hotkey = unitType === 'worker' ? 'w' : unitType === 'soldier' ? 's' : unitType === 'tank' ? 't' : unitType === 'rocket' ? 'r' : unitType === 'bomber' ? 'h' : unitType === 'battleship' ? 'm' : null;
        if (hotkey === key) {
          this.network.sendCommand({ type: 'TRAIN', buildingId: b.id, unitType });
          return;
        }
      }
    }
  }

  _handleInput() {
    // Minimap right-click should issue move command, not camera jump.
    const peekRight = this.input.rightClick;
    if (peekRight) {
      const mmWorldR = this.renderer.screenToMinimapWorld(peekRight.x, peekRight.y);
      if (mmWorldR) {
        this.input.consumeRightClick();
        const selected = this.unitManager.getSelected().filter((u) => u.team === this.localPlayerTeam);
        if (selected.length > 0) {
          const tx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.floor(mmWorldR.worldX / TILE_SIZE)));
          const ty = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.floor(mmWorldR.worldY / TILE_SIZE)));
          this.network.sendCommand({ type: 'MOVE', unitIds: selected.map((u) => u.id), target: { x: tx, y: ty } });
          this.renderer.addMoveMarker(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
        }
        const peekLeftAfter = this.input.leftClick;
        if (peekLeftAfter && !peekLeftAfter.box) {
          const mmWorldL = this.renderer.screenToMinimapWorld(peekLeftAfter.x, peekLeftAfter.y);
          if (mmWorldL) this.input.consumeLeftClick();
        }
        return;
      }
    }

    const peekLeft = this.input.leftClick;
    if (peekLeft && !peekLeft.box) {
      const mmWorld = this.renderer.screenToMinimapWorld(peekLeft.x, peekLeft.y);
      if (mmWorld) {
        this.input.consumeLeftClick();
        this.camera.centerOn(mmWorld.worldX, mmWorld.worldY);
        return;
      }
    }

    if (this.buildMode) {
      const leftClick = this.input.consumeLeftClick();
      if (leftClick && !leftClick.box) {
        const worldPos = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const tileX = Math.floor(worldPos.x / TILE_SIZE);
        const tileY = Math.floor(worldPos.y / TILE_SIZE);
        const selectedWorker = this.unitManager.getSelected().find((u) => u.team === this.localPlayerTeam && u.type === 'worker');
        if (selectedWorker) {
          this.network.sendCommand({
            type: 'BUILD',
            buildingType: this.buildMode,
            tileX,
            tileY,
            builderUnitId: selectedWorker.id,
          });
          this.buildMode = null;
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

    const leftClick = this.input.consumeLeftClick();
    if (leftClick) {
      if (leftClick.box) {
        if (!leftClick.shift) {
          this.unitManager.deselectAll();
          this.buildingManager.deselectAll();
        }
        const units = this.unitManager.getUnitsInScreenBox(leftClick.box, this.camera, this.localPlayerTeam);
        for (const u of units) u.selected = true;
      } else {
        const clickedUnit = this.unitManager.getUnitAtScreen(leftClick.x, leftClick.y, this.camera);
        const clickedBuilding = this.buildingManager.getBuildingAtScreen(leftClick.x, leftClick.y, this.camera);

        if (!leftClick.shift) {
          this.unitManager.deselectAll();
          this.buildingManager.deselectAll();
        }

        if (clickedUnit && clickedUnit.team === this.localPlayerTeam) clickedUnit.selected = true;
        if (clickedUnit && clickedUnit.team === this.localPlayerTeam && (leftClick.clickCount || 1) >= 2) {
          this._selectVisibleSameTypeUnits(clickedUnit.type, this.localPlayerTeam);
        }
        if (clickedBuilding && clickedBuilding.team === this.localPlayerTeam) clickedBuilding.selected = true;
      }
    }

    const rightClick = this.input.consumeRightClick();
    if (!rightClick) return;

    const selected = this.unitManager.getSelected().filter((u) => u.team === this.localPlayerTeam);
    if (selected.length === 0) return;

    const mmWorld = this.renderer.screenToMinimapWorld(rightClick.x, rightClick.y);
    const worldPos = mmWorld || this.camera.screenToWorld(rightClick.x, rightClick.y);
    const tileX = Math.floor(worldPos.x / TILE_SIZE);
    const tileY = Math.floor(worldPos.y / TILE_SIZE);

    if (mmWorld) {
      const tx = Math.max(0, Math.min(MAP_WIDTH - 1, tileX));
      const ty = Math.max(0, Math.min(MAP_HEIGHT - 1, tileY));
      this.network.sendCommand({ type: 'MOVE', unitIds: selected.map((u) => u.id), target: { x: tx, y: ty } });
      this.renderer.addMoveMarker(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
      return;
    }

    const targetUnit = this.unitManager.getUnitAtScreen(rightClick.x, rightClick.y, this.camera);
    const targetBuilding = this.buildingManager.getBuildingAtScreen(rightClick.x, rightClick.y, this.camera);

    if (targetUnit && targetUnit.team !== this.localPlayerTeam) {
      this.network.sendCommand({ type: 'ATTACK', unitIds: selected.map((u) => u.id), targetUnitId: targetUnit.id });
      return;
    }

    if (targetBuilding && targetBuilding.team !== this.localPlayerTeam) {
      this.network.sendCommand({ type: 'ATTACK', unitIds: selected.map((u) => u.id), targetBuildingId: targetBuilding.id });
      return;
    }

    if (targetBuilding && targetBuilding.team === this.localPlayerTeam && !targetBuilding.built) {
      const workers = selected.filter((u) => u.type === 'worker').map((u) => u.id);
      if (workers.length > 0) {
        this.network.sendCommand({ type: 'BUILD_RESUME', unitIds: workers, buildingId: targetBuilding.id });
        return;
      }
    }

    if (this.map.getTile(tileX, tileY) === TILE_MINERAL || this.map.getTile(tileX, tileY) === TILE_TREE) {
      const workers = selected.filter((u) => u.type === 'worker').map((u) => u.id);
      if (workers.length > 0) {
        this.network.sendCommand({ type: 'HARVEST', unitIds: workers, target: { x: tileX, y: tileY } });
      }

      const fighters = selected.filter((u) => u.type !== 'worker').map((u) => u.id);
      if (fighters.length > 0) {
        this.network.sendCommand({ type: 'MOVE', unitIds: fighters, target: { x: tileX, y: tileY } });
      }

      this.renderer.addMoveMarker(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + TILE_SIZE / 2);
      return;
    }

    this.network.sendCommand({ type: 'MOVE', unitIds: selected.map((u) => u.id), target: { x: tileX, y: tileY } });
    this.renderer.addMoveMarker(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + TILE_SIZE / 2);
  }

  handleHudAction(action) {
    if (action === 'cancel') {
      this.buildMode = null;
      return;
    }

    if (action.startsWith('build:')) {
      const type = action.split(':')[1];
      const def = BUILDING_DEFS[type];
      if (def && this.canAfford(this.localPlayerTeam, def.cost)) {
        this.buildMode = type;
      }
      return;
    }

    if (action.startsWith('train:')) {
      const [, unitType, buildingIdStr] = action.split(':');
      const buildingId = Number(buildingIdStr);
      this.network.sendCommand({ type: 'TRAIN', buildingId, unitType });
    }
  }

  canAfford(team, cost) {
    const res = this.resources[team];
    if (!res) return false;
    return res.minerals >= (cost.minerals || 0) && res.wood >= (cost.wood || 0);
  }

  isHostile(teamA, teamB) { return teamA !== teamB; }

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

    const unitVision = { worker: 8, soldier: 10, tank: 11, rocket: 11, bomber: 13, battleship: 14 };
    const buildingVision = { base: 12, barracks: 10, factory: 10, dock: 12, tower: 14 };

    for (const u of this.unitManager.units) {
      if (u.team !== this.localPlayerTeam || u.hp <= 0) continue;
      const tx = Math.floor(u.x / TILE_SIZE);
      const ty = Math.floor(u.y / TILE_SIZE);
      this._markVisionCircle(tx, ty, unitVision[u.type] || 6);
    }

    for (const b of this.buildingManager.buildings) {
      if (b.team !== this.localPlayerTeam || b.hp <= 0) continue;
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

  switchTheme(theme) {
    this.sprites.generate(theme);
    this.renderer.minimapDirty = true;
  }

  resize(w, h) {
    this.camera.resize(w, h);
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
}
