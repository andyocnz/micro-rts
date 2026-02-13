import { TILE_MINERAL, TILE_TREE, BUILDING_DEFS, MAX_UNITS_TOTAL } from './constants.js';
import { Building, canPlaceAt, canPlaceDock } from './building.js';

function getOwnedUnits(engine, team, unitIds = []) {
  if (!Array.isArray(unitIds)) return [];
  const owned = [];
  for (const id of unitIds) {
    const unit = engine.getUnitById(id);
    if (unit && unit.team === team && unit.hp > 0) owned.push(unit);
  }
  return owned;
}

function getEnemyUnit(engine, team, unitId) {
  const unit = engine.getUnitById(unitId);
  if (!unit || unit.team === team || unit.hp <= 0) return null;
  return unit;
}

function getEnemyBuilding(engine, team, buildingId) {
  const building = engine.getBuildingById(buildingId);
  if (!building || building.team === team || building.hp <= 0) return null;
  return building;
}

export function processCommand(engine, playerTeam, command) {
  if (!command || typeof command !== 'object') return false;

  switch (command.type) {
    case 'MOVE':
      return processMove(engine, playerTeam, command);
    case 'ATTACK':
      return processAttack(engine, playerTeam, command);
    case 'HARVEST':
      return processHarvest(engine, playerTeam, command);
    case 'BUILD':
      return processBuild(engine, playerTeam, command);
    case 'BUILD_RESUME':
      return processBuildResume(engine, playerTeam, command);
    case 'TRAIN':
      return processTrain(engine, playerTeam, command);
    case 'STOP':
      return processStop(engine, playerTeam, command);
    default:
      return false;
  }
}

function processMove(engine, team, command) {
  const target = command.target;
  if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return false;

  const units = getOwnedUnits(engine, team, command.unitIds);
  if (units.length === 0) return false;

  for (const unit of units) {
    const tx = Math.max(0, Math.min(engine.map.width - 1, Math.floor(target.x)));
    const ty = Math.max(0, Math.min(engine.map.height - 1, Math.floor(target.y)));
    unit.moveTo(engine.map, tx, ty);
  }

  return true;
}

function processAttack(engine, team, command) {
  const units = getOwnedUnits(engine, team, command.unitIds);
  if (units.length === 0) return false;

  if (command.targetUnitId != null) {
    const targetUnit = getEnemyUnit(engine, team, command.targetUnitId);
    if (!targetUnit) return false;
    for (const unit of units) unit.attackTarget(targetUnit);
    return true;
  }

  if (command.targetBuildingId != null) {
    const targetBuilding = getEnemyBuilding(engine, team, command.targetBuildingId);
    if (!targetBuilding) return false;
    for (const unit of units) unit.attackBuilding(targetBuilding);
    return true;
  }

  return false;
}

function processHarvest(engine, team, command) {
  const target = command.target;
  if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return false;

  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  const tile = engine.map.getTile(tx, ty);
  if (tile !== TILE_MINERAL && tile !== TILE_TREE) return false;

  const units = getOwnedUnits(engine, team, command.unitIds).filter((u) => u.type === 'worker');
  if (units.length === 0) return false;

  for (const unit of units) unit.gatherFrom(tx, ty);
  return true;
}

function processBuild(engine, team, command) {
  const { buildingType, tileX, tileY, builderUnitId } = command;
  if (!buildingType || !BUILDING_DEFS[buildingType]) return false;
  if (typeof tileX !== 'number' || typeof tileY !== 'number') return false;

  const builder = engine.getUnitById(builderUnitId);
  if (!builder || builder.team !== team || builder.type !== 'worker' || builder.hp <= 0) return false;

  const def = BUILDING_DEFS[buildingType];
  if (!engine.canAfford(team, def.cost)) return false;

  const tx = Math.floor(tileX);
  const ty = Math.floor(tileY);
  const canPlace = buildingType === 'dock'
    ? canPlaceDock(engine.buildings, tx, ty, engine.map)
    : canPlaceAt(engine.buildings, tx, ty, def.sizeTiles, engine.map);

  if (!canPlace) return false;

  const building = new Building(tx, ty, buildingType, team);
  engine.buildings.push(building);
  engine.spend(team, def.cost);
  builder.buildBuilding(building);
  return true;
}

function processBuildResume(engine, team, command) {
  const { buildingId } = command;
  if (typeof buildingId !== 'number') return false;

  const building = engine.getBuildingById(buildingId);
  if (!building || building.team !== team || building.hp <= 0 || building.built) return false;

  const units = getOwnedUnits(engine, team, command.unitIds).filter((u) => u.type === 'worker');
  if (units.length === 0) return false;

  for (const unit of units) unit.buildBuilding(building);
  return true;
}

function processTrain(engine, team, command) {
  if (engine.units.length >= MAX_UNITS_TOTAL) return false;

  const { buildingId, unitType } = command;
  if (typeof buildingId !== 'number' || !unitType) return false;

  const building = engine.getBuildingById(buildingId);
  if (!building || building.team !== team || building.hp <= 0) return false;

  const resources = engine.resources[team];
  if (!resources || !building.canTrain(unitType, resources)) return false;

  const cost = building.train(unitType);
  engine.spend(team, cost);
  return true;
}

function processStop(engine, team, command) {
  const units = getOwnedUnits(engine, team, command.unitIds);
  if (units.length === 0) return false;
  for (const unit of units) unit.stop();
  return true;
}
