import { TILE_SIZE, UNIT_SIZE, TEAM_COLORS } from './constants.js';

export const TILE_PALETTES = {
  verdant: {
    grass: { base: '#c2a86e', noise: ['#b89d60', '#cbb477', '#c2a86e', '#d4c08a', '#b5975a'], specular: '#d4c08a' },
    water: { base: '#2266aa', noise: ['#1d5c99', '#2870b0', '#2266aa', '#2e78b8'], waves: 'rgba(255,255,255,0.15)' },
    dirt: { base: '#9a8a6e', noise: ['#8c7c60', '#a89474', '#9a8a6e', '#b09a7c'], spots: '#7a6c54' },
    tree: { trunk: '#6b5840', foliage: ['#5a7a3a', '#4e6e30', '#668844', '#557735'], highlight: '#7a9a55', base: '#c2a86e' },
    mineral: { base: '#b09a70', crystal: ['#44ccff', '#33aadd', '#55ddff', '#2299cc', '#66eeff'] },
    rock: { base: '#888', noise: ['#777', '#999', '#888'] }
  },
  obsidian: {
    grass: { base: '#2a2a2e', noise: ['#1a1a1e', '#333338', '#2a2a2e', '#222226', '#121215'], specular: '#3a3a40' },
    water: { base: '#1a0a20', noise: ['#250f30', '#1a0a20', '#15081a', '#301540'], waves: 'rgba(180,100,255,0.12)' },
    dirt: { base: '#3d3d45', noise: ['#2e2e35', '#4d4d55', '#3d3d45', '#555560'], spots: '#1a1a20' },
    tree: { trunk: '#2a1a1a', foliage: ['#2a5a2a', '#1e4e1e', '#336633', '#2a4a2a'], highlight: '#3a7a3a', base: '#2a2a2e' },
    mineral: { base: '#222', crystal: ['#ff4444', '#dd2222', '#ff6666', '#aa1111', '#ff8888'] },
    rock: { base: '#333', noise: ['#222', '#444', '#333'] }
  },
  frozen: {
    grass: { base: '#eefaff', noise: ['#ddeecc', '#e6f5ff', '#ffffff', '#cceeff', '#bbddff'], specular: '#ffffff' },
    water: { base: '#44aacc', noise: ['#3399bb', '#55bbdd', '#44aacc', '#66ccff'], waves: 'rgba(255,255,255,0.5)' },
    dirt: { base: '#cbdce6', noise: ['#b8cada', '#d9e9f2', '#cbdce6', '#e6f0f5'], spots: '#a8b9c6' },
    tree: { trunk: '#4a4035', foliage: ['#3a7a4a', '#2e6e3e', '#4a8a5a', '#357745'], highlight: '#5a9a6a', base: '#eefaff' },
    mineral: { base: '#a0b0c0', crystal: ['#ffffff', '#e0f0ff', '#ccddff', '#bbccff', '#ddeeff'] },
    rock: { base: '#cbdce6', noise: ['#b8cada', '#d9e9f2', '#cbdce6'] }
  }
};

function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// --- TILE SPRITES ---

function drawGrassTile(variant = 0, p) {
  const c = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = c.getContext('2d');
  const rng = seededRandom(variant * 777 + 42);

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rng() * TILE_SIZE);
    const y = Math.floor(rng() * TILE_SIZE);
    ctx.fillStyle = p.noise[Math.floor(rng() * p.noise.length)];
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = p.specular;
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rng() * (TILE_SIZE - 3));
    const y = Math.floor(rng() * (TILE_SIZE - 2));
    ctx.fillRect(x, y, 2, 1);
  }

  return c;
}

function drawWaterTile(variant = 0, p) {
  const c = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = c.getContext('2d');
  const rng = seededRandom(variant * 333 + 99);

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rng() * TILE_SIZE);
    const y = Math.floor(rng() * TILE_SIZE);
    ctx.fillStyle = p.noise[Math.floor(rng() * p.noise.length)];
    ctx.fillRect(x, y, 3, 1);
  }

  ctx.fillStyle = p.waves;
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rng() * (TILE_SIZE - 6));
    const y = Math.floor(rng() * TILE_SIZE);
    ctx.fillRect(x, y, 4 + Math.floor(rng() * 4), 1);
  }

  return c;
}

