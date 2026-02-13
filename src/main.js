import { Game } from './game.js';
import { MultiplayerGame } from './multiplayerGame.js';
import { NetworkClient } from './network.js';

const STORAGE_KEY = 'micro_rts_session_v1';
const TEAM_NAMES = ['Blue', 'Red', 'Green', 'Yellow'];
const TEAM_CSS = ['#4488ff', '#ff4444', '#44cc44', '#ffcc00'];
const DEBUG_REVEAL = (() => {
  const v = new URLSearchParams(window.location.search).get('debug');
  return v === '1' || v === 'true';
})();

let game = null;
let network = null;
let currentMode = null; // 'single' | 'multi' | null
let selectedDifficulty = 'normal';
let selectedAllyMode = 'off';
let selectedCombatMode = 'live';
let selectedTheme = 'verdant';

// Multiplayer state
let roomCode = null;
let playerId = null;
let reconnectToken = null;
let playerSlot = null;
let roomStatus = 'WAITING';
let isHost = false;
let lastPlayers = [];
let roomPaused = false;
let roomHasSave = false;
let modalPrevPaused = false;

// DOM refs (cached after init)
let canvas, menuEl, gameUiEl, backBtn, saveLoadBar;
let resumeSectionEl;

// --- Helpers ---

function getSocketUrl() {
  const fromQuery = new URLSearchParams(window.location.search).get('ws');
  if (fromQuery) return fromQuery;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.hostname}:8080`;
}

function setStatus(text) {
  const el = document.getElementById('net-status');
  if (el) el.textContent = text;
}

function persistSession() {
  if (!roomCode || !playerId || !reconnectToken) return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode, playerId, reconnectToken }));
}

function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function getPlayerName() {
  const el = document.getElementById('player-name');
  return el ? el.value.trim() : '';
}

function getPlayerIcon() {
  const el = document.getElementById('player-icon');
  return el ? el.value : '⚔️';
}

function updateDifficultyButtons(selector, difficulty) {
  document.querySelectorAll(selector).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.diff === difficulty);
  });
}

function setSelectedDifficulty(difficulty, applyToRunningSingle = false) {
  selectedDifficulty = difficulty;
  updateDifficultyButtons('.menu-diff-btn', difficulty);
  updateDifficultyButtons('.ingame-diff-btn', difficulty);
  if (applyToRunningSingle && currentMode === 'single' && game instanceof Game) {
    game.setDifficulty(difficulty);
  }
}

function updateAllyButtons(selector, allyMode) {
  document.querySelectorAll(selector).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ally === allyMode);
  });
}

function setSelectedAllyMode(allyMode, applyToRunningSingle = false) {
  selectedAllyMode = allyMode === 'on' ? 'on' : 'off';
  updateAllyButtons('.ingame-ally-btn', selectedAllyMode);
  if (applyToRunningSingle && currentMode === 'single' && game instanceof Game) {
    game.setAlliedAiMode(selectedAllyMode === 'on');
  }
}

function updateCombatButtons(combatMode) {
  document.querySelectorAll('.ingame-combat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.combat === combatMode);
  });
}

function setSelectedCombatMode(combatMode, applyToRunningSingle = false) {
  selectedCombatMode = combatMode === 'frozen' ? 'frozen' : 'live';
  updateCombatButtons(selectedCombatMode);
  if (applyToRunningSingle && currentMode === 'single' && game instanceof Game) {
    game.setCombatFrozen(selectedCombatMode === 'frozen');
  }
}

function sendPlayerInfo() {
  if (!network) return;
  network.send('SET_PLAYER_INFO', { name: getPlayerName(), icon: getPlayerIcon() });
}

// --- Menu visibility ---

function showMenu() {
  menuEl.classList.remove('hidden');
  gameUiEl.classList.remove('active');
  backBtn.style.display = 'none';
  saveLoadBar.classList.remove('active');
  updateResumeUi();
}

function hideMenu() {
  menuEl.classList.add('hidden');
  gameUiEl.classList.add('active');
  backBtn.style.display = 'block';
  updateResumeUi();
}

function canResumeCurrentGame() {
  return !!(game && game.running && (currentMode === 'single' || currentMode === 'multi'));
}

function updateResumeUi() {
  if (!resumeSectionEl) return;
  const show = canResumeCurrentGame() && !document.getElementById('save-modal-overlay').classList.contains('open');
  resumeSectionEl.style.display = show ? '' : 'none';
}

// --- Stop current game ---

function stopGame() {
  if (game) {
    game.running = false;
    game = null;
  }
  currentMode = null;
  roomCode = null;
  playerId = null;
  reconnectToken = null;
  playerSlot = null;
  roomStatus = 'WAITING';
  isHost = false;
  lastPlayers = [];
  roomPaused = false;
  roomHasSave = false;
  updateRoomUi();
  updatePlayerList([]);
  updateSinglePauseUi();
  updateResumeUi();
  setSelectedDifficulty(selectedDifficulty);
  setSelectedAllyMode(selectedAllyMode);
  setSelectedCombatMode(selectedCombatMode);
}

// --- Single Player ---

function startSinglePlayer(difficulty, loadSlot) {
  stopGame();
  currentMode = 'single';
  setSelectedDifficulty(difficulty);
  if (!loadSlot) {
    setSelectedAllyMode('off');
    setSelectedCombatMode('live');
  }

  game = new Game(canvas, difficulty, {
    debugShowAll: DEBUG_REVEAL,
    alliedAiMode: selectedAllyMode === 'on',
    combatFrozen: selectedCombatMode === 'frozen',
  });
  game.switchTheme(selectedTheme);
  window.game = game;

  if (loadSlot) {
    game.loadFromSlot(loadSlot);
    if (game.difficulty) setSelectedDifficulty(game.difficulty);
    setSelectedAllyMode(game.alliedAiMode ? 'on' : 'off');
    setSelectedCombatMode(game.combatFrozen ? 'frozen' : 'live');
  }

  hideMenu();
  saveLoadBar.classList.add('active');
  updateSinglePauseUi();
  game.start();
}

// --- Multiplayer ---

let pendingNetworkAction = null;

function ensureNetwork(onReady) {
  if (network && network.ws && network.ws.readyState === WebSocket.OPEN) {
    onReady();
    return;
  }
  pendingNetworkAction = onReady;
  if (network && network.ws && network.ws.readyState === WebSocket.CONNECTING) {
    return; // already connecting, action will fire on open
  }
  if (!network) {
    network = new NetworkClient(getSocketUrl());
    bindNetworkHandlers();
  }
  network.connect();
  setStatus('Connecting...');
}

function startMultiplayer(snapshot) {
  currentMode = 'multi';

  if (!game || !(game instanceof MultiplayerGame)) {
    game = new MultiplayerGame(canvas, network);
    game.switchTheme(selectedTheme);
    window.game = game;
    game.start();
  }

  game.setRoomContext({ roomCode, playerSlot, status: 'RUNNING', paused: roomPaused });

  if (snapshot) {
    game.applySnapshot(snapshot);
  }

  hideMenu();
  saveLoadBar.classList.remove('active');
}

function updateRoomUi() {
  const codeEl = document.getElementById('room-code-display');
  const slotEl = document.getElementById('slot-display');
  const startBtn = document.getElementById('btn-start-mp');
  const pauseBtn = document.getElementById('btn-pause-mp');
  const saveBtn = document.getElementById('btn-save-mp');
  const loadBtn = document.getElementById('btn-load-mp');
  const pauseStateEl = document.getElementById('mp-pause-state');
  const infoEl = document.getElementById('mp-room-info');

  if (codeEl) codeEl.textContent = roomCode || '-----';
  if (slotEl) slotEl.textContent = playerSlot !== null ? `You: ${TEAM_NAMES[playerSlot]}` : '';
  if (startBtn) startBtn.disabled = roomStatus !== 'WAITING' || !isHost;
  if (pauseBtn) {
    pauseBtn.disabled = roomStatus !== 'RUNNING' || !isHost;
    pauseBtn.textContent = roomPaused ? 'Resume' : 'Pause';
  }
  if (saveBtn) saveBtn.disabled = roomStatus !== 'RUNNING' || !isHost;
  if (loadBtn) loadBtn.disabled = roomStatus !== 'RUNNING' || !isHost || !roomHasSave;
  if (pauseStateEl) pauseStateEl.textContent = roomStatus === 'RUNNING' ? (roomPaused ? 'Paused' : 'Live') : '';
  if (infoEl) infoEl.style.display = roomCode ? '' : 'none';
}

function updateSinglePauseUi() {
  const pauseBtn = document.getElementById('btn-pause');
  if (!pauseBtn) return;
  const isSingle = currentMode === 'single' && game instanceof Game;
  pauseBtn.disabled = !isSingle;
  pauseBtn.textContent = isSingle && game.paused ? 'Resume' : 'Pause';
}

function updatePlayerList(players = []) {
  lastPlayers = players;
  const list = document.getElementById('player-list');
  if (!list) return;

  const lines = [];
  for (const p of players) {
    const color = TEAM_CSS[p.slot] || '#aaa';
    const label = `<span class="slot-label" style="color:${color}">${TEAM_NAMES[p.slot]}</span>`;

    if (p.isAI) {
      // AI slot
      const diffLabel = p.aiDifficulty ? p.aiDifficulty.charAt(0).toUpperCase() + p.aiDifficulty.slice(1) : 'Normal';
      let controls = `<span class="slot-status">AI (${diffLabel})</span>`;
      if (isHost && roomStatus === 'WAITING') {
        controls = `<span class="slot-status">AI</span>` +
          `<select class="ai-select" data-slot="${p.slot}">` +
          `<option value="easy"${p.aiDifficulty === 'easy' ? ' selected' : ''}>Easy</option>` +
          `<option value="normal"${p.aiDifficulty === 'normal' ? ' selected' : ''}>Normal</option>` +
          `<option value="hard"${p.aiDifficulty === 'hard' ? ' selected' : ''}>Hard</option>` +
          `<option value="remove">Remove</option>` +
          `</select>`;
      }
      lines.push(`<div class="player-slot">${label}${controls}</div>`);
    } else if (p.occupied) {
      const icon = p.icon ? `<span class="slot-icon">${p.icon}</span>` : '';
      const displayName = p.name ? escapeHtml(p.name) : (p.connected ? 'Player' : 'Reconnecting...');
      const host = p.isHost ? ' (Host)' : '';
      const connState = p.connected ? '' : ' <span style="color:#f84">reconnecting</span>';
      lines.push(`<div class="player-slot">${label}<span class="slot-status">${icon}${displayName}${host}${connState}</span></div>`);
    } else {
      // Empty slot — host can add AI
      let controls = `<span class="slot-status" style="color:#555">Open</span>`;
      if (isHost && roomStatus === 'WAITING') {
        controls += `<select class="ai-select" data-slot="${p.slot}">` +
          `<option value="">Open</option>` +
          `<option value="easy">AI Easy</option>` +
          `<option value="normal">AI Normal</option>` +
          `<option value="hard">AI Hard</option>` +
          `</select>`;
      }
      lines.push(`<div class="player-slot">${label}${controls}</div>`);
    }
  }

  list.innerHTML = lines.join('');

  // Wire AI select dropdowns
  list.querySelectorAll('.ai-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const slot = parseInt(sel.dataset.slot);
      const val = sel.value;
      if (!network) return;
      if (val === 'remove' || val === '') {
        network.send('REMOVE_SLOT_AI', { slot });
      } else {
        network.send('SET_SLOT_AI', { slot, difficulty: val });
      }
    });
  });
}

function bindNetworkHandlers() {
  network.onOpen(() => {
    setStatus('Connected to server');
    const session = readSession();
    if (session?.roomCode && session?.playerId && session?.reconnectToken) {
      network.rejoinRoom(session.roomCode, session.playerId, session.reconnectToken);
      setStatus(`Attempting rejoin ${session.roomCode}...`);
    } else if (pendingNetworkAction) {
      const action = pendingNetworkAction;
      pendingNetworkAction = null;
      action();
    }
  });

  network.onClose(() => {
    setStatus('Disconnected from server');
  });

  network.onMessage((msg) => {
    switch (msg.type) {
      case 'HELLO':
        break;

      case 'ROOM_CREATED':
      case 'ROOM_JOINED':
      case 'REJOINED': {
        roomCode = msg.roomCode;
        playerId = msg.playerId;
        reconnectToken = msg.reconnectToken;
        playerSlot = msg.playerSlot;
        roomStatus = msg.status || 'WAITING';
        roomPaused = !!msg.paused;
        roomHasSave = !!msg.hasSave;
        isHost = msg.playerSlot === 0;
        persistSession();
        sendPlayerInfo();

        if (game && game instanceof MultiplayerGame) {
          game.setRoomContext({ roomCode, playerSlot, status: roomStatus, paused: roomPaused });
        }

        updateRoomUi();
        updatePlayerList(msg.players || []);
        setStatus(`Joined room ${roomCode}`);
        break;
      }

      case 'ROOM_UPDATE': {
        roomCode = msg.roomCode || roomCode;
        roomStatus = msg.status || roomStatus;
        roomPaused = !!msg.paused;
        roomHasSave = !!msg.hasSave;
        if (msg.hostSlot !== undefined) {
          isHost = playerSlot === msg.hostSlot;
        }
        if (game && game instanceof MultiplayerGame) {
          game.setRoomContext({ status: roomStatus, paused: roomPaused });
        }
        updateRoomUi();
        updatePlayerList(msg.players || []);
        setStatus(`Room ${roomCode} - ${roomStatus}${roomPaused ? ' (Paused)' : ''}`);
        break;
      }

      case 'GAME_STARTED': {
        roomStatus = 'RUNNING';
        roomPaused = false;
        playerSlot = msg.playerSlot ?? playerSlot;
        updateRoomUi();
        startMultiplayer(msg.snapshot);
        setStatus(`Game started in ${msg.roomCode || roomCode}`);
        break;
      }

      case 'STATE': {
        if (msg.snapshot && game && game instanceof MultiplayerGame) {
          game.applySnapshot(msg.snapshot);
        }
        break;
      }

      case 'ROOM_FULL':
        setStatus(`Room ${msg.roomCode} is full`);
        break;
      case 'ROOM_NOT_FOUND':
        setStatus(`Room ${msg.roomCode || ''} not found`);
        break;
      case 'ROOM_ALREADY_STARTED':
        setStatus(`Room ${msg.roomCode} already started`);
        break;
      case 'REJOIN_REJECTED':
        clearSession();
        setStatus('Rejoin rejected, create or join room');
        break;

      case 'PLAYER_DISCONNECTED':
      case 'GAME_ENDED':
      case 'ROOM_CLOSED':
      case 'ROOM_EMPTY':
        roomStatus = 'ENDED';
        roomPaused = false;
        roomHasSave = false;
        if (game && game instanceof MultiplayerGame) {
          game.setRoomContext({ status: 'ENDED', paused: false });
        }
        clearSession();
        updateRoomUi();
        setStatus(msg.type.replaceAll('_', ' ').toLowerCase());
        break;

      default:
        break;
    }
  });
}

// --- Copy room code ---

function copyRoomCode() {
  if (!roomCode) return;
  const btn = document.getElementById('btn-copy-code');
  navigator.clipboard.writeText(roomCode).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    // Fallback: select text
    const el = document.getElementById('room-code-display');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

// --- Multiplayer tabs ---

function switchTab(tabName) {
  document.querySelectorAll('.mp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.mp-tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabName}`));
}

