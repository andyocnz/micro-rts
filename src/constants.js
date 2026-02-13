export const TILE_SIZE = 32;
export const MAP_WIDTH = 200;
export const MAP_HEIGHT = 200;
export const WORLD_W = MAP_WIDTH * TILE_SIZE;
export const WORLD_H = MAP_HEIGHT * TILE_SIZE;

export const CAMERA_SPEED = 800; // pixels per second
export const EDGE_SCROLL_ZONE = 20;

export const MINIMAP_SIZE = 180;
export const MINIMAP_X = 10;

export const UNIT_SIZE = 16;
export const UNIT_SPEED = 80; // pixels per second

export const TILE_GRASS = 0;
export const TILE_WATER = 1;
export const TILE_DIRT = 2;
export const TILE_TREE = 3;
export const TILE_MINERAL = 4;
export const TILE_ROCK = 5;

export const TEAM_BLUE = 0;   // player (top-left)
export const TEAM_RED = 1;    // AI (top-right)
export const TEAM_GREEN = 2;  // AI (bottom-left)
export const TEAM_YELLOW = 3; // AI (bottom-right)

export const ALL_TEAMS = [TEAM_BLUE, TEAM_RED, TEAM_GREEN, TEAM_YELLOW];
export const AI_TEAMS = [TEAM_RED, TEAM_GREEN, TEAM_YELLOW];

export const TEAM_COLORS = {
  [TEAM_BLUE]:   { primary: '#4488ff', dark: '#2255bb', light: '#66aaff' },
  [TEAM_RED]:    { primary: '#ff4444', dark: '#bb2222', light: '#ff6666' },
  [TEAM_GREEN]:  { primary: '#44cc44', dark: '#228822', light: '#66ee66' },
  [TEAM_YELLOW]: { primary: '#ffcc00', dark: '#bb9900', light: '#ffee44' },
};

export const SELECTION_COLOR = '#00ff00';
export const MOVE_MARKER_DURATION = 0.6;
