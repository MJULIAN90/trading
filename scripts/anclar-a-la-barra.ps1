# Prepara el diario para poder anclarlo a la barra de tareas de Windows.
#
# ===========================================================================
# EL PROBLEMA, QUE TIENE DOS CAPAS
#
# Capa 1: Windows no deja anclar un .bat ni un .cmd. Al intentarlo ancla el
#         Explorador de archivos, porque el Explorador es el programa asociado
#         a esos ficheros.
#
# Capa 2: el arreglo obvio -un acceso directo a cmd.exe con el .cmd como
#         argumento- TAMPOCO funciona, y falla de una forma especialmente
#         molesta: se deja anclar, parece que va bien, y al pulsarlo abre una
#         consola vacia en C:\Users\<tu usuario>. Windows trata cmd.exe (y
#         explorer.exe, y powershell.exe) como casos especiales: al anclar se
#         queda con el programa y TIRA los argumentos.
#
# LA SOLUCION
#
# Un .exe normal y corriente. Se compila aqui mismo un lanzador minusculo que
# no hace mas que ejecutar scripts\trading.cmd. Como no es un ejecutable del
# sistema, Windows lo ancla como lo que es, con su icono y su comportamiento.
#
# No hace falta instalar nada para compilarlo: se usa el compilador de C# que
# viene dentro de .NET Framework, que esta en todos los Windows desde hace
# anos. Son cuatro lineas de codigo y tarda un segundo.
# ===========================================================================

$ErrorActionPreference = 'Stop'

$scripts  = $PSScriptRoot
$proyecto = Split-Path -Parent $scripts
$lanzador = Join-Path $scripts 'trading.cmd'
$icono    = Join-Path $scripts 'diario.ico'
$exe      = Join-Path $proyecto 'Diario de trading.exe'
$nombre   = 'Diario de trading'

