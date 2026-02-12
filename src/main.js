import { Game } from './game.js';

let currentDifficulty = 'normal';

function startGame(canvas, difficulty) {
  // Stop previous game if running
  if (window.game) {
    window.game.running = false;
  }

  currentDifficulty = difficulty;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const game = new Game(canvas, difficulty);
  window.game = game;
  game.start();

  // Update difficulty button UI
  document.querySelectorAll('.diff-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.diff === difficulty);
  });
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

  // Start game with default difficulty
  startGame(canvas, currentDifficulty);

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
  console.log('Controls: WASD to scroll, Left-click to select, Right-click to move');
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
