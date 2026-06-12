<#
.SYNOPSIS
    Publish a ModuleHub module to the store service and write a .mhmod archive.

.DESCRIPTION
    Reads widgets/ModuleHub/modules/<ModuleId>/module.json plus all flat files
    in that folder, POSTs { manifest, files } to POST /modules, and writes
    dist/<id>-v<version>.mhmod (zip with folder contents at root).

.PARAMETER ModuleId
    ID of the module folder under widgets/ModuleHub/modules/.  Mandatory.

.PARAMETER StoreUrl
    Base URL of the modulehub-store service.  Default: http://localhost:8743

.PARAMETER ApiKey
    Value for the X-Api-Key header.  Default: '' (disabled).

.PARAMETER Force
    When set, appends ?force=1 to the POST URL to overwrite an existing version.

.EXAMPLE
    .\publish-module.ps1 -ModuleId bag-filter-tracker
    .\publish-module.ps1 -ModuleId mollier-monitor -StoreUrl http://10.0.0.5:8743 -ApiKey secret -Force
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ModuleId,

    [string]$StoreUrl = 'http://localhost:8743',

    [string]$ApiKey = '',

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Resolve paths ──────────────────────────────────────────────────────────────
$scriptDir   = $PSScriptRoot
$widgetRoot  = Split-Path $scriptDir -Parent          # widgets/ModuleHub
$repoRoot    = Split-Path (Split-Path $widgetRoot -Parent) -Parent  # repo root
$moduleDir   = Join-Path $widgetRoot "modules\$ModuleId"
$distDir     = Join-Path $widgetRoot "dist"
$manifestPath = Join-Path $moduleDir "module.json"

if (-not (Test-Path $manifestPath)) {
    Write-Error "module.json not found at: $manifestPath"
    exit 1
}

# ── Read manifest ──────────────────────────────────────────────────────────────
$manifestText = Get-Content $manifestPath -Raw -Encoding UTF8
$manifest     = $manifestText | ConvertFrom-Json

$id      = $manifest.id
$version = $manifest.version

Write-Host "Publishing $id v$version from $moduleDir" -ForegroundColor Cyan

# ── Collect files (flat — no subdirectories) ───────────────────────────────────
$files = @{}
Get-ChildItem $moduleDir -File | ForEach-Object {
    $name = $_.Name
    # Skip module.json — server writes it from manifest
    if ($name -eq 'module.json') { return }
    $files[$name] = Get-Content $_.FullName -Raw -Encoding UTF8
}

Write-Host "Files to publish: $($files.Keys -join ', ')"

# ── Build request body ─────────────────────────────────────────────────────────
$body = @{
    manifest = $manifest
    files    = $files
} | ConvertTo-Json -Depth 10

$url = $StoreUrl.TrimEnd('/') + '/modules'
if ($Force) { $url += '?force=1' }

$headers = @{ 'Content-Type' = 'application/json' }
if ($ApiKey -ne '') { $headers['X-Api-Key'] = $ApiKey }

# ── POST to service ────────────────────────────────────────────────────────────
Write-Host "POST $url" -ForegroundColor Gray
try {
    $response = Invoke-RestMethod -Uri $url -Method Post `
        -Headers $headers -Body $body -TimeoutSec 15
    Write-Host "Published OK: id=$($response.id)  version=$($response.version)" -ForegroundColor Green
} catch {
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    Write-Error "Publish failed: $detail"
    exit 1
}

# ── Write .mhmod archive ───────────────────────────────────────────────────────
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Force $distDir | Out-Null
}

$archiveName = "$id-v$version.mhmod"
$archivePath = Join-Path $distDir $archiveName
$tmpZip      = Join-Path $env:TEMP "$id-v$version-$(Get-Random).zip"

# Compress-Archive puts files at zip root (not inside a sub-folder) by
# compressing the contents of the folder, not the folder itself.
$allFiles = Get-ChildItem $moduleDir -File | Select-Object -ExpandProperty FullName
Compress-Archive -Path $allFiles -DestinationPath $tmpZip -Force

# Rename .zip → .mhmod
if (Test-Path $archivePath) { Remove-Item $archivePath -Force }
Move-Item $tmpZip $archivePath

Write-Host "Archive written: $archivePath" -ForegroundColor Green

# ── Quick verify: expand to temp and check module.json + entry exist ───────────
$verifyDir = Join-Path $env:TEMP "mhmod-verify-$(Get-Random)"
Expand-Archive -Path $archivePath -DestinationPath $verifyDir -Force

$hasManifest = Test-Path (Join-Path $verifyDir 'module.json')
$entry       = $manifest.entry
$hasEntry    = Test-Path (Join-Path $verifyDir $entry)

Remove-Item $verifyDir -Recurse -Force

if ($hasManifest -and $hasEntry) {
    Write-Host "Archive verified: module.json + $entry present at root." -ForegroundColor Green
} else {
    Write-Warning "Archive verification: module.json=$hasManifest  $entry=$hasEntry"
}