if (-not (Test-Path $lanzador)) {
    Write-Host "No encuentro $lanzador" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------- el lanzador

# El .exe busca el .cmd a partir de SU PROPIA ubicacion, no de una ruta escrita
# dentro. Asi el proyecto se puede mover de carpeta o clonar en otro ordenador
# sin recompilar nada.
$codigo = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

public class DiarioDeTrading
{
    public static int Main(string[] args)
    {
        string raiz = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string cmd = Path.Combine(raiz, "scripts" + Path.DirectorySeparatorChar + "trading.cmd");

        if (!File.Exists(cmd))
        {
            Console.WriteLine("No encuentro " + cmd);
            Console.WriteLine("Este .exe tiene que estar en la raiz del proyecto.");
            Console.WriteLine();
            Console.WriteLine("Pulsa una tecla para cerrar.");
            Console.ReadKey();
            return 1;
        }

        ProcessStartInfo inicio = new ProcessStartInfo("cmd.exe", "/c \"" + cmd + "\"");
        inicio.UseShellExecute = false;
        inicio.WorkingDirectory = raiz;

        Process proceso = Process.Start(inicio);
        proceso.WaitForExit();
        return proceso.ExitCode;
    }
}
'@

if (Test-Path $exe) {
    try {
        Remove-Item $exe -Force
    } catch {
        Write-Host "No puedo reemplazar '$exe': parece que esta abierto." -ForegroundColor Red
        Write-Host "Cierra la ventana del diario y vuelve a ejecutar esto." -ForegroundColor Red
        exit 1
    }
}

Write-Host 'Compilando el lanzador...'

$compilado    = $false
$iconoDentro  = $false

# Se intenta PRIMERO con csc.exe y no con Add-Type, aunque Add-Type sea mas
# corto: es la unica de las dos que acepta /win32icon, es decir, la unica que
# deja el icono metido DENTRO del .exe. Y eso importa aqui mas de lo normal,
# porque la barra de tareas se queda con el icono del momento en que anclas: si
# dependiera de un .ico suelto, moverlo o borrarlo dejaria el icono en blanco.
$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
                     "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" `
                     -ErrorAction SilentlyContinue | Select-Object -First 1

if ($csc) {
    $fuente = Join-Path $env:TEMP 'DiarioDeTrading.cs'
    Set-Content -Path $fuente -Value $codigo -Encoding UTF8

    $argumentos = @('/nologo', '/target:exe', "/out:$exe")
    if (Test-Path $icono) { $argumentos += "/win32icon:$icono" }
    $argumentos += $fuente

    & $csc.FullName $argumentos | Out-Null
    Remove-Item $fuente -Force -ErrorAction SilentlyContinue

    $compilado = Test-Path $exe
    $iconoDentro = $compilado -and (Test-Path $icono)
}

# Respaldo. Deja el .exe sin icono propio, pero el acceso directo sigue
# apuntando al .ico, asi que se ve igual.
if (-not $compilado) {
    Write-Host '  csc.exe no estaba o fallo. Probando con Add-Type...'
    try {
        Add-Type -TypeDefinition $codigo -OutputAssembly $exe -OutputType ConsoleApplication
        $compilado = Test-Path $exe
    } catch {
        Write-Host "  Add-Type tampoco: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

if (-not $compilado) {
    Write-Host ''
    Write-Host 'No he podido compilar el lanzador.' -ForegroundColor Red
    Write-Host 'Como alternativa puedes arrancar el diario con doble clic en:'
    Write-Host "  $lanzador"
    exit 1
}

Write-Host "Lanzador creado: $exe" -ForegroundColor Green
if ($iconoDentro) {
    Write-Host '  con el icono del proyecto incrustado' -ForegroundColor Green
} elseif (-not (Test-Path $icono)) {
    Write-Host "  sin icono: falta $icono" -ForegroundColor DarkYellow
}

# ------------------------------------------------------------ accesos directos

# Dos sitios a proposito:
#   - El escritorio, por comodidad.
#   - El menu de inicio, porque es el camino que SIEMPRE ofrece "Anclar a la
#     barra de tareas". En el escritorio, segun la version de Windows, esa
#     opcion esta escondida detras de "Mostrar mas opciones".
$destinos = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop'))  "$nombre.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$nombre.lnk")
)

$shell = New-Object -ComObject WScript.Shell

foreach ($destino in $destinos) {
    $carpeta = Split-Path -Parent $destino
    if (-not (Test-Path $carpeta)) { New-Item -ItemType Directory -Path $carpeta -Force | Out-Null }

    $lnk = $shell.CreateShortcut($destino)

    # Sin argumentos: el .exe ya sabe lo que tiene que hacer. Esto es lo que
    # hace que el anclaje aguante, porque no hay argumentos que Windows pueda
    # tirar por el camino.
    $lnk.TargetPath       = $exe
    $lnk.WorkingDirectory = $proyecto

    # Si el icono quedo dentro del .exe se apunta ahi, que es lo mas robusto:
    # un solo fichero que llevarse. Si no, al .ico suelto.
    if ($iconoDentro)            { $lnk.IconLocation = "$exe,0" }
    elseif (Test-Path $icono)    { $lnk.IconLocation = "$icono,0" }

    $lnk.Description      = 'Compila y arranca el diario de trading'
    $lnk.WindowStyle      = 1
    $lnk.Save()

    Write-Host "Creado: $destino" -ForegroundColor Green
}

Write-Host ''
Write-Host '--------------------------------------------------------------'
Write-Host ' Ya esta. Falta anclarlo, y eso lo tienes que hacer tu: Windows'
Write-Host ' no permite que un script ancle nada a la barra de tareas.'
Write-Host ''
Write-Host " 1. Abre el menu de Inicio y escribe: $nombre"
Write-Host ' 2. Boton derecho sobre el resultado'
Write-Host ' 3. "Anclar a la barra de tareas"'
Write-Host ''
Write-Host ' Si tenias anclado el acceso directo anterior, DESANCLALO primero:'
Write-Host ' ese abre una consola vacia y no sirve.'
Write-Host ''
Write-Host ' Comprueba que funciona antes de darlo por bueno: pulsa el icono,'
Write-Host ' cierra la ventana, y pulsalo otra vez.'
Write-Host '--------------------------------------------------------------'
