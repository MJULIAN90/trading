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

rem --- Con que se instalo esto --------------------------------------------
rem
rem Se mira la INSTALACION, no lo que haya en el PATH. Un equipo puede tener
rem pnpm instalado y aun asi haber montado el proyecto con npm: elegir por el
rem PATH llamaria a pnpm sobre unas dependencias que no son suyas, y el
rem arranque falla sin decir por que.
rem
rem   node_modules\.pnpm\          -> lo monto pnpm
rem   node_modules\.package-lock   -> lo monto npm
rem
rem Si no hay node_modules todavia, manda el fichero de bloqueo del repo, y en
rem ultimo caso lo que haya instalado.

set "PM="
if exist "node_modules\.pnpm\" set "PM=pnpm"
if exist "node_modules\.package-lock.json" set "PM=npm"

if not defined PM (
    if exist "pnpm-lock.yaml" set "PM=pnpm"
)
if not defined PM (
    if exist "package-lock.json" set "PM=npm"
)
if not defined PM (
    where pnpm >nul 2>&1
    if errorlevel 1 (set "PM=npm") else (set "PM=pnpm")
)

rem Y se comprueba que el elegido existe de verdad, por si el proyecto viene
rem de otro equipo con otro gestor.
where %PM% >nul 2>&1
if errorlevel 1 (
    echo %PM% no esta instalado en este equipo.
    if "%PM%"=="pnpm" (
        echo Uso npm, que viene con Node.
        set "PM=npm"
    ) else (
        echo Instala Node desde https://nodejs.org
        pause
        exit /b 1
    )
)

echo Gestor:   %PM%
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
    call %PM% install
    if errorlevel 1 (
        echo.
        echo FALLO LA INSTALACION. Mira el error de arriba.
        pause
        exit /b 1
    )
)

rem --- Binario nativo de better-sqlite3 ---------------------------------------
rem
rem Es el fallo numero uno al montar esto en otra maquina, y el peor de
rem diagnosticar: la instalacion termina en tres segundos sin un solo error y
rem el servidor revienta despues con un mensaje sobre "bindings" que no
rem menciona ni pnpm ni los permisos de compilacion.
rem
rem Se comprueba en cada arranque porque es barato y porque el permiso se
rem puede perder solo: pnpm 12 migra el pnpm-workspace.yaml y al hacerlo
rem puede dejar los paquetes en false.
node -e "require('better-sqlite3')" >nul 2>&1
if errorlevel 1 (
    echo El binario nativo de better-sqlite3 no carga. Reconstruyendo...
    call %PM% rebuild better-sqlite3
    node -e "require('better-sqlite3')" >nul 2>&1
    if errorlevel 1 (
        echo.
        echo NO SE PUDO CONSTRUIR better-sqlite3. El diario no puede arrancar.
        echo.
        echo Mira en pnpm-workspace.yaml que better-sqlite3 este en TRUE, tanto
        echo en onlyBuiltDependencies como en allowBuilds. Si pnpm dice
        echo "already up to date" o "no packages awaiting approval" y aun asi
        echo falla, es que lo tiene PROHIBIDO, no pendiente.
        echo.
        echo La salida rapida es cambiar a npm en este equipo:
        echo    rmdir /s /q node_modules
        echo    del pnpm-lock.yaml
        echo    npm install
        echo.
        pause
        exit /b 1
    )
    echo Reconstruido.
)

rem --- Compilar el front ------------------------------------------------------
echo Compilando la interfaz...
call %PM% build
if errorlevel 1 (
    echo.
    echo FALLO LA COMPILACION. El servidor no se arranca.
    echo Si el error habla de tipos, ejecuta:  %PM% typecheck
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

call %PM% dev

echo.
echo El servidor se ha parado.
pause
