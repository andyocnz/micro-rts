import { WORLD_W, WORLD_H, CAMERA_SPEED, EDGE_SCROLL_ZONE, TILE_SIZE } from './constants.js';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;

export class Camera {
  constructor(canvasWidth, canvasHeight) {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.viewW = canvasWidth;
    this.viewH = canvasHeight;
  }

  resize(w, h) {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  update(dt, keys, mouseX, mouseY) {
    let dx = 0, dy = 0;

    // Keyboard scrolling
    if (keys.has('arrowup')) dy -= 1;
    if (keys.has('arrowdown')) dy += 1;
    if (keys.has('arrowleft')) dx -= 1;
    if (keys.has('arrowright')) dx += 1;

    // Edge scrolling
    if (mouseX >= 0 && mouseY >= 0) {
      if (mouseX < EDGE_SCROLL_ZONE) dx -= 1;
      if (mouseX > this.viewW - EDGE_SCROLL_ZONE) dx += 1;
      if (mouseY < EDGE_SCROLL_ZONE) dy -= 1;
      if (mouseY > this.viewH - EDGE_SCROLL_ZONE) dy += 1;
    }

    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      this.x += (dx / len) * CAMERA_SPEED * dt;
      this.y += (dy / len) * CAMERA_SPEED * dt;
      this.clamp();
    }
  }

  applyZoom(delta, mouseX, mouseY) {
    // Zoom toward mouse position
    const worldBefore = this.screenToWorld(mouseX, mouseY);

    const factor = delta > 0 ? 0.9 : 1.1;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));

    // Adjust camera so the world point under mouse stays put
    const scaledVW = this.viewW / this.zoom;
    const scaledVH = this.viewH / this.zoom;
    this.x = worldBefore.x - mouseX / this.zoom;
    this.y = worldBefore.y - mouseY / this.zoom;
    this.clamp();
  }

  clamp() {
    const scaledVW = this.viewW / this.zoom;
    const scaledVH = this.viewH / this.zoom;
    this.x = Math.max(0, Math.min(WORLD_W - scaledVW, this.x));
    this.y = Math.max(0, Math.min(WORLD_H - scaledVH, this.y));
  }

  screenToWorld(sx, sy) {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }

  worldToScreen(wx, wy) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  // Get visible tile range for culling
  getVisibleTiles() {
    const scaledVW = this.viewW / this.zoom;
    const scaledVH = this.viewH / this.zoom;
    return {
      startX: Math.max(0, Math.floor(this.x / TILE_SIZE)),
      startY: Math.max(0, Math.floor(this.y / TILE_SIZE)),
      endX: Math.min(Math.ceil((this.x + scaledVW) / TILE_SIZE), WORLD_W / TILE_SIZE),
      endY: Math.min(Math.ceil((this.y + scaledVH) / TILE_SIZE), WORLD_H / TILE_SIZE),
    };
  }

  centerOn(wx, wy) {
    const scaledVW = this.viewW / this.zoom;
    const scaledVH = this.viewH / this.zoom;
    this.x = wx - scaledVW / 2;
    this.y = wy - scaledVH / 2;
    this.clamp();
  }
}
