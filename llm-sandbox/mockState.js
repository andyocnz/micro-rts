export function buildMockState(tick) {
  const nearbyEnemy = tick % 2 === 0;
  return {
    tick,
    objective: 'Destroy enemy HQs by economy and army control.',
    myTeam: 0,
    resources: { minerals: 380, wood: 210 },
    myUnits: [
      { id: 1, type: 'worker', x: 8, y: 11, hp: 40 },
      { id: 2, type: 'soldier', x: 13, y: 12, hp: 70 },
      { id: 3, type: 'soldier', x: 14, y: 12, hp: 70 },
    ],
    myBuildings: [
      { id: 11, type: 'base', x: 6, y: 6, hp: 500, built: true, trainQueueLen: 0 },
      { id: 12, type: 'barracks', x: 11, y: 6, hp: 350, built: true, trainQueueLen: 0 },
    ],
    visibleEnemies: nearbyEnemy
      ? [{ id: 91, type: 'soldier', x: 18, y: 12, hp: 70, team: 1 }]
      : [],
    notes: [
      'If enemy is close to base, prioritize ATTACK with nearby soldiers.',
      'Otherwise TRAIN soldier if resources allow.',
    ],
  };
}

