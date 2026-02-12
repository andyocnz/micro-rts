import { Game } from './game.js';

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

  // Disable image smoothing for crisp pixel art
  ctx.imageSmoothingEnabled = false;

  // Create and start game
  const game = new Game(canvas);
  window.game = game;
  game.start();

  console.log('Micro RTS started!');
  console.log('Controls: WASD to scroll, Left-click to select, Right-click to move');
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
