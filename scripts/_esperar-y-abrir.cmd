@echo off
setlocal

rem ===========================================================================
rem  Espera a que el servidor conteste y abre el navegador.
rem
rem  Va en un fichero aparte y no dentro de trading.cmd por una razon practica:
rem  un bucle con comillas anidadas metido dentro de un "start" de otro .cmd se
rem  rompe en cuanto alguien toca una comilla. Separado se lee y se arregla.
rem
rem  Uso:  _esperar-y-abrir.cmd <puerto>
rem ===========================================================================

set "PUERTO=%~1"
if "%PUERTO%"=="" set "PUERTO=4321"

set "URL=http://127.0.0.1:%PUERTO%/"

rem curl viene con Windows 10 (1803) y posteriores. Si no estuviera, no se
rem puede sondear, asi que se espera un rato fijo y se abre igualmente: es peor
rem no abrir nada que abrir un poco pronto.
where curl >nul 2>&1 || goto :sinCurl

rem Hasta 90 intentos de un segundo. De sobra incluso con la base fria. Si se
rem agotan es que algo fallo de verdad, y entonces no se abre nada: mejor eso
rem que una pestana con un error de conexion que parece culpa del navegador.
rem
rem La espera se hace con ping y no con timeout porque timeout se niega a
rem funcionar cuando la entrada esta redirigida, y aqui lo esta.
for /l %%i in (1,1,90) do (
    curl -s -o nul --max-time 2 "%URL%" && goto :abrir
    ping -n 2 127.0.0.1 >nul
)

exit /b 1

:sinCurl
ping -n 9 127.0.0.1 >nul

:abrir
start "" "%URL%"
exit /b 0
