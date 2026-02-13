const DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const DEFAULT_MODEL = 'local-model';

function cleanJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
  }
  return trimmed;
}

export async function getCommandsFromLmStudio({
  state,
  baseUrl = process.env.LM_STUDIO_BASE_URL || DEFAULT_BASE_URL,
  model = process.env.LM_STUDIO_MODEL || DEFAULT_MODEL,
  timeoutMs = 8000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = [
    'You are an RTS bot commander.',
    'Return JSON only, no markdown.',
    'Output schema:',
    '{"commands":[{"type":"TRAIN","buildingId":1,"unitType":"soldier"}]}',
    'Allowed type values: MOVE, ATTACK, BUILD, TRAIN, HARVEST.',
    'Use only fields required by the command type.',
  ].join('\n');

  const userPrompt = [
    'Current game state JSON:',
    JSON.stringify(state),
    'Return a single JSON object with "commands".',
  ].join('\n');

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      throw new Error(`LM Studio HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error('Missing model content');
    }

    const parsed = JSON.parse(cleanJson(content));
    if (!parsed || !Array.isArray(parsed.commands)) {
      throw new Error('Invalid command schema');
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

