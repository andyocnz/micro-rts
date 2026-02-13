import { Game } from './game.js';

let currentDifficulty = 'normal';

function startGame(canvas, difficulty, loadSlot = null) {
  // Stop previous game if running
  if (window.game) {
    window.game.running = false;
  }

  currentDifficulty = difficulty;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const game = new Game(canvas, difficulty);
  window.game = game;

  if (loadSlot) {
    const ok = game.loadFromSlot(loadSlot);
    if (ok) {
      currentDifficulty = game.difficulty;
      showSaveIndicator('Game restored');
    }
  }

  game.start();

  // Update difficulty button UI to match actual game difficulty
  document.querySelectorAll('.diff-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.diff === currentDifficulty);
  });
}

function showSaveIndicator(text = 'Game saved') {
  let el = document.getElementById('save-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'save-indicator';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

// --- Save/Load modal logic ---

let modalMode = null; // 'save' or 'load'

function openModal(mode) {
  modalMode = mode;
  const overlay = document.getElementById('save-modal-overlay');
  const title = document.getElementById('modal-title');
  const nameRow = document.getElementById('save-name-row');
  const input = document.getElementById('save-name-input');

  if (mode === 'save') {
    title.textContent = 'Save Game';
    nameRow.style.display = 'flex';
    input.value = '';
    input.focus();
  } else {
    title.textContent = 'Load Game';
    nameRow.style.display = 'none';
  }

  renderSaveList();
  overlay.classList.add('open');

  // Pause game while modal open
  if (window.game) window.game.paused = true;
}

function closeModal() {
  document.getElementById('save-modal-overlay').classList.remove('open');
  modalMode = null;
  if (window.game) window.game.paused = false;
}

function renderSaveList() {
  const list = document.getElementById('save-list');
  const saves = Game.getSaveList();

  if (saves.length === 0) {
    list.innerHTML = '<div class="save-empty">No saved games</div>';
    return;
  }

  list.innerHTML = '';
  for (const s of saves) {
    const entry = document.createElement('div');
    entry.className = 'save-entry';

    const timeAgo = s.mins < 60
      ? `${s.mins}m ago`
      : `${Math.floor(s.mins / 60)}h ${s.mins % 60}m ago`;

    entry.innerHTML = `
      <div class="save-entry-info">
        <div class="save-entry-name">${escapeHtml(s.name)}</div>
        <div class="save-entry-detail">${s.difficulty} | ${s.gameMin}m played | saved ${timeAgo}</div>
      </div>
      <div class="save-entry-actions">
        ${modalMode === 'save'
          ? `<button class="overwrite-btn" data-name="${escapeAttr(s.name)}">Overwrite</button>`
          : `<button class="load-btn" data-name="${escapeAttr(s.name)}">Load</button>`
        }
        <button class="del-btn" data-name="${escapeAttr(s.name)}">Delete</button>
      </div>
    `;
    list.appendChild(entry);
  }

  // Attach event listeners
  list.querySelectorAll('.load-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      closeModal();
      const canvas = document.getElementById('gameCanvas');
      startGame(canvas, currentDifficulty, name);
    });
  });

  list.querySelectorAll('.overwrite-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      if (window.game) {
        window.game.saveToSlot(name);
        showSaveIndicator(`Saved: ${name}`);
      }
      renderSaveList();
    });
  });

  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      Game.deleteSave(name);
      renderSaveList();
    });
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function init() {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // Set canvas to window size
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (window.game) {
      window.game.resize(canvas.width, canvas.height);
    }
  }

  resize();
  window.addEventListener('resize', resize);

  ctx.imageSmoothingEnabled = false;

  // Start a new game immediately
  startGame(canvas, currentDifficulty);

  // Warn before refresh/close (no auto-save, just warning)
  window.addEventListener('beforeunload', (e) => {
    if (window.game && window.game.running) {
      e.preventDefault();
    }
  });

  // Save/Load buttons
  document.getElementById('btn-save').addEventListener('click', () => openModal('save'));
  document.getElementById('btn-load').addEventListener('click', () => openModal('load'));

  // Modal close
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('save-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Save confirm button
  document.getElementById('save-confirm-btn').addEventListener('click', () => {
    const input = document.getElementById('save-name-input');
    const name = input.value.trim();
    if (!name) return;
    if (window.game) {
      window.game.saveToSlot(name);
      showSaveIndicator(`Saved: ${name}`);
    }
    closeModal();
  });

  // Enter key in save input
  document.getElementById('save-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('save-confirm-btn').click();
    }
    e.stopPropagation(); // prevent game hotkeys
  });

  // Escape closes modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalMode) {
      closeModal();
    }
  });

  // Difficulty buttons (live update, no restart)
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const diff = btn.dataset.diff;
      currentDifficulty = diff;
      if (window.game) {
        window.game.setDifficulty(diff);
      }
      document.querySelectorAll('.diff-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.diff === diff);
      });
    });
  });

  // Theme switcher UI
  const themeBtns = document.querySelectorAll('.theme-btn');
  themeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const theme = btn.dataset.theme;
      console.log('Switching to theme:', theme);
      if (window.game) {
        window.game.switchTheme(theme);
        themeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  // Keyboard theme switching (update UI)
  window.addEventListener('keydown', (e) => {
    const themeMap = { '1': 'verdant', '2': 'obsidian', '3': 'frozen' };
    const theme = themeMap[e.key];
    if (theme) {
      themeBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.theme === theme);
      });
    }
  });

  console.log('Micro RTS started!');
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
