export const TILE_SIZE = 32;
export const MAP_WIDTH = 200;
export const MAP_HEIGHT = 200;

export const TILE_GRASS = 0;
export const TILE_WATER = 1;
export const TILE_DIRT = 2;
export const TILE_TREE = 3;
export const TILE_MINERAL = 4;
export const TILE_ROCK = 5;

export const TEAM_BLUE = 0;
export const TEAM_RED = 1;
export const TEAM_GREEN = 2;
export const TEAM_YELLOW = 3;
export const ALL_TEAMS = [TEAM_BLUE, TEAM_RED, TEAM_GREEN, TEAM_YELLOW];

export const MAX_UNITS_TOTAL = 300;

export const UNIT_DEFS = {
  worker: { name: 'Worker', icon: 'W', hotkey: 'w', hp: 40, damage: 5, armor: 0, speed: 80, attackRange: 1.5, attackSpeed: 1.5, flying: false, naval: false },
  soldier: { name: 'Soldier', icon: 'S', hotkey: 's', hp: 80, damage: 12, armor: 2, speed: 75, attackRange: 3.5, attackSpeed: 1.0, flying: false, naval: false },
  tank: { name: 'Tank', icon: 'T', hotkey: 't', hp: 220, damage: 28, armor: 5, speed: 45, attackRange: 4.5, attackSpeed: 2.0, flying: false, naval: false },
  rocket: { name: 'Rocket', icon: 'R', hotkey: 'r', hp: 60, damage: 30, armor: 0, speed: 60, attackRange: 6.0, attackSpeed: 3.0, flying: false, naval: false },
  bomber: { name: 'Helicopter', icon: 'H', hotkey: 'h', hp: 100, damage: 40, armor: 1, speed: 100, attackRange: 3.0, attackSpeed: 3.5, flying: true, naval: false },
  battleship: { name: 'Marine Ship', icon: 'M', hotkey: 'm', hp: 250, damage: 35, armor: 4, speed: 40, attackRange: 7.0, attackSpeed: 3.0, flying: false, naval: true },
};

export const BUILDING_DEFS = {
  base: {
    name: 'Command Centre',
    shortName: 'HQ',
    hotkey: 'h',
    cost: { minerals: 150, wood: 100 },
    buildTime: 10,
    hp: 500,
    sizeTiles: 2,
    produces: ['worker'],
    trainCosts: { worker: { minerals: 50, wood: 0 } },
    trainTimes: { worker: 5 },
    canBuild: ['barracks', 'tower', 'factory', 'dock', 'base'],
    attackRange: 0,
    attackDamage: 0,
    attackSpeed: 0,
  },
  barracks: {
    name: 'Barracks',
    shortName: 'Barracks',
    hotkey: 'b',
    cost: { minerals: 100, wood: 50 },
    buildTime: 8,
    hp: 350,
    sizeTiles: 3,
    produces: ['soldier', 'rocket'],
    trainCosts: { soldier: { minerals: 75, wood: 0 }, rocket: { minerals: 100, wood: 50 } },
    trainTimes: { soldier: 6, rocket: 10 },
    canBuild: [],
    attackRange: 0,
    attackDamage: 0,
    attackSpeed: 0,
  },
  factory: {
    name: 'Factory',
    shortName: 'Factory',
    hotkey: 'f',
    cost: { minerals: 150, wood: 100 },
    buildTime: 12,
    hp: 400,
    sizeTiles: 3,
    produces: ['tank', 'bomber'],
    trainCosts: { tank: { minerals: 150, wood: 50 }, bomber: { minerals: 200, wood: 75 } },
    trainTimes: { tank: 12, bomber: 15 },
    canBuild: [],
    attackRange: 0,
    attackDamage: 0,
    attackSpeed: 0,
  },
  tower: {
    name: 'Defense Tower',
    shortName: 'Def Tower',
    hotkey: 'd',
    cost: { minerals: 50, wood: 50 },
    buildTime: 6,
    hp: 250,
    sizeTiles: 1,
    produces: [],
    trainCosts: {},
    trainTimes: {},
    canBuild: [],
    attackRange: 6,
    attackDamage: 10,
    attackSpeed: 1.5,
  },
  dock: {
    name: 'Navy Dock',
    shortName: 'Navy Dock',
    hotkey: 'n',
    cost: { minerals: 120, wood: 80 },
    buildTime: 10,
    hp: 300,
    sizeTiles: 2,
    produces: ['battleship'],
    trainCosts: { battleship: { minerals: 200, wood: 100 } },
    trainTimes: { battleship: 15 },
    canBuild: [],
    attackRange: 0,
    attackDamage: 0,
    attackSpeed: 0,
  },
};
