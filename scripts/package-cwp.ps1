<#
.SYNOPSIS
  Packages a single widget directory into a .cwp file.

.EXAMPLE
  .\package-cwp.ps1 -WidgetName SmartFactoryEnergyDashboard
#>
param(
  [Parameter(Mandatory)][string]$WidgetName,
  [string]$WidgetsDir = "$PSScriptRoot\..\widgets",
  [string]$OutputDir  = "$PSScriptRoot\..\dist"
)

$sourceDir = Join-Path $WidgetsDir $WidgetName

# Validate source exists
if (-not (Test-Path $sourceDir)) {
  Write-Error "Widget not found: $sourceDir"; exit 1
}

# Validate required files
foreach ($required in @('manifest.json', 'index.html')) {
  if (-not (Test-Path "$sourceDir\$required")) {
    Write-Error "Missing required file: $required in $sourceDir"; exit 1
  }
}

# Read version from manifest
$manifest = Get-Content "$sourceDir\manifest.json" | ConvertFrom-Json
$version  = if ($manifest.version) { $manifest.version } else { '0.0.0' }

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$zipPath = "$OutputDir\$WidgetName-v$version.zip"
$cwpPath = "$OutputDir\$WidgetName-v$version.cwp"

# Remove stale output
Remove-Item $zipPath, $cwpPath -ErrorAction SilentlyContinue

Compress-Archive -Path "$sourceDir\*" -DestinationPath $zipPath
Rename-Item -Path $zipPath -NewName "$WidgetName-v$version.cwp"

Write-Host "Packaged: $cwpPath" -ForegroundColor Green
Write-Host "Size: $([math]::Round((Get-Item $cwpPath).Length / 1KB, 1)) KB" -ForegroundColor Cyan
