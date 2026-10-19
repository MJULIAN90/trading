@echo off
rem ===========================================================================
rem  Doble clic aqui UNA vez. Crea el acceso directo del diario en el
rem  escritorio y en el menu de inicio, listo para anclar a la barra de tareas.
rem
rem  Solo es un envoltorio: el trabajo lo hace el .ps1 de al lado. Existe
rem  porque un .ps1 no se ejecuta con doble clic (Windows lo abre en el
rem  Bloc de notas), y el -ExecutionPolicy Bypass de aqui evita tener que
rem  tocar la politica de PowerShell de la maquina.
rem ===========================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0anclar-a-la-barra.ps1"
pause
