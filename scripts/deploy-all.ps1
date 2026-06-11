<#
.SYNOPSIS
  Packages all widgets and copies .cwp files to the OMI widget library.

.EXAMPLE
  .\deploy-all.ps1
  .\deploy-all.ps1 -OmiWidgetDir "C:\Custom\Path\CustomWidgets"
#>
param(
  [string]$WidgetsDir   = "$PSScriptRoot\..\widgets",
  [string]$OutputDir    = "$PSScriptRoot\..\dist",
  [string]$OmiWidgetDir = "$env:ProgramData\AVEVA\OMI\CustomWidgets"
)

$packageScript = "$PSScriptRoot\package-cwp.ps1"

Get-ChildItem $WidgetsDir -Directory | ForEach-Object {
  Write-Host "Packaging: $($_.Name)" -ForegroundColor Cyan
  & $packageScript -WidgetName $_.Name -WidgetsDir $WidgetsDir -OutputDir $OutputDir
}

# Deploy to OMI widget library
if (Test-Path $OmiWidgetDir) {
  Copy-Item "$OutputDir\*.cwp" $OmiWidgetDir -Force
  Write-Host "Deployed to: $OmiWidgetDir" -ForegroundColor Green
} else {
  Write-Warning "OMI widget directory not found: $OmiWidgetDir"
  Write-Host "Built .cwp files are in: $OutputDir" -ForegroundColor Yellow
  Write-Host "Copy them manually to your OMI CustomWidgets folder." -ForegroundColor Yellow
}
