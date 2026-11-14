# Optional external plugin folder for the Auto Reply plugin (Windows). UNTESTED on Windows.
# Makes <Plugins>\<plugin folder> a junction to Target (no admin rights needed), so the web UI can open and update
# the whole plugin there. The original folder is moved to <app data>\auto-reply-backups (NOT next to it: Leafyrino
# loads every folder inside Plugins, so a leftover copy would register the plugin twice).
# Usage: powershell -File link-config.ps1 -Target D:\auto-reply-plugin [-Plugin <plugin dir>]
param([Parameter(Mandatory=$true)][string]$Target, [string]$Plugin = "")
$ErrorActionPreference = "Stop"
function Test-Plugin($dir) {
  $info = Join-Path $dir "info.json"
  (Test-Path $info) -and ((Get-Content $info -Raw) -match '"name"\s*:\s*"Auto Reply"')
}
if (-not $Plugin) {
  $m = @(Get-ChildItem "$env:APPDATA\*\Plugins\*\info.json" -ErrorAction SilentlyContinue |
    Where-Object { (Get-Content $_.FullName -Raw) -match '"name"\s*:\s*"Auto Reply"' } |
    ForEach-Object { $_.DirectoryName })
  if ($m.Count -eq 0) { throw "Plugin folder not found; pass -Plugin." }
  if ($m.Count -gt 1) { throw "Several installs found, pass -Plugin: $($m -join '; ')" }
  $Plugin = $m[0]
}
$Plugin = $Plugin.TrimEnd('\')
if (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'chatterino|leafyrino' }) {
  throw "Leafyrino/Chatterino is running. Close it first."
}
if ((Get-Item $Plugin).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "$Plugin is already a link. Run unlink-config.ps1 first." }
if (-not (Test-Plugin $Plugin)) { throw "$Plugin does not contain the Auto Reply plugin (info.json)." }
New-Item -ItemType Directory -Force $Target | Out-Null
$Target = (Resolve-Path $Target).Path
if ($Target.StartsWith("$Plugin\", [StringComparison]::OrdinalIgnoreCase)) { throw "Target must not be inside the plugin folder." }
$count = (Get-ChildItem $Target -Force | Measure-Object).Count
if ($count -eq 0) {
  Copy-Item "$Plugin\*" $Target -Recurse -Force
} elseif (Test-Plugin $Target) {
  if (-not (Test-Path "$Target\data\config.json") -and (Test-Path "$Plugin\data\config.json")) {
    New-Item -ItemType Directory -Force "$Target\data" | Out-Null
    Copy-Item "$Plugin\data\config.json" "$Target\data\config.json"
  }
} else { throw "Target folder is not empty and is not the Auto Reply plugin. Choose an empty folder." }
$backups = Join-Path (Split-Path (Split-Path $Plugin)) "auto-reply-backups"
$backup = Join-Path $backups ((Split-Path $Plugin -Leaf) + "-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $backups | Out-Null
Move-Item $Plugin $backup
New-Item -ItemType Directory -Force "$Target\data" | Out-Null
New-Item -ItemType File -Force "$Target\data\.external" | Out-Null
New-Item -ItemType Junction -Path $Plugin -Target $Target | Out-Null
Write-Host "Done: $Plugin -> $Target. The original folder is kept at $backup"
Write-Host "Start the app and run /autoreply status. Undo: unlink-config.ps1 -Plugin `"$Plugin`""
