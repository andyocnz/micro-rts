import { TILE_SIZE, UNIT_SIZE, TEAM_BLUE, MAP_WIDTH, MAP_HEIGHT, SELECTION_COLOR, TILE_MINERAL, TILE_TREE, TILE_WATER, TEAM_COLORS } from './constants.js';
import { UNIT_DEFS } from './units.js';
import { BUILDING_DEFS } from './buildings.js';

const VIEW_W = 800;
const VIEW_H = 600;
const WORLD_W = MAP_WIDTH * TILE_SIZE;
const WORLD_H = MAP_HEIGHT * TILE_SIZE;
const MINIMAP_SIZE = 150;
const MINIMAP_X = 20;
const MOVE_MARKER_DURATION = 0.5;

export class Renderer {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = sprites;
    this.moveMarkers = [];
    this.particles = [];

    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = MINIMAP_SIZE;
    this.minimapCanvas.height = MINIMAP_SIZE;
    this.minimapDirty = true;
  }

  addParticle(p) {
    this.particles.push({
      x: p.x, y: p.y,
      vx: p.vx || (Math.random() - 0.5) * 50,
      vy: p.vy || (Math.random() - 0.5) * 50,
      life: p.life || 1.0,
      maxLife: p.life || 1.0,
      color: p.color || '#fff',
      size: p.size || 2,
      type: p.type || 'pixel'
    });
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  addMoveMarker(x, y) {
    this.moveMarkers.push({ x, y, timer: MOVE_MARKER_DURATION });
  }

  updateMoveMarkers(dt) {
    for (let i = this.moveMarkers.length - 1; i >= 0; i--) {
      this.moveMarkers[i].timer -= dt;
      if (this.moveMarkers[i].timer <= 0) {
        this.moveMarkers.splice(i, 1);
      }
    }
  }

  render(game) {
    const { ctx } = this;
    const { camera, map, unitManager, buildingManager, input } = game;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    this._drawMap(map, camera);
    this._drawMoveMarkers(camera);
    this._drawBuildings(buildingManager, camera);
    this._drawUnits(unitManager, camera, map);
    this._drawBuildGhost(game);

    ctx.restore();

    this._drawMinimap(map, unitManager, buildingManager, camera);
    this._drawParticles(camera);
    this._drawHUD(game);
    this._drawHoverTooltip(game);
  }

  _drawHoverTooltip(game) {
    const { input, camera, unitManager, buildingManager } = game;
    const { mouseX, mouseY } = input;

    // Check buildings first (larger targets)
    const hoverB = buildingManager.getBuildingAtScreen(mouseX, mouseY, camera);
    if (hoverB) {
      const def = BUILDING_DEFS[hoverB.type];
      this._drawTooltipBox(mouseX, mouseY, def.name, this._formatCost(def.cost));
      return;
    }

    // Check units
    const hoverU = unitManager.getUnitAtScreen(mouseX, mouseY, camera);
    if (hoverU) {
      const def = UNIT_DEFS[hoverU.type];
      // For units, we show their train cost (from a typical building that produces them)
      let cost = null;
      for (const bDef of Object.values(BUILDING_DEFS)) {
        if (bDef.produces?.includes(hoverU.type)) {
          cost = bDef.trainCosts[hoverU.type];
          break;
        }
      }
      this._drawTooltipBox(mouseX, mouseY, def.name, cost ? this._formatCost(cost) : 'N/A');
    }
  }

  _drawTooltipBox(x, y, title, cost) {
    const { ctx } = this;
    const padding = 8;
    const lineH = 16;
    const text1 = title;
    const text2 = `Cost: ${cost}`;

    ctx.font = 'bold 12px sans-serif';
    const w1 = ctx.measureText(text1).width;
    ctx.font = '10px sans-serif';
    const w2 = ctx.measureText(text2).width;
    const w = Math.max(w1, w2) + padding * 2;
    const h = lineH * 2 + padding;

    const tx = Math.min(x + 15, this.canvas.width - w - 10);
    const ty = Math.max(y - h - 10, 10);

    ctx.fillStyle = 'rgba(20, 20, 25, 0.9)';
    ctx.strokeStyle = '#72d5ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tx, ty, w, h, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(text1, tx + padding, ty + lineH + 2);
    ctx.fillStyle = '#ffd740';
    ctx.font = '10px sans-serif';
    ctx.fillText(text2, tx + padding, ty + lineH + lineH);
  }

  _drawParticles(camera) {
    for (const p of this.particles) {
      const screen = camera.worldToScreen(p.x, p.y);
      if (p.type === 'smoke') {
        const alpha = (p.life / p.maxLife) * 0.4;
        this.ctx.fillStyle = `rgba(100, 100, 100, ${alpha})`;
        this.ctx.beginPath();
        this.ctx.arc(screen.x, screen.y, p.size * camera.zoom, 0, Math.PI * 2);
        this.ctx.fill();
      } else {
        const alpha = p.life / p.maxLife;
        this.ctx.fillStyle = p.color;
        this.ctx.globalAlpha = alpha;
        this.ctx.fillRect(
          screen.x - (p.size * camera.zoom) / 2,
          screen.y - (p.size * camera.zoom) / 2,
          p.size * camera.zoom,
          p.size * camera.zoom
        );
      }
    }
    this.ctx.globalAlpha = 1.0;
  }

  _drawMap(map, camera) {
    const { ctx } = this;
    const tiles = camera.getVisibleTiles();

    for (let y = tiles.startY; y < tiles.endY; y++) {
      for (let x = tiles.startX; x < tiles.endX; x++) {
        const type = map.getTile(x, y);
        const sprite = this.sprites.getTile(type, x, y);
        if (sprite) {
          ctx.drawImage(sprite, x * TILE_SIZE, y * TILE_SIZE);
        }
      }
    }
  }

  _drawBuildings(buildingManager, camera) {
    const { ctx } = this;
    for (const b of buildingManager.buildings) {
      const size = b.sizeTiles * TILE_SIZE;
      const wx = b.tileX * TILE_SIZE;
      const wy = b.tileY * TILE_SIZE;

      const sprite = this.sprites.getBuilding(b.type, b.team);

      if (!b.built) {
        ctx.globalAlpha = 0.4 + 0.6 * (b.buildProgress / b.buildTime);
        // Draw scaffolding-like effect
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = 1;
        ctx.strokeRect(wx, wy, size, size);
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(wx + (size / 4) * i, wy);
          ctx.lineTo(wx + (size / 4) * i, wy + size);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(wx, wy + (size / 4) * i);
          ctx.lineTo(wx + size, wy + (size / 4) * i);
          ctx.stroke();
        }
      }
      ctx.drawImage(sprite, wx, wy, size, size);
      ctx.globalAlpha = 1;

      if (!b.built) {
        const barW = size;
        const barH = 4;
        ctx.fillStyle = '#333';
        ctx.fillRect(wx, wy - 8, barW, barH);
        ctx.fillStyle = '#ffaa00';
        ctx.fillRect(wx, wy - 8, barW * (b.buildProgress / b.buildTime), barH);
      }

      if (b.selected) {
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(wx - 2, wy - 2, size + 4, size + 4);
      }

      if (b.built && b.hp < b.maxHp) {
        const barW = size;
        const barH = 3;
        const hpRatio = b.hp / b.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(wx, wy - 6, barW, barH);
        const hpColor = hpRatio > 0.6 ? '#4f4' : hpRatio > 0.3 ? '#ff4' : '#f44';
        ctx.fillStyle = hpColor;
        ctx.fillRect(wx, wy - 6, barW * hpRatio, barH);
      }

      // Training progress bar
      if (b.built && b.trainQueue.length > 0) {
        const item = b.trainQueue[0];
        const bDef = BUILDING_DEFS[b.type];
        const totalTime = bDef.trainTimes[item.type];
        const progress = (totalTime - item.timeLeft) / totalTime;
        const barW = size;
        const barH = 3;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(wx, wy + size + 4, barW, barH);
        ctx.fillStyle = '#72d5ff';
        ctx.fillRect(wx, wy + size + 4, barW * progress, barH);
      }

      // Tower beam
      if (b.type === 'tower' && b.lastShotTarget && b.lastShotTime < 0.2) {
        const alpha = 1 - b.lastShotTime / 0.2;
        ctx.strokeStyle = `rgba(255, 200, 50, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - 10);
        ctx.lineTo(b.lastShotTarget.x, b.lastShotTarget.y);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.stroke();
      }
    }
  }

  _drawUnits(unitManager, camera, map) {
    const { ctx, sprites } = this;
    const sorted = [...unitManager.units].sort((a, b) => a.y - b.y);

    for (const u of sorted) {
      const ux = Math.floor(u.x);
      const uy = Math.floor(u.y);

      // Spawn movement dust (handled in World coordinates)
      if (u.path && u.path.length > 0 && Math.random() < 0.15) {
        this.addParticle({
          x: u.x, y: u.y + 4,
          vx: (Math.random() - 0.5) * 20, vy: -5 - Math.random() * 10,
          life: 0.4, color: '#d2b48c', size: 2, type: 'smoke'
        });
      }

      const img = sprites.getUnit(u.type, u.team);
      if (img) {
        const teamColor = TEAM_COLORS[u.team]?.primary || '#ffffff';

        // Ground Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(ux, uy + 6, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        // Subtle Team Halo/Glow to pop from background
        ctx.shadowColor = teamColor;
        ctx.shadowBlur = 4;
        ctx.drawImage(img, ux - UNIT_SIZE / 2, uy - UNIT_SIZE / 2);
        ctx.shadowBlur = 0;
      }

      // Gathering animation (Picking / Chopping)
      if (u.state === 'gathering' && u.path.length === 0) {
        const isMinerals = u.gatherTarget && map.getTile(u.gatherTarget.x, u.gatherTarget.y) === TILE_MINERAL;
        const swing = Math.sin(u.animTimer * 12) * 5;

        ctx.save();
        ctx.translate(ux + 4, uy);
        ctx.rotate(swing * 0.1);

        // Tool handle
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(0, -2, 8, 2);

        // Tool head
        ctx.fillStyle = isMinerals ? '#999' : '#777'; // Pickaxe (grey) / Axe (darker)
        if (isMinerals) {
          ctx.beginPath();
          ctx.moveTo(8, -4); ctx.lineTo(10, -2); ctx.lineTo(8, 0); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(8, -4); ctx.lineTo(6, -2); ctx.lineTo(8, 0); ctx.fill();
        } else {
          ctx.fillRect(6, -5, 3, 5);
        }
        ctx.restore();

        // Spawn chips/sparks
        if (Math.random() < 0.2) {
          this.addParticle({
            x: ux + 10, y: uy,
            vx: 20 + Math.random() * 40,
            vy: -20 - Math.random() * 40,
            life: 0.3,
            color: isMinerals ? '#ffd740' : '#8B6914',
            size: 1.5
          });
        }
      }

      // Carrying indicator (Detailed visuals)
      if (u.carrying > 0) {
        if (u.carryType === 'wood') {
          // Log bundle
          ctx.fillStyle = '#5d4037';
          ctx.fillRect(ux + 4, uy - 8, 6, 3);
          ctx.fillStyle = '#8B6914';
          ctx.fillRect(ux + 5, uy - 7, 4, 1);
        } else {
          // Gold / Diamond
          ctx.fillStyle = '#ffd740';
          ctx.beginPath();
          ctx.moveTo(ux + 7, uy - 10);
          ctx.lineTo(ux + 10, uy - 7);
          ctx.lineTo(ux + 7, uy - 4);
          ctx.lineTo(ux + 4, uy - 7);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillRect(ux + 6, uy - 8, 1, 1); // Sparkle
        }
      }

      if (u.selected) {
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(ux, uy + 6, 8, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (u.hp < u.maxHp || u.selected) {
        const barW = UNIT_SIZE;
        const barH = 3;
        const p = u.hp / u.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(ux - barW / 2, uy - UNIT_SIZE / 2 - 6, barW, barH);
        ctx.fillStyle = p > 0.6 ? '#4f4' : p > 0.3 ? '#ff0' : '#f44';
        ctx.fillRect(ux - barW / 2, uy - UNIT_SIZE / 2 - 6, barW * p, barH);
      }

      // Combat Effects
      if (u.lastAttackTime < 0.2 && u.lastAttackTarget) {
        const alpha = 1 - (u.lastAttackTime / 0.2);
        const tx = u.lastAttackTarget.x;
        const ty = u.lastAttackTarget.y;

        if (u.type === 'soldier' || u.type === 'worker') {
          // Rapid muzzle flash and small tracer
          ctx.strokeStyle = `rgba(255, 255, 100, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ux, uy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          // Flash at tip
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.beginPath();
          ctx.arc(ux, uy, 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (u.type === 'tank' || u.type === 'battleship') {
          // Heavy tracer
          ctx.strokeStyle = `rgba(255, 200, 50, ${alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(ux, uy - 4);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          // Large Muzzle Flash
          ctx.fillStyle = `rgba(255, 150, 0, ${alpha})`;
          ctx.beginPath(); ctx.arc(ux, uy - 4, 5, 0, Math.PI * 2); ctx.fill();
        } else if (u.type === 'rocket' || u.type === 'bomber') {
          // Projectile visual
          const p = u.lastAttackTime / 0.2;
          const px = ux + (tx - ux) * p;
          const py = uy + (ty - uy) * p;

          ctx.fillStyle = '#ff4400';
          ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();

          // Smoke trail
          if (Math.random() < 0.5) {
            this.addParticle({
              x: px, y: py,
              vx: (Math.random() - 0.5) * 10, vy: -10,
              life: 0.3, color: '#666', size: 3, type: 'smoke'
            });
          }
        }
      }
    }
  }

  _drawBuildGhost(game) {
    if (!game.buildMode) return;
    const { ctx } = this;
    const { camera, map, buildingManager, input } = game;
    const worldPos = camera.screenToWorld(input.mouseX, input.mouseY);
    const tileX = Math.floor(worldPos.x / TILE_SIZE);
    const tileY = Math.floor(worldPos.y / TILE_SIZE);
    const def = BUILDING_DEFS[game.buildMode];
    const size = def.sizeTiles * TILE_SIZE;
    const canPlace = game.buildMode === 'dock'
      ? buildingManager.canPlaceDock(tileX, tileY, map)
      : buildingManager.canPlaceAt(tileX, tileY, def.sizeTiles, map);
    const wx = tileX * TILE_SIZE;
    const wy = tileY * TILE_SIZE;

    ctx.globalAlpha = 0.5;
    const sprite = this.sprites.getBuilding(game.buildMode, TEAM_BLUE);
    ctx.drawImage(sprite, wx, wy, size, size);
    ctx.globalAlpha = 1;

    ctx.fillStyle = canPlace ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 0, 0, 0.3)';
    ctx.fillRect(wx, wy, size, size);
    ctx.strokeStyle = canPlace ? '#0f0' : '#f00';
    ctx.lineWidth = 2;
    ctx.strokeRect(wx, wy, size, size);
  }

  _drawMoveMarkers(camera) {
    const { ctx } = this;
    for (const marker of this.moveMarkers) {
      const alpha = marker.timer / MOVE_MARKER_DURATION;
      const radius = 6 + (1 - alpha) * 10;
      ctx.strokeStyle = `rgba(0, 255, 0, ${alpha * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawMinimap(map, unitManager, buildingManager, camera) {
    const { ctx } = this;
    const mmX = MINIMAP_X;
    const mmY = this.canvas.height - MINIMAP_SIZE - 150; // Adjusted for smaller HUD

    // Check for enemy proximity
    let enemyNearBase = false;
    const playerBuildings = buildingManager.buildings.filter(b => b.team === TEAM_BLUE);
    const enemyUnits = unitManager.units.filter(u => u.team !== TEAM_BLUE);
    for (const b of playerBuildings) {
      for (const e of enemyUnits) {
        const d = Math.sqrt((b.x - e.x) ** 2 + (b.y - e.y) ** 2);
        if (d < 300) { enemyNearBase = true; break; }
      }
      if (enemyNearBase) break;
    }

    // Minimap background & border
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(mmX - 4, mmY - 4, MINIMAP_SIZE + 8, MINIMAP_SIZE + 8);

    if (enemyNearBase && Math.sin(Date.now() / 200) > 0) {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
      ctx.lineWidth = 3;
    } else {
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 2;
    }
    ctx.strokeRect(mmX - 2, mmY - 2, MINIMAP_SIZE + 4, MINIMAP_SIZE + 4);

    if (this.minimapDirty) {
      this._renderMinimapTerrain(map);
      this.minimapDirty = false;
    }
    ctx.drawImage(this.minimapCanvas, mmX, mmY);

    const scaleX = MINIMAP_SIZE / WORLD_W;
    const scaleY = MINIMAP_SIZE / WORLD_H;

    // Draw Buildings (Squares)
    for (const b of buildingManager.buildings) {
      const bx = mmX + b.x * scaleX;
      const by = mmY + b.y * scaleY;
      const size = (b.sizeTiles === 2 ? 6 : 4);
      ctx.fillStyle = TEAM_COLORS[b.team]?.primary || '#ffffff';
      ctx.fillRect(Math.floor(bx) - size / 2, Math.floor(by) - size / 2, size, size);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(Math.floor(bx) - size / 2, Math.floor(by) - size / 2, size, size);
    }

    // Draw Units (Dots)
    for (const unit of unitManager.units) {
      const ux = mmX + unit.x * scaleX;
      const uy = mmY + unit.y * scaleY;
      ctx.fillStyle = unit.team === TEAM_BLUE ? '#aaccff' : (TEAM_COLORS[unit.team]?.light || '#ffaa00');
      if (unit.type === 'tank') {
        ctx.fillRect(Math.floor(ux) - 1.5, Math.floor(uy) - 1.5, 3, 3);
      } else {
        ctx.beginPath();
        ctx.arc(ux, uy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Viewport
    const vx = mmX + camera.x * scaleX;
    const vy = mmY + camera.y * scaleY;
    const vw = camera.viewW * scaleX;
    const vh = camera.viewH * scaleY;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  _renderMinimapTerrain(map) {
    const mmCtx = this.minimapCanvas.getContext('2d');
    const pw = MINIMAP_SIZE / MAP_WIDTH;
    const ph = MINIMAP_SIZE / MAP_HEIGHT;
    const colors = { 0: '#c2a86e', 1: '#2266aa', 2: '#9a8a6e', 3: '#5a7a3a', 4: '#44ccff', 5: '#8a8070' };
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        mmCtx.fillStyle = colors[map.getTile(x, y)] || '#000';
        mmCtx.fillRect(x * pw, y * ph, Math.ceil(pw), Math.ceil(ph));
      }
    }
  }

  _formatCost(cost) {
    if (!cost) return '';
    const parts = [];
    if (cost.minerals) parts.push(`${cost.minerals}m`);
    if (cost.wood) parts.push(`${cost.wood}w`);
    return parts.join('+');
  }

  _drawHUD(game) {
    const selected = game.unitManager.getSelected();
    const selectedBuildings = game.buildingManager.buildings.filter(b => b.selected);
    const hudInfo = document.getElementById('hud-info');
    const hudActions = document.getElementById('hud-actions');
    const res = game.getResources(TEAM_BLUE);

    let infoHtml = '';
    let actionsHtml = '';

    if (game.buildMode) {
      const def = BUILDING_DEFS[game.buildMode];
      infoHtml = `<h3>Place ${def.name}</h3><p>Cost: <span style="color:#ffd740">${this._formatCost(def.cost)}</span></p><p>Click on the map to place building.</p><p>Right-click or ESC to cancel.</p>`;
      actionsHtml = this._makeBtn('Cancel', '✖', 'ESC', null, 'cancel', false);
    } else if (selectedBuildings.length > 0) {
      const b = selectedBuildings[0];
      const def = BUILDING_DEFS[b.type];
      infoHtml = `<h3>${def.name}</h3><p>Status: ${b.built ? '<span style="color:#4f4">Operational</span>' : '<span style="color:#ffcc00">Under Construction (' + Math.floor((b.buildProgress / b.buildTime) * 100) + '%)</span>'}</p><p>Armor: Heavy | HP: ${Math.floor(b.hp)} / ${b.maxHp}</p>`;
      if (b.built && b.trainQueue.length > 0) {
        const current = b.trainQueue[0];
        const totalTime = def.trainTimes[current.type];
        const progress = Math.floor(((totalTime - current.timeLeft) / totalTime) * 100);

        infoHtml += `
          <div style="margin-top:12px">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px">
              <span style="font-size:11px; color:#72d5ff">Training ${UNIT_DEFS[current.type].name}...</span>
              <span style="font-size:11px; color:#fff">${progress}%</span>
            </div>
            <div style="width:100%; height:5px; background:rgba(0,0,0,0.4); border-radius:10px; border:1px solid rgba(255,255,255,0.1)">
              <div style="width:${progress}%; height:100%; background:linear-gradient(90deg, #4488ff, #72d5ff); transition: width 0.3s ease"></div>
            </div>
          </div>
        `;

        if (b.trainQueue.length > 1) {
          const nextItems = b.trainQueue.slice(1).map(item => `
            <span style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; font-size:10px; color:#aaa; border:1px solid rgba(255,255,255,0.1)">
              ${UNIT_DEFS[item.type].icon}
            </span>
          `).join('');
          infoHtml += `<div style="margin-top:10px; display:flex; gap:4px; align-items:center"><span style="font-size:10px; color:#666; margin-right:4px">QUEUE:</span>${nextItems}</div>`;
        }
      }
      if (b.built) {
        for (const unitType of def.produces) {
          const cost = def.trainCosts[unitType];
          const unitDef = UNIT_DEFS[unitType];
          const canAfford = res.minerals >= (cost.minerals || 0) && res.wood >= (cost.wood || 0) && b.trainQueue.length < 5;
          const stats = `${unitDef.name} - Cost: ${this._formatCost(cost)} | HP:${unitDef.hp} DMG:${unitDef.damage}`;
          actionsHtml += this._makeBtn(unitDef.name, unitDef.icon, unitDef.hotkey.toUpperCase(), cost, `train:${unitType}:${b.id}`, !canAfford, stats);
        }
        if (def.canBuild && def.canBuild.length > 0) {
          for (const buildType of def.canBuild) {
            const bDef = BUILDING_DEFS[buildType];
            const canAfford = res.minerals >= (bDef.cost.minerals || 0) && res.wood >= (bDef.cost.wood || 0);
            const buildStats = `${bDef.name} - Cost: ${this._formatCost(bDef.cost)} | HP:${bDef.hp}`;
            actionsHtml += this._makeBtn(bDef.shortName, bDef.hotkey.toUpperCase(), bDef.hotkey.toUpperCase(), bDef.cost, `build:${buildType}`, !canAfford, buildStats);
          }
        }
      }
    } else if (selected.length === 0) {
      const pCount = game.unitManager.getPlayerUnits(TEAM_BLUE).length;
      const eCount = game.unitManager.units.filter(u => u.team !== TEAM_BLUE).length;
      infoHtml = `<h3>Global Command</h3><p>Tactical Overview:</p><p>• Friendly Forces: ${pCount}</p><p>• Enemy Presence: ${eCount}</p><p style="color:#555; margin-top:8px; font-style:italic">Select units or structures to issue commands.</p>`;
    } else {
      const typeCounts = {};
      for (const u of selected) typeCounts[u.type] = (typeCounts[u.type] || 0) + 1;
      const hasWorker = typeCounts.worker > 0;
      if (selected.length === 1) {
        const u = selected[0];
        const unitDef = UNIT_DEFS[u.type];
        const stateLabel = u.state === 'gathering' ? 'Harvesting' : u.state === 'returning' ? 'Returning to HQ' : u.state === 'building' ? 'Constructing' : u.state === 'attackingBuilding' ? 'Sieging' : u.state.charAt(0).toUpperCase() + u.state.slice(1);
        infoHtml = `<h3>${unitDef.name}</h3><p>Status: <span style="color:#72d5ff">${stateLabel}</span></p><p>Vitality: ${Math.floor(u.hp)} / ${u.maxHp}</p><p>Combat: ATK ${u.damage} | ARM ${u.armor}</p>`;
        if (u.carrying > 0) {
          const color = u.carryType === 'wood' ? '#8B6914' : '#44ccff';
          infoHtml += `<p style="color:${color}; font-weight:bold">Cargo: ${u.carrying} ${u.carryType}</p>`;
        }
      } else {
        infoHtml = `<h3>Brigade Selected (${selected.length})</h3>`;
        const parts = Object.entries(typeCounts).map(([t, c]) => `<span>${UNIT_DEFS[t].name}: ${c}</span>`);
        infoHtml += `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:5px">${parts.join('')}</div>`;
      }
      if (hasWorker) {
        const sorted = Object.entries(BUILDING_DEFS).sort((a, b) => a[1].cost.minerals - b[1].cost.minerals);
        for (const [bType, bDef] of sorted) {
          const canAfford = res.minerals >= (bDef.cost.minerals || 0) && res.wood >= (bDef.cost.wood || 0);
          const bStats = `${bDef.name} - Cost: ${this._formatCost(bDef.cost)} | HP:${bDef.hp}`;
          actionsHtml += this._makeBtn(bDef.shortName, bDef.hotkey.toUpperCase(), bDef.hotkey.toUpperCase(), bDef.cost, `build:${bType}`, !canAfford, bStats);
        }
      }
    }
    hudInfo.innerHTML = infoHtml;
    hudActions.innerHTML = actionsHtml;
    hudActions.querySelectorAll('.action-btn:not(.disabled)').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (!action) return;
        game.handleHudAction(action);
      });
    });
    const resEl = document.getElementById('resources');
    resEl.innerHTML = `<div class="res-item"><div class="res-icon" style="background:#44ccff; box-shadow:0 0 5px #44ccff"></div><span>${res.minerals}</span></div><div class="res-item"><div class="res-icon" style="background:#8B6914; box-shadow:0 0 5px #8B6914"></div><span>${res.wood}</span></div>`;
  }

  _makeBtn(label, icon, key, cost, action, disabled, tooltip = '') {
    const cls = disabled ? 'action-btn disabled' : 'action-btn';
    const costStr = cost ? `<span class="btn-cost">${this._formatCost(cost)}</span>` : '';
    const tooltipAttr = tooltip ? `title="${tooltip}"` : '';
    return `<button class="${cls}" data-action="${action}" ${tooltipAttr}><span class="btn-key">${key}</span><span class="btn-icon">${icon}</span><span class="btn-label">${label}</span>${costStr}</button>`;
  }

  screenToMinimapWorld(sx, sy) {
    const mmX = MINIMAP_X;
    const mmY = this.canvas.height - MINIMAP_SIZE - 150;
    if (sx >= mmX && sx <= mmX + MINIMAP_SIZE && sy >= mmY && sy <= mmY + MINIMAP_SIZE) {
      const rx = (sx - mmX) / MINIMAP_SIZE;
      const ry = (sy - mmY) / MINIMAP_SIZE;
      return { worldX: rx * WORLD_W, worldY: ry * WORLD_H };
    }
    return null;
  }
}
