export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseX = -1;
    this.mouseY = -1;
    this.mouseWorldX = 0;
    this.mouseWorldY = 0;

    // Selection box
    this.isSelecting = false;
    this.selBoxStart = null;
    this.selBoxEnd = null;

    // Click events (consumed each frame)
    this.leftClick = null;
    this.rightClick = null;
    this.shiftHeld = false;

    // Scroll wheel
    this.scrollDelta = 0;

    // Minimap click (consumed each frame)
    this.minimapClick = null;

    this._setupListeners();
  }

  _setupListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Shift') this.shiftHeld = true;
    });

    window.addEventListener('keyup', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      this.keys.delete(e.key.toLowerCase());
      if (e.key === 'Shift') this.shiftHeld = false;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;

      if (this.isSelecting) {
        this.selBoxEnd = { x: e.clientX, y: e.clientY };
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // Left click - start selection box
        this.isSelecting = true;
        this.selBoxStart = { x: e.clientX, y: e.clientY };
        this.selBoxEnd = { x: e.clientX, y: e.clientY };
      } else if (e.button === 2) {
        // Right click command should not depend on contextmenu timing.
        e.preventDefault();
        this.rightClick = { x: e.clientX, y: e.clientY };
      }
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.isSelecting) {
        const dx = Math.abs(this.selBoxEnd.x - this.selBoxStart.x);
        const dy = Math.abs(this.selBoxEnd.y - this.selBoxStart.y);

        if (dx < 4 && dy < 4) {
          // Treat as click
          this.leftClick = {
            x: e.clientX,
            y: e.clientY,
            shift: this.shiftHeld,
            clickCount: e.detail || 1,
          };
        } else {
          // Treat as box select - leftClick will have the box info
          this.leftClick = {
            x: e.clientX, y: e.clientY,
            shift: this.shiftHeld,
            clickCount: 1,
            box: {
              x1: Math.min(this.selBoxStart.x, this.selBoxEnd.x),
              y1: Math.min(this.selBoxStart.y, this.selBoxEnd.y),
              x2: Math.max(this.selBoxStart.x, this.selBoxEnd.x),
              y2: Math.max(this.selBoxStart.y, this.selBoxEnd.y),
            }
          };
        }

        this.isSelecting = false;
        this.selBoxStart = null;
        this.selBoxEnd = null;
      } else if (e.button === 2) {
        // Keep as backup path on browsers that delay/suppress mousedown button 2.
        e.preventDefault();
        this.rightClick = { x: e.clientX, y: e.clientY };
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.rightClick = { x: e.clientX, y: e.clientY };
    });

    // Mouse wheel for zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scrollDelta += e.deltaY;
    }, { passive: false });

    // Prevent losing track of mouse when leaving window
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.shiftHeld = false;
      this.isSelecting = false;
    });
  }

  consumeLeftClick() {
    const click = this.leftClick;
    this.leftClick = null;
    return click;
  }

  consumeRightClick() {
    const click = this.rightClick;
    this.rightClick = null;
    return click;
  }

  consumeScroll() {
    const d = this.scrollDelta;
    this.scrollDelta = 0;
    return d;
  }

  consumeMinimapClick() {
    const c = this.minimapClick;
    this.minimapClick = null;
    return c;
  }

  getSelectionBox() {
    if (!this.isSelecting || !this.selBoxStart || !this.selBoxEnd) return null;
    return {
      x1: Math.min(this.selBoxStart.x, this.selBoxEnd.x),
      y1: Math.min(this.selBoxStart.y, this.selBoxEnd.y),
      x2: Math.max(this.selBoxStart.x, this.selBoxEnd.x),
      y2: Math.max(this.selBoxStart.y, this.selBoxEnd.y),
    };
  }
}
