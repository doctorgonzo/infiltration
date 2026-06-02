# Infiltration

A SvelteKit multiplayer narrative game run by an LLM Director. The Director can use
Anthropic in cloud mode or an OpenAI-compatible local backend such as Ollama.

## Quick Local LLM Setup

The buddy-machine path is:

1. Run the game server locally.
2. Run Ollama locally, or point the game at a friend's OpenAI-compatible endpoint.
3. Set `DIRECTOR_BACKEND=local` so no Anthropic API key is needed.

On Windows, the one-shot setup script installs prerequisites, pulls the model, writes
`.env`, builds, and starts the server:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

By default it uses `qwen2.5:32b-instruct`, creates an Ollama derived model named
`infiltration-director` with a larger context window, and serves the game at
`http://localhost:3000`.

Useful Windows script options:

```powershell
# Use a different base model
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 -ModelTag "qwen2.5:14b-instruct"

# Use a different derived model name
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 -DirectorModel "infiltration-director"

# Skip the optional secondary local model
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 -SkipRomanceModel
```

## Manual Setup

Install dependencies:

```sh
npm install
```

Create `.env` from `.env.example` and choose a backend.

For local Ollama:

```sh
DIRECTOR_BACKEND=local
LOCAL_DIRECTOR_MODEL=infiltration-director
OLLAMA_URL=http://127.0.0.1:11434/v1/chat/completions
```

For a remote friend's Ollama/OpenAI-compatible endpoint, use their tunnel URL:

```sh
DIRECTOR_BACKEND=local
LOCAL_DIRECTOR_MODEL=infiltration-director
OLLAMA_URL=https://example.trycloudflare.com/v1/chat/completions
```

For Anthropic:

```sh
DIRECTOR_BACKEND=cloud
ANTHROPIC_API_KEY=sk-ant-...
```

Then run:

```sh
npm run build
npm run start
```

The production server starts on `http://localhost:3000` unless `PORT` is set.
World state is saved to `gamedata/world.json`.

## Development

```sh
npm run dev
```

Quality checks:

```sh
npm run check
npm run build
```
