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
# Manda la INSTALACION que ya haya, no lo que este en el PATH. Un equipo puede
# tener pnpm instalado y haber montado el proyecto con npm: llamar a pnpm sobre
# unas dependencias que no son suyas falla sin explicar por que.
#
# Sin node_modules, pnpm por defecto, y npm si pnpm no esta.

$tienePnpm = [bool](Get-Command pnpm -ErrorAction SilentlyContinue)

if (Test-Path 'node_modules\.pnpm') {
  $pm = 'pnpm'
  Write-Host "Este proyecto se monto con pnpm; sigo con pnpm." -ForegroundColor DarkGray
} elseif (Test-Path 'node_modules\.package-lock.json') {
  $pm = 'npm'
  Write-Host "Este proyecto se monto con npm; sigo con npm." -ForegroundColor DarkGray
} elseif ($tienePnpm) {
  $pm = 'pnpm'
} else {
  $pm = 'npm'
  Write-Host "pnpm no esta; uso npm." -ForegroundColor DarkGray
}

if ($pm -eq 'pnpm' -and -not $tienePnpm) {
  $pm = 'npm'
  Write-Host "pnpm no esta en este equipo; uso npm." -ForegroundColor DarkGray
}

if ($PWD.Path -match ' ') {
  Write-Host ""
  Write-Host "AVISO: la ruta de este proyecto tiene un espacio." -ForegroundColor Yellow
  Write-Host "  $($PWD.Path)" -ForegroundColor White
  Write-Host "  Suele funcionar, pero si hay que compilar el binario nativo de" -ForegroundColor DarkGray
  Write-Host "  better-sqlite3 el compilador de Windows falla por el espacio." -ForegroundColor DarkGray
  Write-Host "  Si este montaje falla mas abajo, mueve el proyecto a C:\trading-journal." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Instalando dependencias con $pm..." -ForegroundColor Cyan
& $pm install

# DISCOS SIN ENLACES SIMBOLICOS.
#
# pnpm instala creando symlinks por todas partes. En exFAT y FAT32 -lo normal
# en discos externos y memorias USB- eso es imposible, y falla con:
#
#   Failed to create symlink ... Funcion incorrecta. (os error 1)
#
# El mensaje no dice nada de symlinks ni del sistema de ficheros, asi que es
# facil perder una tarde. Se reintenta copiando en vez de enlazar, que es lo
# que hace npm de toda la vida: ocupa algo mas de disco y ya esta.
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "La instalacion fallo. Reintento sin enlaces simbolicos" -ForegroundColor Yellow
  Write-Host "(normal si el proyecto esta en un disco externo o USB)." -ForegroundColor DarkGray

  if ($pm -eq 'pnpm') {
    & $pm install --node-linker=hoisted
  } else {
    & $pm install
  }

  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Sigue fallando." -ForegroundColor Red
    Write-Host "Prueba a mover el proyecto a una carpeta del disco C:, que esta" -ForegroundColor Yellow
    Write-Host "formateado en NTFS y no tiene esta limitacion." -ForegroundColor Yellow
    exit 1
  }

  Write-Host "Instalado copiando en vez de enlazar." -ForegroundColor Green
  Write-Host "Recuerda usar --node-linker=hoisted si vuelves a instalar aqui." -ForegroundColor DarkGray
}

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

  # La reconstruccion tambien puede fallar, y antes se seguia adelante como si
  # nada: el montaje decia "listo" y el servidor reventaba despues con un error
  # de "bindings" que no menciona nada de esto. Ahora se para y se dicen las
  # dos causas reales, que son las dos de Windows y ninguna es obvia.
  & node -e "require('better-sqlite3')" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "No se pudo construir el binario nativo de better-sqlite3." -ForegroundColor Red
    Write-Host "Sin el, el diario no arranca. Las dos causas habituales:" -ForegroundColor Yellow
    Write-Host ""

    if ($PWD.Path -match ' ') {
      Write-Host "  1. HAY UN ESPACIO EN LA RUTA, y esta es la causa mas probable:" -ForegroundColor Yellow
      Write-Host "     $($PWD.Path)" -ForegroundColor White
      Write-Host "     El compilador de modulos nativos de Windows se atraganta con" -ForegroundColor DarkGray
      Write-Host "     los espacios. Mueve el proyecto a una ruta sin ellos, por" -ForegroundColor DarkGray
      Write-Host "     ejemplo C:\trading-journal, y vuelve a lanzar este script." -ForegroundColor DarkGray
    } else {
      Write-Host "  1. La ruta no tiene espacios, asi que no es eso." -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "  2. Falta el compilador de C++ de Windows. Node $(node -v) puede no" -ForegroundColor Yellow
    Write-Host "     tener binario precompilado y entonces hay que compilarlo aqui." -ForegroundColor DarkGray
    Write-Host "     Se arregla instalando 'Herramientas de compilacion de Visual" -ForegroundColor DarkGray
    Write-Host "     Studio' con la carga 'Desarrollo para el escritorio con C++'," -ForegroundColor DarkGray
    Write-Host "     o usando una version LTS de Node (22 o 24), que si los trae." -ForegroundColor DarkGray
    Write-Host ""
    exit 1
  }

  Write-Host "  reconstruido" -ForegroundColor Green
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
