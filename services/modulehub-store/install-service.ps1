#Requires -Version 5.1
<#
.SYNOPSIS
    Installs (or uninstalls) the ModuleHubStore Windows service.

.DESCRIPTION
    - Checks that node.exe is on PATH.
    - Runs npm install --omit=dev in the service directory.
    - If nssm.exe is on PATH, installs/re-installs a Windows service named
      ModuleHubStore using nssm, then starts it.
    - If nssm is NOT on PATH, falls back to printing instructions and writing
      a start-modulehub-store.cmd launcher for Task Scheduler / manual use.

.PARAMETER Uninstall
    Stop and remove the ModuleHubStore service (requires nssm).

.EXAMPLE
    .\install-service.ps1
    .\install-service.ps1 -Uninstall
#>

param(
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName  = 'ModuleHubStore'
$ServiceDir   = $PSScriptRoot
$ServerScript = Join-Path $ServiceDir 'server.js'

# ── Locate node ──────────────────────────────────────────────────────────────
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $NodeExe) {
    Write-Error "node.exe not found on PATH. Please install Node.js (https://nodejs.org) and try again."
    exit 1
}
Write-Host "node found: $NodeExe"
$NodeVersion = & node --version 2>&1
Write-Host "node version: $NodeVersion"

# ── Uninstall path ────────────────────────────────────────────────────────────
if ($Uninstall) {
    $NssmExe = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source
    if (-not $NssmExe) {
        Write-Warning "nssm not found on PATH — cannot uninstall via nssm. Remove the service manually."
        exit 1
    }
    Write-Host "Stopping service $ServiceName …"
    & nssm stop  $ServiceName 2>$null
    Write-Host "Removing service $ServiceName …"
    & nssm remove $ServiceName confirm
    Write-Host "Service $ServiceName removed."
    exit 0
}

# ── npm install ───────────────────────────────────────────────────────────────
Write-Host "`nRunning npm install --omit=dev in $ServiceDir …"
Push-Location $ServiceDir
try {
    & npm install --omit=dev
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm install failed (exit code $LASTEXITCODE)."
        exit 1
    }
} finally {
    Pop-Location
}
Write-Host "npm install complete."

# ── Try nssm path ─────────────────────────────────────────────────────────────
$NssmExe = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source

if ($NssmExe) {
    Write-Host "`nnssm found: $NssmExe"

    # Idempotent: if service already exists, stop + remove it first
    $existing = & sc.exe query $ServiceName 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Service $ServiceName already exists — stopping and removing for reinstall…"
        & nssm stop   $ServiceName 2>$null
        Start-Sleep -Milliseconds 1500
        & nssm remove $ServiceName confirm
        Start-Sleep -Milliseconds 500
    }

    Write-Host "Installing service $ServiceName …"
    & nssm install $ServiceName $NodeExe $ServerScript
    if ($LASTEXITCODE -ne 0) { Write-Error "nssm install failed."; exit 1 }

    & nssm set $ServiceName AppDirectory $ServiceDir
    & nssm set $ServiceName DisplayName  "ModuleHub Store"
    & nssm set $ServiceName Description  "ModuleHub SQLite persistence service (modulehub-store v0.1.0)"
    & nssm set $ServiceName Start        SERVICE_AUTO_START
    & nssm set $ServiceName AppStdout    (Join-Path $ServiceDir "logs\stdout.log")
    & nssm set $ServiceName AppStderr    (Join-Path $ServiceDir "logs\stderr.log")
    & nssm set $ServiceName AppRotateFiles 1
    & nssm set $ServiceName AppRotateSeconds 86400

    # Ensure log dir exists
    New-Item -ItemType Directory -Force (Join-Path $ServiceDir "logs") | Out-Null

    Write-Host "Starting service $ServiceName …"
    & nssm start $ServiceName
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "nssm start returned exit code $LASTEXITCODE — service may still be starting."
    }

    Write-Host "`nDone. Service '$ServiceName' installed and started."
    Write-Host "  Manage with:  nssm start|stop|restart $ServiceName"
    Write-Host "  Log files :   $ServiceDir\logs\"
    Write-Host "  Config file:  $ServiceDir\config.json"
    Write-Host "  Default URL:  http://localhost:8743/health"

} else {
    # ── Fallback: no nssm ─────────────────────────────────────────────────────
    Write-Warning @"

nssm.exe not found on PATH.
To install nssm: https://nssm.cc/download  (place nssm.exe in a folder on your PATH, then re-run this script).

── Manual / Task Scheduler alternative ──────────────────────────────────────
A launcher CMD file has been written to:
  $ServiceDir\start-modulehub-store.cmd

To run the service manually:
  1. Open a terminal and run:   $ServiceDir\start-modulehub-store.cmd

To schedule it via Task Scheduler:
  1. Open Task Scheduler → Create Basic Task.
  2. Trigger: "When the computer starts".
  3. Action: Start a program.
     Program/script: $ServiceDir\start-modulehub-store.cmd
  4. Check "Run whether user is logged on or not" + "Run with highest privileges".
  5. Save / enter credentials.

"@

    # Write the CMD launcher
    $CmdPath = Join-Path $ServiceDir 'start-modulehub-store.cmd'
    $CmdContent = @"
@echo off
REM ModuleHub Store launcher — generated by install-service.ps1
REM Place this in Task Scheduler (trigger: At startup) or run manually.

cd /d "%~dp0"
echo [ModuleHub Store] starting node server.js ...
"$NodeExe" "%~dp0server.js"
"@
    Set-Content -Path $CmdPath -Value $CmdContent -Encoding ASCII
    Write-Host "Launcher written: $CmdPath"
    Write-Host "Config file     : $ServiceDir\config.json"
    Write-Host "Default URL     : http://localhost:8743/health"
}
