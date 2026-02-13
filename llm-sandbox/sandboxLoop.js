import { getCommandsFromLmStudio } from './lmStudioClient.js';
import { buildMockState } from './mockState.js';

function validateCommands(commands) {
  const allowed = new Set(['MOVE', 'ATTACK', 'BUILD', 'TRAIN', 'HARVEST']);
  return commands.filter((cmd) => cmd && allowed.has(cmd.type));
}

function fallbackPolicy(state) {
  if (state.visibleEnemies.length > 0) {
    return {
      commands: [
        {
          type: 'ATTACK',
          unitIds: [2, 3],
          targetId: state.visibleEnemies[0].id,
        },
      ],
    };
  }

  return {
    commands: [
      { type: 'TRAIN', buildingId: 12, unitType: 'soldier' },
    ],
  };
}

async function run() {
  const totalTicks = 3;

  console.log('Starting isolated LLM sandbox loop');
  console.log('No game files are modified and no game runtime is used');
  console.log('---');

  for (let tick = 1; tick <= totalTicks; tick += 1) {
    const state = buildMockState(tick);
    let result;

    try {
      const modelOut = await getCommandsFromLmStudio({ state });
      result = { commands: validateCommands(modelOut.commands) };
      if (result.commands.length === 0) {
        result = fallbackPolicy(state);
      }
      console.log(`[tick ${tick}] model commands:`, JSON.stringify(result.commands));
    } catch (err) {
      result = fallbackPolicy(state);
      console.log(`[tick ${tick}] model failed (${err.message}), fallback:`, JSON.stringify(result.commands));
    }
  }

  console.log('---');
  console.log('Sandbox loop complete');
}

run().catch((err) => {
  console.error('Sandbox failed:', err);
  process.exitCode = 1;
});

