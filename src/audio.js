// Procedural audio using Web Audio API - zero audio files needed

let audioCtx = null;
let soundAudibilityChecker = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Ensure audio context is resumed on first user interaction
export function initAudio() {
  const resume = () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    getCtx();
    window.removeEventListener('click', resume);
    window.removeEventListener('keydown', resume);
  };
  window.addEventListener('click', resume);
  window.addEventListener('keydown', resume);
}

export function setSoundAudibilityChecker(checker) {
  soundAudibilityChecker = typeof checker === 'function' ? checker : null;
}

function canPlayAt(wx, wy) {
  if (typeof wx !== 'number' || typeof wy !== 'number') return true;
  if (!soundAudibilityChecker) return true;
  try {
    return !!soundAudibilityChecker(wx, wy);
  } catch {
    return true;
  }
}

function playTone(freq, duration, type = 'square', volume = 0.15, decay = true) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);

  if (decay) {
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  }

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playNoise(duration, volume = 0.1) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') return;

  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  source.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  source.start();
}

// --- Game sound effects ---

export function sfxSelect() {
  playTone(800, 0.08, 'square', 0.1);
  setTimeout(() => playTone(1000, 0.06, 'square', 0.08), 40);
}

export function sfxMove() {
  playTone(400, 0.1, 'sine', 0.1);
}

export function sfxAttack(wx, wy) {
  if (!canPlayAt(wx, wy)) return;
  playNoise(0.1, 0.15);
  playTone(200, 0.08, 'sawtooth', 0.12);
}

export function sfxDeath(wx, wy) {
  if (!canPlayAt(wx, wy)) return;
  playTone(300, 0.15, 'sawtooth', 0.12);
  setTimeout(() => playTone(150, 0.25, 'sawtooth', 0.1), 80);
}

export function sfxMine(wx, wy) {
  if (!canPlayAt(wx, wy)) return;
  playTone(600, 0.06, 'triangle', 0.08);
  setTimeout(() => playTone(700, 0.06, 'triangle', 0.06), 70);
}

export function sfxChop(wx, wy) {
  if (!canPlayAt(wx, wy)) return;
  playNoise(0.05, 0.1);
  playTone(250, 0.08, 'triangle', 0.1);
  setTimeout(() => playTone(200, 0.06, 'triangle', 0.08), 60);
}

export function sfxDeposit(wx, wy) {
  if (!canPlayAt(wx, wy)) return;
  playTone(500, 0.06, 'sine', 0.08);
  setTimeout(() => playTone(700, 0.05, 'sine', 0.08), 50);
  setTimeout(() => playTone(900, 0.05, 'sine', 0.06), 100);
}

export function sfxBuild() {
  playNoise(0.06, 0.08);
  playTone(350, 0.1, 'square', 0.08);
}

export function sfxTrain(wx, wy) {
  if (!canPlayAt(wx, wy)) return;
  playTone(600, 0.1, 'sine', 0.1);
  setTimeout(() => playTone(800, 0.1, 'sine', 0.08), 100);
  setTimeout(() => playTone(1000, 0.08, 'sine', 0.06), 200);
}

export function sfxError() {
  playTone(200, 0.15, 'square', 0.12);
  setTimeout(() => playTone(150, 0.15, 'square', 0.1), 120);
}

export function sfxExplosion(wx, wy) {
  if (!canPlayAt(wx, wy)) return;
  playNoise(0.2, 0.2);
  playTone(80, 0.15, 'sawtooth', 0.15);
  setTimeout(() => playTone(50, 0.2, 'sawtooth', 0.1), 100);
}