function drawDirtTile(variant = 0, p) {
  const c = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = c.getContext('2d');
  const rng = seededRandom(variant * 555 + 77);

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  for (let i = 0; i < 35; i++) {
    const x = Math.floor(rng() * TILE_SIZE);
    const y = Math.floor(rng() * TILE_SIZE);
    ctx.fillStyle = p.noise[Math.floor(rng() * p.noise.length)];
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = p.spots;
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rng() * (TILE_SIZE - 3));
    const y = Math.floor(rng() * (TILE_SIZE - 3));
    ctx.fillRect(x, y, 2, 2);
  }

  return c;
}

function drawTreeTile(variant = 0, p) {
  const c = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = c.getContext('2d');
  const rng = seededRandom(variant * 111 + 55);

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(15, 22, 5, 8);

  ctx.fillStyle = p.trunk;
  ctx.fillRect(13, 18, 5, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(14, 19, 1, 10);

  const cx = 15, cy = 13;
  const leaves = p.foliage;
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy * 1.2);
      if (dist < 7 + rng() * 2 && rng() > 0.15) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < TILE_SIZE && py >= 0 && py < TILE_SIZE) {
          ctx.fillStyle = leaves[Math.floor(rng() * leaves.length)];
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  ctx.fillStyle = p.highlight;
  for (let i = 0; i < 5; i++) {
    const x = cx - 4 + Math.floor(rng() * 8);
    const y = cy - 4 + Math.floor(rng() * 6);
    ctx.fillRect(x, y, 1, 1);
  }

  return c;
}

function drawMineralTile(variant = 0, p) {
  const c = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = c.getContext('2d');
  const rng = seededRandom(variant * 222 + 88);

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  const crystalColors = p.crystal;
  const numCrystals = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < numCrystals; i++) {
    const x = 8 + Math.floor(rng() * 12);
    const y = 8 + Math.floor(rng() * 12);
    const size = 3 + Math.floor(rng() * 4);
    ctx.fillStyle = crystalColors[Math.floor(rng() * crystalColors.length)];
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size / 2, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size / 2, y);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 1, y - size + 1, 1, 1);
  }

  return c;
}

function drawRockTile(variant = 0, p) {
  const c = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = c.getContext('2d');
  const rng = seededRandom(variant * 99 + 11);

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  for (let i = 0; i < 4; i++) {
    const x = 4 + rng() * 20;
    const y = 4 + rng() * 20;
    const w = 4 + rng() * 8;
    const h = 4 + rng() * 6;
    ctx.fillStyle = p.noise[Math.floor(rng() * p.noise.length)];
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.strokeRect(x, y, w, h);
  }

  return c;
}


// --- UNIT SPRITES ---