// --- Save / Load Modal ---

let modalMode = null; // 'save' | 'load' | 'menu-load'

function openModal(mode) {
  modalMode = mode;
  const overlay = document.getElementById('save-modal-overlay');
  const title = document.getElementById('modal-title');
  const nameRow = document.getElementById('save-name-row');
  const nameInput = document.getElementById('save-name-input');

  if (mode === 'save') {
    title.textContent = 'Save Game';
    nameRow.style.display = 'flex';
    nameInput.value = '';
    nameInput.focus();
  } else {
    title.textContent = 'Load Game';
    nameRow.style.display = 'none';
  }

  renderSaveList();
  overlay.classList.add('open');

  if (currentMode === 'single' && game instanceof Game) {
    modalPrevPaused = game.paused;
    game.paused = true;
    updateSinglePauseUi();
  }
}

function closeModal() {
  const overlay = document.getElementById('save-modal-overlay');
  overlay.classList.remove('open');
  if (currentMode === 'single' && game instanceof Game) {
    game.paused = modalPrevPaused;
    updateSinglePauseUi();
  }
  modalMode = null;
  updateResumeUi();
}

function renderSaveList() {
  const listEl = document.getElementById('save-list');
  const saves = Game.getSaveList();

  if (saves.length === 0) {
    listEl.innerHTML = '<div class="save-empty">No saves found</div>';
    return;
  }

  listEl.innerHTML = saves.map(s => {
    const dateStr = new Date(s.timestamp).toLocaleString();
    return `<div class="save-entry">
      <div class="save-entry-info">
        <div class="save-entry-name">${escapeHtml(s.name)}</div>
        <div class="save-entry-detail">${dateStr} — ${s.gameMin}m played — ${s.difficulty}</div>
      </div>
      <div class="save-entry-actions">
        <button class="load-btn" data-name="${escapeHtml(s.name)}">Load</button>
        <button class="del-btn" data-name="${escapeHtml(s.name)}">Del</button>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      if (modalMode === 'menu-load') {
        closeModal();
        startSinglePlayer(selectedDifficulty, name);
      } else {
        if (game && game.loadFromSlot) {
          game.loadFromSlot(name);
          if (game.difficulty) setSelectedDifficulty(game.difficulty);
          setSelectedAllyMode(game.alliedAiMode ? 'on' : 'off');
          setSelectedCombatMode(game.combatFrozen ? 'frozen' : 'live');
        }
        closeModal();
      }
    });
  });

  listEl.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Game.deleteSave(btn.dataset.name);
      renderSaveList();
    });
  });
}

// --- Init ---

function init() {
  canvas = document.getElementById('gameCanvas');
  menuEl = document.getElementById('main-menu');
  gameUiEl = document.getElementById('game-ui');
  backBtn = document.getElementById('back-to-menu');
  saveLoadBar = document.getElementById('save-load-bar');
  resumeSectionEl = document.getElementById('resume-section');

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (game) game.resize(canvas.width, canvas.height);
  }

  resize();
  window.addEventListener('resize', resize);

  // --- Multiplayer tabs ---
  document.querySelectorAll('.mp-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // --- Difficulty buttons ---
  document.querySelectorAll('.menu-diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setSelectedDifficulty(btn.dataset.diff);
    });
  });

  document.querySelectorAll('.ingame-diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentMode !== 'single' || !(game instanceof Game)) return;
      setSelectedDifficulty(btn.dataset.diff, true);
    });
  });

  document.querySelectorAll('.ingame-ally-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentMode !== 'single' || !(game instanceof Game)) return;
      setSelectedAllyMode(btn.dataset.ally, true);
    });
  });

  document.querySelectorAll('.ingame-combat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentMode !== 'single' || !(game instanceof Game)) return;
      setSelectedCombatMode(btn.dataset.combat, true);
    });
  });

  // --- Theme buttons ---
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTheme = btn.dataset.theme;
      if (game && game.switchTheme) game.switchTheme(selectedTheme);
    });
  });

  // --- Single Player buttons ---
  document.getElementById('btn-new-game').addEventListener('click', () => {
    if (canResumeCurrentGame()) stopGame();
    startSinglePlayer(selectedDifficulty);
  });

  document.getElementById('btn-load-game').addEventListener('click', () => {
    openModal('menu-load');
  });

  // --- Multiplayer buttons ---
  document.getElementById('btn-create-room').addEventListener('click', () => {
    ensureNetwork(() => {
      network.createRoom();
      setStatus('Creating room...');
    });
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!code) {
      setStatus('Enter a room code');
      return;
    }
    ensureNetwork(() => {
      network.joinRoom(code);
      setStatus(`Joining ${code}...`);
    });
  });

  document.getElementById('btn-start-mp').addEventListener('click', () => {
    if (network) network.startGame();
  });

  document.getElementById('btn-resume-game').addEventListener('click', () => {
    if (!canResumeCurrentGame()) return;
    hideMenu();
    if (currentMode === 'single' && game instanceof Game) {
      game.paused = false;
      updateSinglePauseUi();
    }
  });

  document.getElementById('btn-pause-mp').addEventListener('click', () => {
    if (!network) return;
    if (roomPaused) {
      network.resumeGame();
    } else {
      network.pauseGame();
    }
  });

  document.getElementById('btn-save-mp').addEventListener('click', () => {
    if (network) network.saveGame();
  });

  document.getElementById('btn-load-mp').addEventListener('click', () => {
    if (network) network.loadGame();
  });

  // --- Copy room code ---
  document.getElementById('btn-copy-code').addEventListener('click', copyRoomCode);

  // --- Player identity (name + icon) ---
  document.getElementById('player-name').addEventListener('input', () => {
    if (roomCode) sendPlayerInfo();
  });
  document.getElementById('player-icon').addEventListener('change', () => {
    if (roomCode) sendPlayerInfo();
  });

  // --- Save / Load bar (during single player) ---
  document.getElementById('btn-save').addEventListener('click', () => {
    openModal('save');
  });

  document.getElementById('btn-load').addEventListener('click', () => {
    openModal('load');
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    if (currentMode !== 'single' || !(game instanceof Game)) return;
    game.togglePause();
    updateSinglePauseUi();
  });

  // --- Save modal confirm ---
  document.getElementById('save-confirm-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('save-name-input');
    const name = nameInput.value.trim();
    if (!name) return;
    if (game && game.saveToSlot) {
      game.saveToSlot(name);
    }
    closeModal();
  });

  document.getElementById('save-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('save-confirm-btn').click();
    }
  });

  // --- Modal close ---
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('save-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // --- Back to menu ---
  backBtn.addEventListener('click', () => {
    if (currentMode === 'single' && game instanceof Game) {
      game.paused = true;
      updateSinglePauseUi();
    }
    showMenu();
  });

  // --- Escape to close modal ---
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      if (document.getElementById('save-modal-overlay').classList.contains('open')) {
        closeModal();
        return;
      }
    }
    if (e.key.toLowerCase() === 'p' && currentMode === 'single' && game instanceof Game) {
      setTimeout(updateSinglePauseUi, 0);
    }
  });

  // Show menu
  showMenu();
  updateRoomUi();
  updatePlayerList([]);
  updateSinglePauseUi();
  updateResumeUi();
  setSelectedDifficulty(selectedDifficulty);
  setSelectedAllyMode(selectedAllyMode);
  setSelectedCombatMode(selectedCombatMode);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
