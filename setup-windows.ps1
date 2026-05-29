<#
.SYNOPSIS
  One-shot setup for the Infiltration game on Windows 10 with a LOCAL Qwen Director.

.DESCRIPTION
  Installs Node, Git, and Ollama (via winget if missing), clones/updates the repo,
  pulls the Qwen model, builds a derived model with a large enough context window for
  the Director's prompt, writes a local-mode .env, installs deps, builds, and launches.

  No Anthropic API key is needed: in local mode the Director runs entirely on Ollama.

.NOTES
  Run from anywhere (e.g. your Downloads folder). It clones the repo itself.
  If a step needs a freshly-installed tool, re-run the script once — PATH picks it up.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
#>

[CmdletBinding()]
param(
    [string]$RepoUrl   = 'https://github.com/doctorgonzo/infiltration.git',
    [string]$TargetDir = (Join-Path (Get-Location) 'infiltration'),
    [string]$ModelTag  = 'qwen2.5:32b-instruct',  # base model pulled from Ollama
    [string]$DirectorModel = 'infiltration-director', # derived model w/ big context
    [int]$NumCtx       = 16384,   # context window. Drop to 12288/8192 if VRAM spills.
    [switch]$SkipRomanceModel     # skip the optional 8B romance model (~5GB)
)

$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok($m){ Write-Host "  $m" -ForegroundColor Green }
function Warn($m){ Write-Host "  $m" -ForegroundColor Yellow }

# Pull Machine + User PATH into the current session so freshly-installed tools resolve.
function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path','Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path','User')
    $env:Path = ($machine, $user | Where-Object { $_ }) -join ';'
}

function Have($cmd){ [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Install-IfMissing($cmd, $wingetId, $label) {
    if (Have $cmd) { Ok "$label already installed."; return }
    if (-not (Have 'winget')) {
        throw "$label is missing and winget is unavailable. Install $label manually, then re-run."
    }
    Info "Installing $label via winget ($wingetId)"
    winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Have $cmd)) {
        Warn "$label installed but '$cmd' isn't on PATH yet. Close this window, open a NEW PowerShell, and re-run the script."
        exit 1
    }
    Ok "$label installed."
}

# ── 1. Prerequisites ───────────────────────────────────────
Install-IfMissing 'git'    'Git.Git'           'Git'
Install-IfMissing 'node'   'OpenJS.NodeJS.LTS' 'Node.js LTS'
Install-IfMissing 'ollama' 'Ollama.Ollama'     'Ollama'

# ── 2. Make sure the Ollama server is up ───────────────────
Info "Checking Ollama server on localhost:11434"
function Ollama-Up {
    try { Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 3 | Out-Null; return $true }
    catch { return $false }
}
if (-not (Ollama-Up)) {
    Warn "Ollama server not responding — starting it."
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    $tries = 0
    while (-not (Ollama-Up) -and $tries -lt 20) { Start-Sleep -Seconds 1; $tries++ }
    if (-not (Ollama-Up)) { throw "Ollama did not come up. Launch the Ollama app, then re-run." }
}
Ok "Ollama is up."

# ── 3. Pull models ─────────────────────────────────────────
Info "Pulling Director model: $ModelTag  (~20GB at Q4 — this takes a while)"
ollama pull $ModelTag

if (-not $SkipRomanceModel) {
    Info "Pulling optional romance model: leeplenty/lumimaid-v0.2:8b (~5GB)"
    Warn "It and the 32B won't both fit in 24GB VRAM, so Ollama hot-swaps them (slower switch). Use -SkipRomanceModel to skip."
    ollama pull 'leeplenty/lumimaid-v0.2:8b'
}

# ── 4. Derive a Director model with a large context window ─
# Ollama's default context is only 2048 tokens; the Director's system prompt + tools
# alone are ~5k, so we bake a bigger num_ctx into a derived model.
Info "Creating derived model '$DirectorModel' with num_ctx=$NumCtx"
$modelfile = Join-Path $env:TEMP 'infiltration-director.Modelfile'
@"
FROM $ModelTag
PARAMETER num_ctx $NumCtx
PARAMETER temperature 0.8
"@ | Set-Content -Path $modelfile -Encoding ascii
ollama create $DirectorModel -f $modelfile
Ok "Derived model ready."

# ── 5. Clone or update the repo ────────────────────────────
if (Test-Path (Join-Path $TargetDir '.git')) {
    Info "Repo exists — pulling latest in $TargetDir"
    git -C $TargetDir pull --ff-only
} else {
    Info "Cloning $RepoUrl -> $TargetDir"
    git clone $RepoUrl $TargetDir
}
Set-Location $TargetDir

# ── 6. Write .env for local-Director mode ──────────────────
# No ANTHROPIC_API_KEY: local mode never calls Anthropic.
Info "Writing .env (local Director mode)"
@"
DIRECTOR_BACKEND=local
LOCAL_DIRECTOR_MODEL=$DirectorModel
OLLAMA_URL=http://localhost:11434/v1/chat/completions
"@ | Set-Content -Path (Join-Path $TargetDir '.env') -Encoding ascii
Ok ".env written."

# ── 7. Install deps and build ──────────────────────────────
Info "Installing npm dependencies"
npm install

Info "Building"
npm run build

# ── 8. Launch ──────────────────────────────────────────────
Info "Starting the server"
Ok "Game will be at http://localhost:3000  (a fresh world is generated on first boot)"
Ok "Stop the server with Ctrl+C."
npm run start
