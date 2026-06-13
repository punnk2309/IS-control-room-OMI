<#
.SYNOPSIS
    Publish a ModuleHub module to the store service and write a .mhmod archive.

.DESCRIPTION
    Reads widgets/ModuleHub/modules/<ModuleId>/module.json plus all flat files
    in that folder whose names match ^[A-Za-z0-9._-]+\.(js|json|css)$
    (excluding module.json itself), POSTs { manifest, files } to POST /modules,
    and writes dist/<id>-v<version>.mhmod (zip of folder contents at root).

    Paths are resolved relative to the repo root (one level above this script's
    directory: scripts/ lives directly under the repo root).

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
# This script lives in <repo-root>/scripts/ — repo root is one level up.
$repoRoot    = Split-Path $PSScriptRoot -Parent
$moduleDir   = Join-Path $repoRoot "widgets\ModuleHub\modules\$ModuleId"
$distDir     = Join-Path $repoRoot 'dist'
$manifestPath = Join-Path $moduleDir 'module.json'

if (-not (Test-Path $manifestPath)) {
    Write-Error "module.json not found at: $manifestPath"
    exit 1
}

# ── Read manifest ──────────────────────────────────────────────────────────────
$manifestText = Get-Content $manifestPath -Raw -Encoding UTF8
$manifest     = $manifestText | ConvertFrom-Json

$id      = $manifest.id
$version = $manifest.version

if (-not $id) {
    Write-Error "manifest.id is missing in $manifestPath"
    exit 1
}
if (-not $version) {
    Write-Error "manifest.version is missing in $manifestPath"
    exit 1
}

Write-Host "Publishing $id v$version from $moduleDir" -ForegroundColor Cyan

# ── Collect files matching the contract pattern (flat; no subdirectories) ──────
# Pattern: ^[A-Za-z0-9._-]+\.(js|json|css)$   exclude module.json (server writes it)
$filePattern = '^[A-Za-z0-9._\-]+\.(js|json|css)$'
$files = @{}

Get-ChildItem $moduleDir -File | ForEach-Object {
    $name = $_.Name
    if ($name -eq 'module.json') { return }                     # skip — server writes from manifest
    if ($name -notmatch $filePattern) {
        Write-Warning "Skipping '$name' — name does not match allowed pattern"
        return
    }
    $files[$name] = Get-Content $_.FullName -Raw -Encoding UTF8
}

Write-Host "Files to publish: $($files.Keys -join ', ')"

# ── Assert manifest.entry is present among collected files ─────────────────────
$entry = $manifest.entry
if (-not $entry) {
    Write-Error "manifest.entry is not set in $manifestPath"
    exit 1
}
if (-not $files.ContainsKey($entry)) {
    Write-Error "manifest.entry '$entry' was not found among the collected files in $moduleDir.`nCollected: $($files.Keys -join ', ')"
    exit 1
}

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
    Write-Host "Deployed $id v$version to $StoreUrl" -ForegroundColor Green
} catch {
    # Inspect status code for 409 vs other failures
    $statusCode = 0
    if ($_.Exception -and $_.Exception.Response) {
        try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
    }

    if ($statusCode -eq 409) {
        Write-Host "version exists — re-run with -Force to overwrite $id v$version" -ForegroundColor Yellow
        exit 2
    }

    $detail = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $detail = $_.ErrorDetails.Message
    } elseif ($_.Exception -and $_.Exception.Message) {
        $detail = $_.Exception.Message
    } else {
        $detail = [string]$_
    }
    Write-Host "Publish failed: HTTP $statusCode — $detail" -ForegroundColor Red
    exit 1
}

# ── Write .mhmod archive ───────────────────────────────────────────────────────
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Force -Path $distDir | Out-Null
}

$archiveName = "$id-v$version.mhmod"
$archivePath = Join-Path $distDir $archiveName
$tmpZip      = Join-Path $env:TEMP "$id-v$version-$(Get-Random).zip"

# Compress the module folder CONTENTS flat at archive root (not inside a subfolder).
# Compress-Archive with an array of full file paths places each file at the archive root.
$allFiles = Get-ChildItem $moduleDir -File | Select-Object -ExpandProperty FullName
Compress-Archive -Path $allFiles -DestinationPath $tmpZip -Force

# Rename .zip → .mhmod
if (Test-Path $archivePath) { Remove-Item $archivePath -Force }
Move-Item $tmpZip $archivePath

Write-Host "Archive written: $archivePath" -ForegroundColor Green