function drawWorker(teamId) {
  const c = createCanvas(UNIT_SIZE, UNIT_SIZE);
  const ctx = c.getContext('2d');
  const colors = TEAM_COLORS[teamId];

  const skin = '#FFCC99';
  const shirt = '#d4c08a'; // Sallow/Sand shirt (different from military blue)
  const overalls = '#4a6a8a'; // Blue overalls
  const hat = '#c2a86e'; // Straw hat
  const boot = '#332211';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(8, 14, 4, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = shirt;
  ctx.fillRect(5, 7, 6, 4);
  ctx.fillStyle = overalls;
  ctx.fillRect(5, 9, 6, 3);
  ctx.fillRect(5, 12, 2, 2); // Left leg
  ctx.fillRect(9, 12, 2, 2); // Right leg

  // Overall straps
  ctx.fillRect(5, 7, 1, 2);
  ctx.fillRect(10, 7, 1, 2);

  // Boots
  ctx.fillStyle = boot;
  ctx.fillRect(5, 14, 2, 1);
  ctx.fillRect(9, 14, 2, 1);

  // Head
  ctx.fillStyle = skin;
  ctx.fillRect(6, 3, 4, 4);

  // Straw Hat (Distinct Farmer look)
  ctx.fillStyle = hat;
  ctx.fillRect(4, 3, 8, 1); // Brim
  ctx.fillRect(5, 2, 6, 1); // Top
  ctx.fillStyle = '#b09a60'; // Hat detail
  ctx.fillRect(5, 3, 1, 1);
  ctx.fillRect(10, 3, 1, 1);

  // Arms
  ctx.fillStyle = skin;
  ctx.fillRect(3, 8, 2, 2);
  ctx.fillRect(11, 8, 2, 2);

  // Tool (Scythe/Pickaxe)
  ctx.fillStyle = '#777';
  ctx.fillRect(13, 4, 1, 8); // Handle
  ctx.fillStyle = '#aaa';
  ctx.fillRect(11, 4, 3, 1); // Head

  // Team Armband (to still show ownership)
  ctx.fillStyle = colors.primary;
  ctx.fillRect(11, 8, 1, 1);

  return c;
}

function drawSoldier(teamId) {
  const c = createCanvas(UNIT_SIZE, UNIT_SIZE);
  const ctx = c.getContext('2d');
  const colors = TEAM_COLORS[teamId];

  const armorLower = colors.dark;
  const armorUpper = colors.primary;
  const metal = '#cfd8dc';
  const metalDark = '#78909c';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(8, 14, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Helmet (Knight-like/Heavy Infantry)
  ctx.fillStyle = metal;
  ctx.fillRect(5, 1, 6, 6);
  ctx.fillStyle = metalDark;
  ctx.fillRect(5, 6, 6, 1); // Chin
  ctx.fillStyle = '#222'; // Visor slit
  ctx.fillRect(6, 4, 4, 1);

  // Body Armor
  ctx.fillStyle = armorUpper;
  ctx.fillRect(4, 7, 8, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.2)'; // Chest Highlight
  ctx.fillRect(5, 8, 2, 2);

  // Pauldrons
  ctx.fillStyle = metal;
  ctx.fillRect(3, 7, 2, 3);
  ctx.fillRect(11, 7, 2, 3);

  // Legs
  ctx.fillStyle = armorLower;
  ctx.fillRect(5, 12, 2, 3);
  ctx.fillRect(9, 12, 2, 3);

  // Weapon: Sword (Glowing edge)
  ctx.fillStyle = '#546e7a';
  ctx.fillRect(13, 2, 1, 10);
  ctx.fillStyle = '#81d4fa'; // Glow
  ctx.fillRect(14, 2, 1, 10);
  ctx.fillStyle = '#ffb300'; // Hilt
  ctx.fillRect(12, 9, 3, 1);

  // Shield
  ctx.fillStyle = colors.primary;
  ctx.fillRect(1, 8, 3, 5);
  ctx.fillStyle = '#fff';
  ctx.fillRect(2, 9, 1, 3);

  return c;
}

function drawTank(teamId) {
  const c = createCanvas(UNIT_SIZE, UNIT_SIZE);
  const ctx = c.getContext('2d');
  const colors = TEAM_COLORS[teamId];

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(8, 14, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Treads (Chunky)
  ctx.fillStyle = '#333';
  ctx.fillRect(1, 5, 4, 10);
  ctx.fillRect(11, 5, 4, 10);
  ctx.fillStyle = '#444';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(1, 6 + i * 2, 4, 1);
    ctx.fillRect(11, 6 + i * 2, 4, 1);
  }

  // Hull (Rounded edges)
  ctx.fillStyle = colors.dark;
  ctx.fillRect(3, 4, 10, 10);
  ctx.fillStyle = colors.primary;
  ctx.fillRect(4, 5, 8, 8);

  // Hull Highlight
  ctx.fillStyle = colors.light;
  ctx.fillRect(4, 5, 6, 1);
  ctx.fillRect(4, 5, 1, 6);

  // Turret base
  ctx.fillStyle = '#555';
  ctx.fillRect(5, 6, 6, 6);
  ctx.fillStyle = colors.primary;
  ctx.fillRect(6, 7, 4, 4);

  // Cannon barrel (Recoiling look)
  ctx.fillStyle = '#666';
  ctx.fillRect(7, 0, 2, 8);
  ctx.fillStyle = '#888'; // Top highlight
  ctx.fillRect(7, 0, 1, 8);

  // Muzzle brake
  ctx.fillStyle = '#333';
  ctx.fillRect(6, 0, 4, 2);

  // Hatch
  ctx.fillStyle = '#222';
  ctx.fillRect(7, 8, 2, 2);

  return c;
}

function drawRocket(teamId) {
  const c = createCanvas(UNIT_SIZE, UNIT_SIZE);
  const ctx = c.getContext('2d');
  const colors = TEAM_COLORS[teamId];

  const skin = '#FFCC99';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(8, 14, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body - Camo fatigues
  ctx.fillStyle = '#3d4e30';
  ctx.fillRect(5, 7, 6, 5);
  ctx.fillStyle = '#2d3e20';
  ctx.fillRect(5, 12, 2, 3);
  ctx.fillRect(9, 12, 2, 3);

  // Head with helmet
  ctx.fillStyle = skin;
  ctx.fillRect(6, 3, 4, 4);
  ctx.fillStyle = '#3d4e30';
  ctx.fillRect(5, 2, 6, 2);

  // Rocket launcher (Large and visible)
  ctx.fillStyle = '#444';
  ctx.fillRect(10, 2, 5, 4); // Launcher box
  ctx.fillStyle = '#777';
  ctx.fillRect(11, 0, 3, 8); // Tube
  ctx.fillStyle = '#333';
  ctx.fillRect(11, 0, 3, 1); // Front rim

  // Rocket tip
  ctx.fillStyle = '#ff3d00';
  ctx.fillRect(12, 0, 1, 1);

  // Backpack
  ctx.fillStyle = '#4e3b2a';
  ctx.fillRect(4, 7, 2, 5);

  // Team identification (Goggle/Visor)
  ctx.fillStyle = colors.primary;
  ctx.fillRect(6, 4, 4, 1);

  return c;
}

function drawBomber(teamId) {
  const c = createCanvas(UNIT_SIZE, UNIT_SIZE);
  const ctx = c.getContext('2d');
  const colors = TEAM_COLORS[teamId];

  // Air Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.ellipse(8, 15, 8, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wings (Swept back)
  ctx.fillStyle = colors.dark;
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(0, 8);
  ctx.lineTo(0, 10);
  ctx.lineTo(8, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(16, 8);
  ctx.lineTo(16, 10);
  ctx.lineTo(8, 8);
  ctx.fill();

  ctx.fillStyle = colors.primary;
  ctx.fillRect(0, 8, 16, 1); // Leading edge highlight

  // Fuselage (Sleek)
  ctx.fillStyle = '#cfd8dc';
  ctx.fillRect(6, 2, 4, 12);
  ctx.fillStyle = '#90a4ae';
  ctx.fillRect(9, 2, 1, 12); // Shading

  // Nose
  ctx.fillStyle = '#455a64';
  ctx.fillRect(7, 0, 2, 3);

  // Cockpit (Glassy)
  ctx.fillStyle = '#81d4fa';
  ctx.fillRect(7, 3, 2, 3);
  ctx.fillStyle = '#fff';
  ctx.fillRect(7, 3, 1, 1);

  // Tail Fin
  ctx.fillStyle = colors.primary;
  ctx.fillRect(7, 12, 2, 3);
  ctx.fillRect(5, 13, 6, 1);

  // Engines (Glow)
  ctx.fillStyle = '#ffab00';
  ctx.fillRect(3, 9, 2, 2);
  ctx.fillRect(11, 9, 2, 2);

  return c;
}

// --- BUILDING SPRITES ---

function drawBase(teamId) {
  const size = TILE_SIZE * 2;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const tc = TEAM_COLORS[teamId];

  // Building Glow
  ctx.shadowColor = tc.light;
  ctx.shadowBlur = 4;
  ctx.strokeStyle = tc.primary;
  ctx.lineWidth = 1;
  ctx.strokeRect(4, 4, size - 8, size - 8);
  ctx.shadowBlur = 0;

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(5, 10, size - 6, size - 6);

  // Stone foundation with shading
  ctx.fillStyle = '#5d564a';
  ctx.fillRect(2, 4, size - 4, size - 6);
  ctx.fillStyle = '#7e766a'; // Highlight
  ctx.fillRect(2, 4, size - 4, 1);
  ctx.fillRect(2, 4, 1, size - 6);
  ctx.fillStyle = '#4a4238'; // Shadow
  ctx.fillRect(2, size - 3, size - 4, 1);
  ctx.fillRect(size - 3, 4, 1, size - 6);

  // Inner floor with texture
  ctx.fillStyle = '#8a8070';
  ctx.fillRect(5, 7, size - 10, size - 12);
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(8 + i * 14, 10, 8, 8);
  }

  // Main roof (team color) with shading
  ctx.fillStyle = tc.primary;
  ctx.fillRect(6, 6, size - 12, size - 16);

  // Roof highlight
  ctx.fillStyle = tc.light;
  ctx.fillRect(6, 6, size - 12, 3);
  ctx.fillRect(6, 6, 3, size - 16);

  // Roof shadow
  ctx.fillStyle = tc.dark;
  ctx.fillRect(6, size - 14, size - 12, 4);
  ctx.fillRect(size - 10, 6, 4, size - 16);

  // Corner towers with depth
  const turretPositions = [[2, 2], [size - 10, 2], [2, size - 12], [size - 10, size - 12]];
  for (const [tx, ty] of turretPositions) {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(tx + 1, ty + 1, 8, 8);

    ctx.fillStyle = '#7a7268';
    ctx.fillRect(tx, ty, 8, 8);
    ctx.fillStyle = '#aaa298'; // Highlight
    ctx.fillRect(tx, ty, 8, 1);
    ctx.fillRect(tx, ty, 1, 8);

    ctx.fillStyle = tc.dark;
    ctx.fillRect(tx + 2, ty + 2, 4, 4);

    // Tower top detail
    ctx.fillStyle = '#555';
    ctx.fillRect(tx + 3, ty - 1, 2, 2);
  }

  // Grand entrance
  ctx.fillStyle = '#4a3c2e';
  ctx.fillRect(22, size - 11, 20, 9);
  ctx.fillStyle = '#2a1e12';
  ctx.fillRect(24, size - 10, 16, 7);

  // Steps
  ctx.fillStyle = '#554838';
  ctx.fillRect(23, size - 4, 18, 2);
  ctx.fillRect(25, size - 2, 14, 2);

  // Windows with "glow"
  for (let i = 0; i < 3; i++) {
    const wx = 14 + i * 14;
    ctx.fillStyle = '#1a3557';
    ctx.fillRect(wx, 16, 6, 6);
    ctx.fillStyle = '#4fc3f7'; // Lighted window
    ctx.fillRect(wx + 1, 17, 4, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(wx + 2, 18, 1, 1);
  }

  // Central flag pole
  ctx.fillStyle = '#888';
  ctx.fillRect(31, 1, 2, 12);

  // Waving flag effect (base)
  ctx.fillStyle = tc.primary;
  ctx.beginPath();
  ctx.moveTo(33, 1);
  ctx.lineTo(48, 4);
  ctx.lineTo(33, 8);
  ctx.fill();
  ctx.fillStyle = tc.light;
  ctx.fillRect(33, 1, 8, 2);

  // Stone wall texture
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y = 8; y < size - 8; y += 4) {
    const offset = (y % 8 === 0) ? 0 : 3;
    for (let x = 4 + offset; x < size - 4; x += 6) {
      ctx.fillRect(x, y, 5, 1);
    }
  }

  return c;
}

function drawBarracks(teamId) {
  const size = TILE_SIZE * 3;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const tc = TEAM_COLORS[teamId];

  // Building Glow
  ctx.shadowColor = tc.light;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = tc.primary;
  ctx.lineWidth = 1;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  ctx.shadowBlur = 0;

  // Foundations
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(8, 12, size - 10, size - 10);
  ctx.fillStyle = '#4a4540';
  ctx.fillRect(4, 8, size - 8, size - 12);

  // Four corner towers
  const towerSize = 24;
  const towers = [
    [0, 0], [size - towerSize, 0],
    [0, size - towerSize], [size - towerSize, size - towerSize]
  ];

  for (const [tx, ty] of towers) {
    ctx.fillStyle = '#5e5850';
    ctx.fillRect(tx, ty, towerSize, towerSize);
    ctx.fillStyle = '#7e7670';
    ctx.fillRect(tx, ty, towerSize, 4); // Top

    // Tower roof
    ctx.fillStyle = tc.dark;
    ctx.fillRect(tx + 4, ty + 4, towerSize - 8, towerSize - 8);

    // Tower detail
    ctx.fillStyle = '#333';
    ctx.fillRect(tx + towerSize / 2 - 2, ty + 8, 4, 8);
  }

  // Connecting walls
  ctx.fillStyle = '#5c5548';
  ctx.fillRect(towerSize, 4, size - (towerSize * 2), 16); // Top wall
  ctx.fillRect(4, towerSize, 16, size - (towerSize * 2)); // Left wall
  ctx.fillRect(size - 20, towerSize, 16, size - (towerSize * 2)); // Right wall

  // Center Training Ground (Units "spawn" here)
  ctx.fillStyle = '#8a7a60';
  ctx.fillRect(20, 20, size - 40, size - 40);
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  // Ground patterns
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(25 + i * 18, 25, 12, 12);
    ctx.fillRect(25 + i * 18, 55, 12, 12);
  }

  // Large Grand Gate (South Wall)
  ctx.fillStyle = '#3a2e22';
  const gateW = 32;
  ctx.fillRect(size / 2 - gateW / 2, size - 12, gateW, 12);
  // Gate detail
  ctx.strokeStyle = tc.primary;
  ctx.lineWidth = 2;
  ctx.strokeRect(size / 2 - gateW / 2 + 2, size - 10, gateW - 4, 10);

  // Weapon Racks & Dummies in the yard
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(25, 45, 10, 3); // Rack
  ctx.fillStyle = '#ccc';
  ctx.fillRect(26, 40, 2, 6); // Weapon
  ctx.fillRect(31, 40, 2, 6);

  ctx.fillStyle = '#ccaa80';
  ctx.beginPath();
  ctx.arc(65, 35, 4, 0, Math.PI * 2); // Dummy head
  ctx.fill();
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(63, 39, 4, 10); // Dummy post

  // Banners
  ctx.fillStyle = tc.primary;
  ctx.fillRect(towerSize - 6, 10, 4, 15);
  ctx.fillRect(size - towerSize + 2, 10, 4, 15);

  return c;
}

function drawFactory(teamId) {
  const size = TILE_SIZE * 3;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const tc = TEAM_COLORS[teamId];

  // Building Glow
  ctx.shadowColor = tc.light;
  ctx.shadowBlur = 5;
  ctx.strokeStyle = tc.primary;
  ctx.lineWidth = 1;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  ctx.shadowBlur = 0;

  // Concrete slabs
  ctx.fillStyle = '#444';
  ctx.fillRect(4, 4, size - 8, size - 8);
  ctx.fillStyle = '#666';
  ctx.fillRect(4, 4, size - 8, 2);

  // Main high-bay hall
  ctx.fillStyle = '#333';
  ctx.fillRect(10, 20, size - 20, size - 40);

  // Sawtooth roof (Industrial classic)
  ctx.fillStyle = tc.dark;
  for (let i = 0; i < 3; i++) {
    const rx = 10 + i * (size - 20) / 3;
    ctx.beginPath();
    ctx.moveTo(rx, 20);
    ctx.lineTo(rx + 20, 10);
    ctx.lineTo(rx + 20, 20);
    ctx.fill();
  }

  // Large Smokestacks
  for (const sx of [12, size - 24]) {
    ctx.fillStyle = '#555';
    ctx.fillRect(sx, 0, 12, 25);
    ctx.fillStyle = '#333';
    ctx.fillRect(sx, 22, 12, 3); // Bands
    ctx.fillRect(sx, 12, 12, 2);
  }

  // Heavy Garage Door (South Entrance)
  ctx.fillStyle = '#111';
  const doorW = 48;
  ctx.fillRect(size / 2 - doorW / 2, size - 20, doorW, 16);
  // Metal shutter lines
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let y = size - 18; y < size - 4; y += 4) {
    ctx.beginPath();
    ctx.moveTo(size / 2 - doorW / 2, y);
    ctx.lineTo(size / 2 + doorW / 2, y);
    ctx.stroke();
  }
  ctx.strokeStyle = tc.primary;
  ctx.lineWidth = 2;
  ctx.strokeRect(size / 2 - doorW / 2, size - 20, doorW, 16);

  // Side machine rooms
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(4, 30, 6, 40);
  ctx.fillRect(size - 10, 30, 6, 40);

  // Blueprints/Windows
  ctx.fillStyle = 'rgba(79, 195, 247, 0.2)';
  ctx.fillRect(15, 30, 10, 15);
  ctx.fillRect(size - 25, 30, 10, 15);

  return c;
}

function drawTower(teamId) {
  const size = TILE_SIZE;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const tc = TEAM_COLORS[teamId];

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(16, 28, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stone base (Foundation)
  ctx.fillStyle = '#5d564a';
  ctx.fillRect(4, 22, 24, 8);
  ctx.fillStyle = '#7e766a'; // Highlight
  ctx.fillRect(4, 22, 24, 2);

  // Tower body (Stronger structure)
  ctx.fillStyle = '#6e6658';
  ctx.fillRect(7, 6, 18, 16);
  ctx.fillStyle = '#8e867a'; // Side light
  ctx.fillRect(7, 6, 2, 16);
  ctx.fillStyle = '#4e4638'; // Shadow
  ctx.fillRect(23, 6, 2, 16);

  // Arrow slit / Portal
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(14, 10, 4, 8);
  ctx.fillStyle = 'rgba(255, 200, 50, 0.4)'; // Subtle glow from inside
  ctx.fillRect(15, 11, 2, 6);

  // Top platform (Team color trim)
  ctx.fillStyle = tc.dark;
  ctx.fillRect(5, 5, 22, 4);
  ctx.fillStyle = tc.primary;
  ctx.fillRect(5, 5, 22, 1);

  // Crenellation (Better defined)
  ctx.fillStyle = '#5d564a';
  for (let x = 5; x < 26; x += 5) {
    ctx.fillRect(x, 2, 3, 4);
  }

  // Team color banner / Shield on wall
  ctx.fillStyle = tc.primary;
  ctx.beginPath();
  ctx.moveTo(13, 16);
  ctx.lineTo(19, 16);
  ctx.lineTo(16, 22);
  ctx.fill();
  ctx.fillStyle = tc.light;
  ctx.fillRect(14, 17, 4, 1);

  // Flag on top (Waving)
  ctx.fillStyle = '#444';
  ctx.fillRect(20, -2, 1, 8);
  ctx.fillStyle = tc.primary;
  ctx.fillRect(21, -2, 7, 4);
  ctx.fillStyle = tc.light;
  ctx.fillRect(21, -2, 7, 1);

  // Texture details
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(9 + i * 3, 10 + (i % 2) * 4, 2, 1);
  }

  return c;
}

// --- BATTLESHIP (naval unit) ---
function drawBattleship(teamId) {
  const c = createCanvas(UNIT_SIZE, UNIT_SIZE);
  const ctx = c.getContext('2d');
  const colors = TEAM_COLORS[teamId];

  // Water wake
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.ellipse(8, 14, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hull (pointed bow at top)
  ctx.fillStyle = colors.dark;
  ctx.beginPath();
  ctx.moveTo(8, 1);
  ctx.lineTo(13, 5);
  ctx.lineTo(13, 13);
  ctx.lineTo(3, 13);
  ctx.lineTo(3, 5);
  ctx.closePath();
  ctx.fill();

  // Deck
  ctx.fillStyle = '#8B7355';
  ctx.fillRect(4, 6, 8, 6);

  // Superstructure
  ctx.fillStyle = '#555';
  ctx.fillRect(5, 4, 6, 5);
  ctx.fillStyle = colors.primary;
  ctx.fillRect(6, 3, 4, 3);

  // Main cannon
  ctx.fillStyle = '#666';
  ctx.fillRect(7, 0, 2, 5);
  ctx.fillStyle = '#888';
  ctx.fillRect(7, 0, 1, 5);

  // Team flag
  ctx.fillStyle = colors.primary;
  ctx.fillRect(10, 10, 3, 3);
  ctx.fillStyle = colors.light;
  ctx.fillRect(10, 10, 3, 1);

  return c;
}

// --- DOCK (building) ---
function drawDock(teamId) {
  const size = TILE_SIZE * 2;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const tc = TEAM_COLORS[teamId];

  // Water background
  ctx.fillStyle = '#2266aa';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(4 + i * 7, 10 + (i % 3) * 15, 6, 1);
  }

  // Wooden platform
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(4, 8, size - 8, size - 16);
  ctx.fillStyle = '#7a5c10';
  for (let y = 10; y < size - 10; y += 6) {
    ctx.fillRect(4, y, size - 8, 1);
  }

  // Support posts
  ctx.fillStyle = '#5a4a30';
  ctx.fillRect(6, size - 10, 4, 10);
  ctx.fillRect(size - 10, size - 10, 4, 10);

  // Crane
  ctx.fillStyle = '#666';
  ctx.fillRect(28, 2, 2, 20);
  ctx.fillRect(20, 2, 12, 2);

  // Team banner
  ctx.fillStyle = tc.primary;
  ctx.fillRect(8, 10, 6, 8);
  ctx.fillStyle = tc.light;
  ctx.fillRect(8, 10, 6, 2);

  // Rope
  ctx.fillStyle = '#aa9960';
  ctx.fillRect(30, 4, 8, 1);

  // Glow outline
  ctx.strokeStyle = tc.primary;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.3;
  ctx.strokeRect(3, 7, size - 6, size - 14);
  ctx.globalAlpha = 1;

  return c;
}

// --- SPRITE CACHE ---

export class SpriteSheet {
  constructor() {
    this.tiles = {};
    this.units = {};
    this.buildings = {};
    this.generated = false;
  }

  generate(theme = 'verdant') {
    if (this.currentTheme === theme && this.generated) return;

    const palette = TILE_PALETTES[theme] || TILE_PALETTES.verdant;
    this.currentTheme = theme;

    // Reset tile arrays
    this.tiles.grass = [];
    this.tiles.water = [];
    this.tiles.dirt = [];
    this.tiles.tree = [];
    this.tiles.mineral = [];
    this.tiles.rock = [];

    for (let i = 0; i < 4; i++) {
      this.tiles.grass.push(drawGrassTile(i, palette.grass));
      this.tiles.water.push(drawWaterTile(i, palette.water));
      this.tiles.dirt.push(drawDirtTile(i, palette.dirt));
      this.tiles.tree.push(drawTreeTile(i, palette.tree));
      this.tiles.mineral.push(drawMineralTile(i, palette.mineral));
      this.tiles.rock.push(drawRockTile(i, palette.rock));
    }

    // Only generate units and buildings ONCE (they don't change with theme)
    if (!this.generated) {
      const teamIds = Object.keys(TEAM_COLORS).map(Number);
      const unitTypes = ['worker', 'soldier', 'tank', 'rocket', 'bomber', 'battleship'];
      const drawFns = {
        worker: drawWorker,
        soldier: drawSoldier,
        tank: drawTank,
        rocket: drawRocket,
        bomber: drawBomber,
        battleship: drawBattleship,
      };

      for (const type of unitTypes) {
        this.units[type] = {};
        for (const tid of teamIds) {
          this.units[type][tid] = drawFns[type](tid);
        }
      }

      const buildingTypes = ['base', 'barracks', 'factory', 'tower', 'dock'];
      const buildDrawFns = {
        base: drawBase,
        barracks: drawBarracks,
        factory: drawFactory,
        tower: drawTower,
        dock: drawDock,
      };

      for (const type of buildingTypes) {
        this.buildings[type] = {};
        for (const tid of teamIds) {
          this.buildings[type][tid] = buildDrawFns[type](tid);
        }
      }
    }

    this.generated = true;
  }

  getTile(type, x, y) {
    const tileNames = ['grass', 'water', 'dirt', 'tree', 'mineral', 'rock'];
    const name = tileNames[type];
    const variants = this.tiles[name];
    if (!variants || variants.length === 0) return this.tiles.grass ? this.tiles.grass[0] : null;

    // Fallback if x or y are missing (though they shouldn't be now)
    if (x === undefined || y === undefined) return variants[0];

    const idx = ((x * 7 + y * 13) >>> 0) % variants.length;
    return variants[idx];
  }

  getUnit(type, teamId) {
    return this.units[type]?.[teamId] || this.units.worker[0];
  }

  getBuilding(type, teamId) {
    return this.buildings[type]?.[teamId] || this.buildings.base[0];
  }
}
