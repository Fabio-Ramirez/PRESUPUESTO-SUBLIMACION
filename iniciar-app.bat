@echo off
setlocal
cd /d "%~dp0"
title Calculadora PRO de Sublimacion - iniciando...

echo.
echo Iniciando Calculadora PRO de Sublimacion...
echo.

rem El servidor corre en una ventana APARTE y minimizada. Asi, cuando esta
rem ventana (la del arranque) se cierra, la aplicacion sigue funcionando.
start "Calculadora PRO - SERVIDOR (no cerrar)" /min cmd /k "cd /d "%~dp0" && set NODE_ENV=production && node api\dist\index.js"

echo Esperando a que el servidor arranque...
set intentos=0

:esperar
set /a intentos+=1
curl --fail -s -o nul http://localhost:3000/api/salud
if not errorlevel 1 goto listo
if %intentos% GEQ 30 goto fallo
timeout /t 1 /nobreak >nul
goto esperar

:listo
echo Servidor listo. Abriendo la aplicacion...
start "" http://localhost:3000
echo.
echo La aplicacion sigue funcionando en la ventana minimizada llamada
echo "Calculadora PRO - SERVIDOR (no cerrar)". La vas a encontrar en la
echo barra de tareas. Para APAGAR la aplicacion, cerra esa ventana.
echo.
echo Esta ventana ya se puede cerrar.
pause
goto :eof

:fallo
echo.
echo El servidor no respondio despues de 30 segundos.
echo Buscá en la barra de tareas la ventana "Calculadora PRO - SERVIDOR"
echo (puede estar minimizada) y fijate que error muestra.
echo.
echo Motivos habituales: MongoDB no esta corriendo, o el puerto 3000
echo ya esta en uso por otro programa.
echo.
pause
