# Prepare a developer machine (Windows 10/11 x64): portable Node + pinned pnpm into .\.tools, dependencies from
# the lockfile, then lint, unit tests, vendor drift check and a build smoke test. Idempotent, no admin rights.
#   scripts\prepare.ps1           do everything
#   scripts\prepare.ps1 -Check    only report what is missing
param([switch]$Check)
$ErrorActionPreference = 'Stop'

$NodeVersion = '22.17.0'
$NodeSha256  = '721ab118a3aac8584348b132767eadf51379e0616f0db802cc1e66d7f0d98f85'  # node-v22.17.0-win-x64.zip

$Root  = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root '.tools'
$pm = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).packageManager
$PnpmVersion = $pm -replace '^pnpm@', ''
$missing = @()

$nodeDir = Join-Path $Tools 'node'
if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:PATH = "$nodeDir;$env:PATH" }

function Test-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { return $false }
  return ([int](& node -p 'process.versions.node.split(".")[0]')) -ge 22
}

if (-not (Test-Node)) {
  if ($Check) { $missing += 'Node >= 22' } else {
    New-Item -ItemType Directory -Force $Tools | Out-Null
    $zip = Join-Path $Tools "node-v$NodeVersion-win-x64.zip"
    Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $NodeSha256) { Remove-Item $zip; throw 'SHA-256 mismatch for Node archive' }
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
    Expand-Archive $zip -DestinationPath $Tools
    Rename-Item (Join-Path $Tools "node-v$NodeVersion-win-x64") $nodeDir
    Remove-Item $zip
    $env:PATH = "$nodeDir;$env:PATH"
  }
}

# pnpm is npm-installed into .tools (pnpm 12 ships a native binary that corepack 0.33 cannot launch).
$pnpmBin = Join-Path $Tools 'pnpm\node_modules\.bin\pnpm.cmd'
$have = ''
if (Test-Path $pnpmBin) { $have = (& $pnpmBin --version 2>$null) }
if ($have -ne $PnpmVersion) {
  if ($Check) { $missing += "pnpm $PnpmVersion in .tools" } else {
    New-Item -ItemType Directory -Force (Join-Path $Tools 'pnpm') | Out-Null
    & npm install --prefix (Join-Path $Tools 'pnpm') "pnpm@$PnpmVersion" --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE) { throw 'npm install pnpm failed' }
  }
}

if (-not (Test-Path (Join-Path $Root 'node_modules'))) { $missing += 'dependencies (pnpm install)' }
if ($Check) {
  if ($missing.Count) { Write-Host 'Missing:'; $missing | ForEach-Object { Write-Host "  - $_" }; exit 1 }
  Write-Host 'Everything is in place.'; exit 0
}

Set-Location $Root
foreach ($step in @(@('install','--frozen-lockfile'), @('lint'), @('typecheck'), @('test'), @('sync-plugin:check'), @('build:smoke'))) {
  & $pnpmBin @step
  if ($LASTEXITCODE) { throw "pnpm $($step -join ' ') failed" }
}
Write-Host ''
Write-Host "Ready. Use:  `$env:PATH = `"$nodeDir;$Tools\pnpm\node_modules\.bin;`$env:PATH`"  then  pnpm test"
