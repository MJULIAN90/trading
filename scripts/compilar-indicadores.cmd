@echo off
setlocal enabledelayedexpansion

rem ---------------------------------------------------------------------
rem  Compila los tres indicadores de Quantower y deja TODA la salida del
rem  compilador en un fichero de texto.
rem
rem  Doble clic y listo. No hace falta Visual Studio: basta con el SDK de
rem  .NET, que es una descarga mucho mas pequena.
rem
rem  Vive DENTRO del proyecto (scripts\) a proposito, para que viaje con el
rem  al copiarlo a otro ordenador. Las rutas se calculan solas desde donde
rem  esta este fichero, asi que no hay nada que editar.
rem ---------------------------------------------------------------------

rem %~dp0 = esta carpeta (scripts\). El proyecto es el padre, y los
rem indicadores son carpetas hermanas del proyecto.
set "PROYECTO=%~dp0.."
set "REPOS=%~dp0..\.."
set "LOG=%~dp0compilacion.log"

rem Permite pasar otra ruta:  compilar-indicadores.cmd "D:\codigo"
if not "%~1"=="" set "REPOS=%~1"

echo ===================================================== > "%LOG%"
echo  COMPILACION  %DATE% %TIME%                          >> "%LOG%"
echo  Indicadores en: %REPOS%                             >> "%LOG%"
echo ===================================================== >> "%LOG%"

where dotnet >nul 2>&1
if errorlevel 1 (
    echo.
    echo  FALTA EL SDK DE .NET
    echo.
    echo  Descargalo de https://dotnet.microsoft.com/download
    echo  Elige "SDK", no "Runtime".
    echo.
    echo FALTA EL SDK DE .NET >> "%LOG%"
    pause
    exit /b 1
)

echo. >> "%LOG%"
dotnet --version >> "%LOG%" 2>&1

rem Antes de compilar, reapuntar los proyectos al Quantower de ESTA maquina.
rem Sin esto, en un ordenador nuevo el error habla de una referencia que falta
rem y no de la ruta, que es mucho mas dificil de adivinar.
where node >nul 2>&1
if not errorlevel 1 (
    echo. >> "%LOG%"
    echo --- apuntando los proyectos a este Quantower --- >> "%LOG%"
    node "%PROYECTO%\scripts\setup-indicators.mjs" >> "%LOG%" 2>&1
)

set "FALLOS=0"

for %%P in (KillZones j_flujo j_Guardia) do (
    echo.                                                   >> "%LOG%"
    echo =====================================================>> "%LOG%"
    echo  PROYECTO: %%P                                      >> "%LOG%"
    echo =====================================================>> "%LOG%"

    if not exist "%REPOS%\%%P" (
        echo ERROR: no existe la carpeta %REPOS%\%%P         >> "%LOG%"
        set /a FALLOS+=1
    ) else (
        pushd "%REPOS%\%%P"

        rem Clean + Build siempre. Los ficheros copiados de otro ordenador
        rem llegan con la fecha descolocada, y MSBuild decide por fechas si
        rem compila: sin el Clean se salta el trabajo y deja el DLL viejo.
        echo --- limpiando ---                               >> "%LOG%"
        dotnet clean -c Release --nologo -v quiet            >> "%LOG%" 2>&1

        echo --- compilando ---                              >> "%LOG%"
        dotnet build -c Release --nologo -v minimal          >> "%LOG%" 2>&1

        if errorlevel 1 (
            echo RESULTADO: FALLO                            >> "%LOG%"
            set /a FALLOS+=1
        ) else (
            echo RESULTADO: OK                               >> "%LOG%"
        )

        popd
    )
)

echo.                                                       >> "%LOG%"
echo ===================================================== >> "%LOG%"
echo  PROYECTOS CON FALLO: %FALLOS%                        >> "%LOG%"
echo ===================================================== >> "%LOG%"

type "%LOG%"

echo.
echo ---------------------------------------------------------
if "%FALLOS%"=="0" (
    echo  TODO OK. Reinicia Quantower para que recoja los DLL.
) else (
    echo  Hubo %FALLOS% fallo(s). El detalle esta arriba y en:
    echo  %LOG%
)
echo ---------------------------------------------------------
pause
