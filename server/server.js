import { WebSocketServer } from 'ws';
import { RoomManager } from './RoomManager.js';

const PORT = Number(process.env.PORT || 8080);
const roomManager = new RoomManager();

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  safeSend(ws, { type: 'HELLO', message: 'Connected to Micro RTS server' });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      safeSend(ws, { type: 'BAD_MESSAGE' });
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      safeSend(ws, { type: 'BAD_MESSAGE' });
      return;
    }

    switch (msg.type) {
      case 'CREATE_ROOM':
        roomManager.createRoomForSocket(ws);
        break;
      case 'JOIN_ROOM':
        roomManager.joinRoomForSocket(ws, msg.roomCode);
        break;
      case 'REJOIN_ROOM':
        roomManager.rejoinRoomForSocket(ws, msg.roomCode, msg.playerId, msg.reconnectToken);
        break;
      case 'START_GAME':
        roomManager.startGame(ws);
        break;
      case 'PAUSE_GAME':
        roomManager.pauseGame(ws);
        break;
      case 'RESUME_GAME':
        roomManager.resumeGame(ws);
        break;
      case 'SAVE_GAME':
        roomManager.saveGame(ws);
        break;
      case 'LOAD_GAME':
        roomManager.loadGame(ws);
        break;
      case 'COMMAND':
        roomManager.enqueueCommand(ws, msg.command);
        break;
      case 'SET_SLOT_AI':
        roomManager.setSlotAI(ws, msg.slot, msg.difficulty);
        break;
      case 'REMOVE_SLOT_AI':
        roomManager.removeSlotAI(ws, msg.slot);
        break;
      case 'SET_PLAYER_INFO':
        roomManager.setPlayerInfo(ws, msg.name, msg.icon);
        break;
      default:
        safeSend(ws, { type: 'UNKNOWN_MESSAGE', messageType: msg.type });
        break;
    }
  });

  ws.on('close', () => {
    roomManager.handleDisconnect(ws);
  });

  ws.on('error', () => {
    roomManager.handleDisconnect(ws);
  });
});

console.log(`Micro RTS WebSocket server running on ws://localhost:${PORT}`);
