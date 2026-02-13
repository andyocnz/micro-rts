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
          this.buildMode = type;
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

    const worldPos = this.camera.screenToWorld(rightClick.x, rightClick.y);
    const tileX = Math.floor(worldPos.x / TILE_SIZE);
    const tileY = Math.floor(worldPos.y / TILE_SIZE);

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
      this.buildMode = action.split(':')[1];
      return;
    }

    if (action.startsWith('train:')) {
      const [, unitType, buildingIdStr] = action.split(':');
      const buildingId = Number(buildingIdStr);
      this.network.sendCommand({ type: 'TRAIN', buildingId, unitType });
    }
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
