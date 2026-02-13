export class NetworkClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Set();
    this.openHandlers = new Set();
    this.closeHandlers = new Set();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.url);

    this.ws.addEventListener('open', () => {
      for (const h of this.openHandlers) h();
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    });

    this.ws.addEventListener('close', () => {
      for (const h of this.closeHandlers) h();
    });
  }

  onMessage(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onOpen(handler) {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (type === 'COMMAND') {
        console.warn('[Network] Command dropped: WebSocket not open (state:', this.ws?.readyState, ')');
      }
      return;
    }
    this.ws.send(JSON.stringify({ type, ...payload }));
  }

  createRoom() {
    this.send('CREATE_ROOM');
  }

  joinRoom(roomCode) {
    this.send('JOIN_ROOM', { roomCode });
  }

  rejoinRoom(roomCode, playerId, reconnectToken) {
    this.send('REJOIN_ROOM', { roomCode, playerId, reconnectToken });
  }

  startGame() {
    this.send('START_GAME');
  }

  pauseGame() {
    this.send('PAUSE_GAME');
  }

  resumeGame() {
    this.send('RESUME_GAME');
  }

  saveGame() {
    this.send('SAVE_GAME');
  }

  loadGame() {
    this.send('LOAD_GAME');
  }

  sendCommand(command) {
    this.send('COMMAND', { command });
  }
}
