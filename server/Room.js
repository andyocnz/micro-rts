import crypto from 'node:crypto';
import { GameEngine } from '../shared/GameEngine.js';
import { processCommand } from '../shared/CommandProcessor.js';
import { ServerAI } from '../shared/ServerAI.js';

const TICK_MS = 100;
const RECONNECT_GRACE_MS = 30000;

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

export class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.maxPlayers = 4;
    this.players = new Array(this.maxPlayers).fill(null);
    this.status = 'WAITING';
    this.hostSlot = 0;
    this.engine = null;
    this.commandQueue = [];
    this.intervalRef = null;
    this.onEmpty = onEmpty;
    this.aiSlots = new Map(); // slot -> ServerAI instance (created on game start)
    this.aiDifficulty = new Map(); // slot -> difficulty string (set in lobby)
    this.paused = false;
    this.savedSnapshot = null;
  }

  serializePlayers() {
    return this.players.map((p, slot) => {
      if (!p) {
        const aiDiff = this.aiDifficulty.get(slot);
        return { slot, occupied: !!aiDiff, isAI: !!aiDiff, aiDifficulty: aiDiff || null };
      }
      return {
        slot,
        occupied: true,
        isAI: false,
        playerId: p.id,
        connected: p.connected,
        isHost: slot === this.hostSlot,
        team: p.team,
        name: p.name,
        icon: p.icon,
      };
    });
  }

  getConnectedCount() {
    return this.players.filter((p) => p && p.connected).length;
  }

  getOccupiedCount() {
    return this.players.filter(Boolean).length;
  }

  isFull() {
    return this.getOccupiedCount() + this.aiDifficulty.size >= this.maxPlayers;
  }

  findPlayerById(playerId) {
    for (let slot = 0; slot < this.players.length; slot++) {
      const p = this.players[slot];
      if (p && p.id === playerId) return { slot, player: p };
    }
    return null;
  }

  addPlayer(ws) {
    const slot = this.players.findIndex((p, i) => p === null && !this.aiDifficulty.has(i));
    if (slot === -1) return null;

    const player = {
      id: randomId('p'),
      reconnectToken: randomId('rt'),
      team: slot,
      ws,
      connected: true,
      disconnectTimer: null,
      disconnectedAt: null,
      name: null,
      icon: null,
    };

    this.players[slot] = player;
    this._broadcastRoomUpdate();
    return { slot, player };
  }

  setSlotAI(slot, difficulty) {
    if (slot < 0 || slot >= this.maxPlayers) return false;
    if (this.status !== 'WAITING') return false;
    if (this.players[slot]) return false; // occupied by human
    this.aiDifficulty.set(slot, difficulty);
    this._broadcastRoomUpdate();
    return true;
  }

  removeSlotAI(slot) {
    if (slot < 0 || slot >= this.maxPlayers) return false;
    if (this.status !== 'WAITING') return false;
    this.aiDifficulty.delete(slot);
    this._broadcastRoomUpdate();
    return true;
  }

  setPlayerInfo(playerId, name, icon) {
    const found = this.findPlayerById(playerId);
    if (!found) return false;
    const { player } = found;
    if (typeof name === 'string') player.name = name.slice(0, 12);
    if (typeof icon === 'string') player.icon = icon.slice(0, 4);
    this._broadcastRoomUpdate();
    return true;
  }

  tryRejoin(ws, playerId, reconnectToken) {
    const found = this.findPlayerById(playerId);
    if (!found) return null;
    const { slot, player } = found;

    if (player.reconnectToken !== reconnectToken) return null;

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }

    player.ws = ws;
    player.connected = true;
    player.disconnectedAt = null;

    safeSend(player.ws, {
      type: 'REJOINED',
      roomCode: this.code,
      playerId: player.id,
      playerSlot: slot,
      players: this.serializePlayers(),
      status: this.status,
      paused: this.paused,
      hasSave: !!this.savedSnapshot,
      reconnectToken: player.reconnectToken,
    });

    if (this.engine) {
      safeSend(player.ws, {
        type: 'STATE',
        roomCode: this.code,
        snapshot: this.engine.getSnapshot(),
      });
    }

    this._broadcastRoomUpdate();
    return { slot, player };
  }

  removeSocket(ws) {
    for (let slot = 0; slot < this.players.length; slot++) {
      const p = this.players[slot];
      if (!p || p.ws !== ws) continue;

      p.connected = false;
      p.ws = null;
      p.disconnectedAt = Date.now();

      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
      p.disconnectTimer = setTimeout(() => {
        this._handleDisconnectTimeout(slot);
      }, RECONNECT_GRACE_MS);

      this._broadcastRoomUpdate();
      return { slot, player: p };
    }
    return null;
  }

  enqueueCommand(playerId, command) {
    if (this.status !== 'RUNNING' || !this.engine) return;
    if (command?.type === 'MOVE' || command?.type === 'ATTACK' || command?.type === 'HARVEST') {
      console.log(`[Room ${this.code}] Command: ${command.type} from ${playerId}, units: ${JSON.stringify(command.unitIds)}`);
    }
    this.commandQueue.push({ playerId, command });
  }

  startGame() {
    if (this.status !== 'WAITING') return false;

    const teams = [];
    for (let slot = 0; slot < this.players.length; slot++) {
      if (this.players[slot] || this.aiDifficulty.has(slot)) {
        teams.push(slot);
      }
    }

    if (teams.length < 2) return false;

    // Prevent double-starting during countdown
    this.status = 'COUNTDOWN';
    this._broadcastRoomUpdate();

    const COUNTDOWN_SECS = 3;
    let remaining = COUNTDOWN_SECS;

    this._broadcastAll({ type: 'COUNTDOWN', count: remaining });

    this._countdownRef = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        this._broadcastAll({ type: 'COUNTDOWN', count: remaining });
      } else {
        clearInterval(this._countdownRef);
        this._countdownRef = null;
        this._launchGame(teams);
      }
    }, 1000);

    return true;
  }

  _broadcastAll(payload) {
    for (let slot = 0; slot < this.players.length; slot++) {
      const p = this.players[slot];
      if (!p || !p.connected) continue;
      safeSend(p.ws, payload);
    }
  }

  _launchGame(teams) {
    console.log(`[Room ${this.code}] Starting game with teams: [${teams}], ${this.engine ? 'engine exists' : 'creating engine'}`);
    this.engine = new GameEngine({ teams });
    this.status = 'RUNNING';
    this.paused = false;
    this._lastTilesVer = undefined;

    // Create AI instances for AI slots
    this.aiSlots.clear();
    for (const [slot, difficulty] of this.aiDifficulty) {
      const ai = new ServerAI(slot, difficulty);
      if (ai.startBonus > 0) {
        this.engine.resources[slot].minerals += ai.startBonus;
        this.engine.resources[slot].wood += ai.startBonus;
      }
      this.aiSlots.set(slot, ai);
    }

    this.intervalRef = setInterval(() => this._tick(), TICK_MS);

    this._broadcastAll({ type: 'COUNTDOWN', count: 0 });

    for (let slot = 0; slot < this.players.length; slot++) {
      const p = this.players[slot];
      if (!p || !p.connected) continue;
      safeSend(p.ws, {
        type: 'GAME_STARTED',
        roomCode: this.code,
        playerSlot: slot,
        players: this.serializePlayers(),
      });
    }

    this._broadcastState();
    this._broadcastRoomUpdate();
  }

  pauseGame() {
    if (this.status !== 'RUNNING' || !this.engine) return false;
    this.paused = true;
    this._broadcastRoomUpdate();
    return true;
  }

  resumeGame() {
    if (this.status !== 'RUNNING' || !this.engine) return false;
    this.paused = false;
    this._broadcastRoomUpdate();
    return true;
  }

  saveGame() {
    if (!this.engine || this.status !== 'RUNNING') return false;
    this.savedSnapshot = JSON.parse(JSON.stringify(this.engine.getSnapshot()));
    this._broadcastRoomUpdate();
    return true;
  }

  loadGame() {
    if (!this.savedSnapshot || this.status !== 'RUNNING') return false;
    this.engine = GameEngine.fromSnapshot(this.savedSnapshot);
    this.paused = false;
    this._broadcastState();
    this._broadcastRoomUpdate();
    return true;
  }

  stopGame(reason = 'ROOM_CLOSED') {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }

    this.status = 'ENDED';
    this.paused = false;
    this.savedSnapshot = null;

    for (const p of this.players) {
      if (!p) continue;
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
      p.disconnectTimer = null;
      safeSend(p.ws, { type: reason, roomCode: this.code });
      if (p.ws) {
        try {
          p.ws.close();
        } catch {
          // ignore
        }
      }
    }

    this.players = new Array(this.maxPlayers).fill(null);
    this.aiSlots.clear();
    this.aiDifficulty.clear();
    if (typeof this.onEmpty === 'function') {
      this.onEmpty(this.code);
    }
  }

  _tick() {
    if (!this.engine || this.status !== 'RUNNING') return;
    if (this.paused) return;

    try {
      if (this.commandQueue.length > 0) {
        const queued = this.commandQueue;
        this.commandQueue = [];

        for (const item of queued) {
          const found = this.findPlayerById(item.playerId);
          if (!found) continue;
          processCommand(this.engine, found.slot, item.command);
        }
      }

      // Run AI for AI-controlled slots
      const tickDt = TICK_MS / 1000;
      for (const [slot, ai] of this.aiSlots) {
        try {
          ai.update(tickDt, this.engine);
        } catch (aiErr) {
          console.error(`[Room ${this.code}] AI slot ${slot} error:`, aiErr);
        }
      }

      this.engine.update(tickDt);
      this._broadcastState();

      if (this.engine.ended) {
        this.stopGame('GAME_ENDED');
      }
    } catch (err) {
      console.error(`[Room ${this.code}] Tick error:`, err);
    }
  }

  _broadcastState() {
    if (!this.engine) return;
    const currentTilesVer = this.engine.map.tilesVersion;
    const skipTiles = this._lastTilesVer !== undefined && currentTilesVer === this._lastTilesVer;
    this._lastTilesVer = currentTilesVer;
    const snapshot = this.engine.getSnapshot(skipTiles);
    for (const p of this.players) {
      if (!p || !p.connected) continue;
      safeSend(p.ws, { type: 'STATE', roomCode: this.code, snapshot });
    }
  }

  _broadcastRoomUpdate() {
    const payload = {
      type: 'ROOM_UPDATE',
      roomCode: this.code,
      status: this.status,
      paused: this.paused,
      hasSave: !!this.savedSnapshot,
      hostSlot: this.hostSlot,
      players: this.serializePlayers(),
      maxPlayers: this.maxPlayers,
    };

    for (const p of this.players) {
      if (!p || !p.connected) continue;
      safeSend(p.ws, payload);
    }
  }

  _handleDisconnectTimeout(slot) {
    const player = this.players[slot];
    if (!player || player.connected) return;

    this.players[slot] = null;

    if (this.status === 'RUNNING') {
      this.stopGame('PLAYER_DISCONNECTED');
      return;
    }

    const firstOccupied = this.players.findIndex((p) => p !== null);
    this.hostSlot = firstOccupied === -1 ? 0 : firstOccupied;

    if (this.getOccupiedCount() === 0) {
      this.stopGame('ROOM_EMPTY');
      return;
    }

    this._broadcastRoomUpdate();
  }
}
