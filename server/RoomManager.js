import crypto from 'node:crypto';
import { Room } from './Room.js';

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomRoomCode(length = 5) {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += ROOM_CHARS[bytes[i] % ROOM_CHARS.length];
  }
  return code;
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketIndex = new Map();
  }

  createRoomForSocket(ws) {
    let code = randomRoomCode();
    while (this.rooms.has(code)) code = randomRoomCode();

    const room = new Room(code, (roomCode) => {
      this.rooms.delete(roomCode);
    });

    this.rooms.set(code, room);

    const add = room.addPlayer(ws);
    if (!add) {
      this.rooms.delete(code);
      return null;
    }

    const { player, slot } = add;
    this.socketIndex.set(ws, { roomCode: code, playerId: player.id });

    safeSend(ws, {
      type: 'ROOM_CREATED',
      roomCode: code,
      playerId: player.id,
      reconnectToken: player.reconnectToken,
      playerSlot: slot,
      maxPlayers: room.maxPlayers,
      players: room.serializePlayers(),
      status: room.status,
      paused: room.paused,
      hasSave: !!room.savedSnapshot,
    });

    return { room, player, slot };
  }

  joinRoomForSocket(ws, roomCode) {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      safeSend(ws, { type: 'ROOM_NOT_FOUND', roomCode: code });
      return null;
    }

    if (room.status !== 'WAITING') {
      safeSend(ws, { type: 'ROOM_ALREADY_STARTED', roomCode: code });
      return null;
    }

    if (room.isFull()) {
      safeSend(ws, { type: 'ROOM_FULL', roomCode: code });
      return null;
    }

    const add = room.addPlayer(ws);
    if (!add) {
      safeSend(ws, { type: 'ROOM_FULL', roomCode: code });
      return null;
    }

    const { player, slot } = add;
    this.socketIndex.set(ws, { roomCode: code, playerId: player.id });

    safeSend(ws, {
      type: 'ROOM_JOINED',
      roomCode: code,
      playerId: player.id,
      reconnectToken: player.reconnectToken,
      playerSlot: slot,
      maxPlayers: room.maxPlayers,
      players: room.serializePlayers(),
      status: room.status,
      paused: room.paused,
      hasSave: !!room.savedSnapshot,
    });

    return { room, player, slot };
  }

  rejoinRoomForSocket(ws, roomCode, playerId, reconnectToken) {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      safeSend(ws, { type: 'ROOM_NOT_FOUND', roomCode: code });
      return null;
    }

    const rejoined = room.tryRejoin(ws, playerId, reconnectToken);
    if (!rejoined) {
      safeSend(ws, { type: 'REJOIN_REJECTED', roomCode: code });
      return null;
    }

    this.socketIndex.set(ws, { roomCode: code, playerId });
    return { room, ...rejoined };
  }

  startGame(ws) {
    const idx = this.socketIndex.get(ws);
    if (!idx) return false;
    const room = this.rooms.get(idx.roomCode);
    if (!room) return false;

    const found = room.findPlayerById(idx.playerId);
    if (!found) return false;
    if (found.slot !== room.hostSlot) {
      safeSend(ws, { type: 'NOT_HOST', roomCode: room.code });
      return false;
    }

    const started = room.startGame();
    if (!started) {
      safeSend(ws, { type: 'CANNOT_START', roomCode: room.code });
    }

    return started;
  }

  _getHostRoomForSocket(ws) {
    const idx = this.socketIndex.get(ws);
    if (!idx) return null;
    const room = this.rooms.get(idx.roomCode);
    if (!room) return null;
    const found = room.findPlayerById(idx.playerId);
    if (!found || found.slot !== room.hostSlot) return null;
    return room;
  }

  pauseGame(ws) {
    const room = this._getHostRoomForSocket(ws);
    if (!room) return false;
    return room.pauseGame();
  }

  resumeGame(ws) {
    const room = this._getHostRoomForSocket(ws);
    if (!room) return false;
    return room.resumeGame();
  }

  saveGame(ws) {
    const room = this._getHostRoomForSocket(ws);
    if (!room) return false;
    return room.saveGame();
  }

  loadGame(ws) {
    const room = this._getHostRoomForSocket(ws);
    if (!room) return false;
    return room.loadGame();
  }

  setSlotAI(ws, slot, difficulty) {
    const idx = this.socketIndex.get(ws);
    if (!idx) return false;
    const room = this.rooms.get(idx.roomCode);
    if (!room) return false;
    const found = room.findPlayerById(idx.playerId);
    if (!found || found.slot !== room.hostSlot) return false;
    return room.setSlotAI(slot, difficulty);
  }

  removeSlotAI(ws, slot) {
    const idx = this.socketIndex.get(ws);
    if (!idx) return false;
    const room = this.rooms.get(idx.roomCode);
    if (!room) return false;
    const found = room.findPlayerById(idx.playerId);
    if (!found || found.slot !== room.hostSlot) return false;
    return room.removeSlotAI(slot);
  }

  setPlayerInfo(ws, name, icon) {
    const idx = this.socketIndex.get(ws);
    if (!idx) return false;
    const room = this.rooms.get(idx.roomCode);
    if (!room) return false;
    return room.setPlayerInfo(idx.playerId, name, icon);
  }

  enqueueCommand(ws, command) {
    const idx = this.socketIndex.get(ws);
    if (!idx) return;
    const room = this.rooms.get(idx.roomCode);
    if (!room) return;

    room.enqueueCommand(idx.playerId, command);
  }

  handleDisconnect(ws) {
    const idx = this.socketIndex.get(ws);
    if (!idx) return;

    this.socketIndex.delete(ws);

    const room = this.rooms.get(idx.roomCode);
    if (!room) return;
    room.removeSocket(ws);
  }
}
