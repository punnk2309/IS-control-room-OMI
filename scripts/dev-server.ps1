<#
.SYNOPSIS
  Tiny static dev server for the repo (no dependencies).

.DESCRIPTION
  Serves the repository root so widgets can be developed at
  http://localhost:8080/widgets/SmartFactoryControlRoom/index.html
  Ctrl+C to stop.

.EXAMPLE
  .\dev-server.ps1
  .\dev-server.ps1 -Port 9090
#>
param(
  [int]$Port = 8080,
  [string]$Root = (Resolve-Path "$PSScriptRoot\..")
)

$mime = @{
  '.html' = 'text/html'; '.js' = 'text/javascript'; '.css' = 'text/css'
  '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.map' = 'application/json'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root" -ForegroundColor Cyan
Write-Host "Dashboard: http://localhost:$Port/widgets/SmartFactoryControlRoom/index.html" -ForegroundColor Green
Write-Host "Dev Module: http://localhost:$Port/widgets/ModuleHub/index.html" -ForegroundColor Green

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'widgets/SmartFactoryControlRoom/index.html' }
    $path = Join-Path $Root $rel

    if ((Test-Path $path -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($path)
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $ctx.Response.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
} finally {
  $listener.Stop()
}
