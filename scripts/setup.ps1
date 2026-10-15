# Montaje del diario en una maquina nueva (Windows / PowerShell).
#
#   cd trading-journal
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#
# Es seguro ejecutarlo varias veces: no pisa el `.env` si ya existe y no borra
# nada. Lo unico que hace de verdad es instalar, compilar y comprobar.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== Diario de trading: montaje ===" -ForegroundColor Cyan
Write-Host ""

# --- Node --------------------------------------------------------------------

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node no esta instalado." -ForegroundColor Red
  Write-Host "Bajalo de https://nodejs.org (version 22 LTS) y vuelve a lanzar esto."
  exit 1
}

$version = (& node -v).TrimStart('v')
$major = [int]($version.Split('.')[0])
if ($major -lt 20) {
  Write-Host "Node $version es demasiado antiguo. Hace falta 20 o superior (mejor 22 LTS)." -ForegroundColor Red
  exit 1
}
Write-Host "Node $version" -ForegroundColor Green

# --- Gestor de paquetes ------------------------------------------------------
#
# pnpm si esta; si no, npm, que viene con Node. Los dos valen.

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $pm = 'pnpm'
} else {
  $pm = 'npm'
  Write-Host "pnpm no esta; uso npm." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Instalando dependencias con $pm..." -ForegroundColor Cyan
& $pm install
if ($LASTEXITCODE -ne 0) { Write-Host "Fallo la instalacion." -ForegroundColor Red; exit 1 }

# better-sqlite3 lleva un binario nativo. pnpm bloquea los scripts de
# instalacion desde la v10, y sin ese script el servidor revienta al primer
# import con un error de "bindings" que no menciona la causa. Esta autorizado en
# pnpm-workspace.yaml, pero si la instalacion venia de antes hay que repararla.
Write-Host ""
Write-Host "Comprobando el binario nativo de better-sqlite3..." -ForegroundColor Cyan
& node -e "require('better-sqlite3')" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  no cargaba; reconstruyendo" -ForegroundColor Yellow
  & $pm rebuild better-sqlite3
}

# --- Configuracion -----------------------------------------------------------

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host ""
  Write-Host "Creado .env a partir de la plantilla." -ForegroundColor Green
  Write-Host "  Revisalo antes de operar, sobre todo REAL_TRADING_SINCE." -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host ".env ya existe, no lo toco." -ForegroundColor DarkGray
}

# --- Indicadores -------------------------------------------------------------

Write-Host ""
Write-Host "Reapuntando los proyectos de los indicadores a este Quantower..." -ForegroundColor Cyan
& node scripts\setup-indicators.mjs
# Que no haya indicadores no impide usar el diario con datos ya ingeridos, asi
# que un fallo aqui no corta el montaje.

# --- Front -------------------------------------------------------------------

Write-Host ""
Write-Host "Compilando el front..." -ForegroundColor Cyan
& $pm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Fallo la compilacion del front." -ForegroundColor Red; exit 1 }

# --- Primera ingesta ---------------------------------------------------------

Write-Host ""
Write-Host "Primera ingesta..." -ForegroundColor Cyan
& $pm run ingest

# --- Revision ----------------------------------------------------------------

Write-Host ""
Write-Host "=== Revision ===" -ForegroundColor Cyan
& node scripts\doctor.mjs

Write-Host ""
Write-Host "Arranca con:  $pm run dev" -ForegroundColor Green
Write-Host "Y abre:       http://127.0.0.1:4321"
Write-Host ""
