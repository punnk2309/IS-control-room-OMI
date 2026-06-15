<#
.SYNOPSIS
  Copy the ModuleHub module-side SDK + selected demo modules into the
  SmartFactoryControlRoom widget so its `module-host` widget can load them
  same-origin (offline), with no modulehub-store service required.

.DESCRIPTION
  Produces widgets/SmartFactoryControlRoom/module-bundles/ with the SAME path
  layout the store service exposes:
      module-bundles/sdk/<sdk-*.js>         (← GET /sdk/:file)
      module-bundles/modules/<id>/...       (← GET /modules/:id/:file)
  so module-host's `staticBase: 'module-bundles'` and `storeUrl` use identical
  fetch paths. Re-run whenever the SDK or a bundled demo changes.

.PARAMETER ModuleIds
  Module ids to bundle. Default: the two demos + the smoke module.
#>
param(
  [string[]] $ModuleIds = @('bag-filter-tracker', 'bag-filter-tracker-v1', 'mollier-monitor', '_smoke')
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path $PSScriptRoot -Parent
$mhRoot     = Join-Path $repoRoot 'widgets\ModuleHub'
$bundleRoot = Join-Path $repoRoot 'widgets\SmartFactoryControlRoom\module-bundles'

$sdkFiles = @('sdk-bootstrap.js', 'sdk-data.js', 'sdk-ui.js', 'sdk-assets.js')

# Fresh bundle
if (Test-Path $bundleRoot) { Remove-Item $bundleRoot -Recurse -Force }
$sdkDest = Join-Path $bundleRoot 'sdk'
New-Item -ItemType Directory -Force -Path $sdkDest | Out-Null

# 1. SDK (module-side files only — host-side sdk-store/sdk-assets-data are not embedded)
foreach ($f in $sdkFiles) {
  $src = Join-Path $mhRoot "src\sdk\$f"
  if (-not (Test-Path $src)) { throw "Missing SDK file: $src" }
  Copy-Item $src (Join-Path $sdkDest $f) -Force
}
Write-Host "SDK: copied $($sdkFiles.Count) files -> $sdkDest"

# 2. Modules
$index = @()
foreach ($id in $ModuleIds) {
  $srcDir = Join-Path $mhRoot "modules\$id"
  if (-not (Test-Path (Join-Path $srcDir 'module.json'))) {
    Write-Warning "Skipping '$id' — no module.json at $srcDir"
    continue
  }
  $destDir = Join-Path $bundleRoot "modules\$id"
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Get-ChildItem $srcDir -File | Where-Object { $_.Name -match '\.(js|json|css)$' } |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $destDir $_.Name) -Force }
  $index += $id
  Write-Host "Module: $id -> $destDir"
}

# 3. index.json (mirrors the service's GET /modules id list)
$index | ConvertTo-Json -AsArray | Set-Content (Join-Path $bundleRoot 'index.json') -Encoding utf8

# 4. bundle.js — an inlined copy of everything as a JS global, so the control
#    room can load modules with NO fetch (works from file:// with no server).
$sdkMap = [ordered]@{}
foreach ($f in $sdkFiles) {
  $sdkMap[$f] = Get-Content (Join-Path $sdkDest $f) -Raw
}
$moduleMap = [ordered]@{}
foreach ($id in $index) {
  $mDir     = Join-Path $bundleRoot "modules\$id"
  $manifest = Get-Content (Join-Path $mDir 'module.json') -Raw | ConvertFrom-Json
  $files    = [ordered]@{}
  Get-ChildItem $mDir -File | Where-Object { $_.Name -match '\.(js|css)$' } |
    ForEach-Object { $files[$_.Name] = Get-Content $_.FullName -Raw }
  $moduleMap[$id] = [ordered]@{ manifest = $manifest; files = $files }
}
$bundleObj = [ordered]@{ index = $index; sdk = $sdkMap; modules = $moduleMap }
$json = $bundleObj | ConvertTo-Json -Depth 25 -Compress
Set-Content (Join-Path $bundleRoot 'bundle.js') "window.SFP_MODULE_BUNDLES = $json;" -Encoding utf8

Write-Host ""
Write-Host "Bundle ready: $bundleRoot"
Write-Host "Bundled modules: $($index -join ', ')"
Write-Host "Inlined bundle.js written (offline / file:// support)"
