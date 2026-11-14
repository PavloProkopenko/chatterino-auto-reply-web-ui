# Undo link-config.ps1 (Windows). UNTESTED on Windows.
# Usage: powershell -File unlink-config.ps1 -Plugin <plugin dir>
param([Parameter(Mandatory=$true)][string]$Plugin)
$ErrorActionPreference = "Stop"
$Plugin = $Plugin.TrimEnd('\')
if (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'chatterino|leafyrino' }) { throw "Close Leafyrino/Chatterino first." }
$item = Get-Item $Plugin
if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "$Plugin is not a link." }
$target = $item.Target
$backups = Join-Path (Split-Path (Split-Path $Plugin)) "auto-reply-backups"
$latest = $null
if (Test-Path $backups) {
  $latest = Get-ChildItem $backups -Directory -Filter ((Split-Path $Plugin -Leaf) + "-*") | Sort-Object Name | Select-Object -Last 1
}
(Get-Item $Plugin).Delete()   # removes the junction only, not the target contents
if ($latest) { Move-Item $latest.FullName $Plugin; Write-Host "Restored from $($latest.FullName) (changes made in $target are NOT copied back)." }
else {
  New-Item -ItemType Directory $Plugin | Out-Null; Copy-Item "$target\*" $Plugin -Recurse -Force
  Remove-Item "$Plugin\data\.external" -ErrorAction SilentlyContinue; Remove-Item "$Plugin\.backup" -Recurse -ErrorAction SilentlyContinue
  Write-Host "No backup found: copied the files from $target."
}
Write-Host "Done. Files in $target were left untouched."
