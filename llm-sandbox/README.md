# LLM Sandbox (Isolated)

This folder is an isolated proof-of-connection for local LLM control.
It does not touch your existing game runtime.

## What it does

- Sends mock RTS state JSON to a local OpenAI-compatible endpoint (LM Studio).
- Expects strict JSON commands from the model.
- Validates commands and falls back to scripted commands on failure.

## LM Studio setup

1. Open LM Studio.
2. Load a chat model.
3. Start local server (OpenAI compatible).
4. Default endpoint should be `http://localhost:1234/v1`.

## Run

```powershell
node llm-sandbox/sandboxLoop.js
```

Optional env vars:

```powershell
$env:LM_STUDIO_BASE_URL="http://localhost:1234/v1"
$env:LM_STUDIO_MODEL="qwen2.5-7b-instruct"
node llm-sandbox/sandboxLoop.js
```

## Next step after this works

Replace `mockState.js` with real game-state serialization and route accepted commands into your command processor.

