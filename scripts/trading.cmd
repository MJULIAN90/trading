@echo off
setlocal

rem ===========================================================================
rem  Arranca el diario de trading: compila el front y levanta el servidor.
rem
rem  No se ancla ESTE fichero a la barra de tareas. Windows no deja anclar un
rem  .bat ni un .cmd: al intentarlo ancla el Explorador de archivos, que es lo
rem  que pasaba antes. Hay que anclar un acceso directo, y eso lo crea
rem  "anclar-a-la-barra.cmd" que esta en esta misma carpeta. Se ejecuta UNA vez.
rem
rem  Para parar el servidor basta con cerrar la ventana.
rem ===========================================================================

title Diario de trading

rem Puerto del servidor. Si lo cambias en .env (variable PORT), cambialo aqui.
set "PUERTO=4321"

rem La raiz del proyecto es la carpeta padre de esta. Asi el fichero sigue
rem funcionando si mueves el proyecto de sitio o lo clonas en otro ordenador,
rem que es justo donde una ruta escrita a mano deja de valer.
cd /d "%~dp0.."
if errorlevel 1 (
    echo No consigo entrar en la carpeta del proyecto.
    pause
    exit /b 1
)

echo Proyecto: %CD%
echo.

rem --- Servidor anterior colgado ---------------------------------------------
rem Al cerrar la ventana con la X, node no siempre muere del todo y se queda
rem con el puerto cogido. El siguiente arranque falla con un EADDRINUSE que no
rem explica nada de esto, asi que se limpia antes de empezar.
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%PUERTO% .*LISTENING"') do (
    echo Habia un servidor anterior abierto ^(PID %%P^). Lo cierro.
    taskkill /PID %%P /T /F >nul 2>&1
)

rem --- Dependencias -----------------------------------------------------------
if not exist "node_modules\" (
    echo No hay dependencias instaladas. Instalando, esto tarda un rato...
    call pnpm install
    if errorlevel 1 (
        echo.
        echo FALLO LA INSTALACION. Mira el error de arriba.
        pause
        exit /b 1
    )
)

rem --- Compilar el front ------------------------------------------------------
echo Compilando la interfaz...
call pnpm build
if errorlevel 1 (
    echo.
    echo FALLO LA COMPILACION. El servidor no se arranca.
    echo Si el error habla de tipos, ejecuta:  pnpm typecheck
    pause
    exit /b 1
)

rem --- Abrir el navegador cuando el servidor conteste -------------------------
rem En segundo plano, para no bloquear el arranque. Sondea el puerto en vez de
rem esperar un numero fijo de segundos: el primer arranque del dia tarda mas
rem porque la base esta fria, y una espera fija abre la pestana en un error.
start /b "" "%~dp0_esperar-y-abrir.cmd" %PUERTO%

rem --- Arrancar ---------------------------------------------------------------
echo.
echo ---------------------------------------------------------------
echo  Diario en http://127.0.0.1:%PUERTO%
echo  Cierra esta ventana para parar el servidor.
echo ---------------------------------------------------------------
echo.

call pnpm dev

echo.
echo El servidor se ha parado.
pause
