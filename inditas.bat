@echo off
rem ---------------------------------------------------------------
rem  OCR Szovegkinyero - inditas Windowson
rem  Kattints ra duplan. Elindit egy helyi kiszolgalot es megnyitja
rem  az oldalt a bongeszoben. A fekete ablakot hagyd nyitva, amig
rem  hasznalod; bezarassal leall a kiszolgalo.
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0"
set PORT=8080

echo.
echo   OCR Szovegkinyero indul...
echo.

rem 1. Python (a Windows Store-os "py" inditoval)
where py >nul 2>nul
if %errorlevel%==0 (
    start "" http://localhost:%PORT%
    py -3 -m http.server %PORT%
    goto vege
)

rem 2. Python a PATH-on
where python >nul 2>nul
if %errorlevel%==0 (
    start "" http://localhost:%PORT%
    python -m http.server %PORT%
    goto vege
)

rem 3. Node.js
where node >nul 2>nul
if %errorlevel%==0 (
    start "" http://localhost:%PORT%
    node "scripts\server.js" %PORT%
    goto vege
)

echo   Nem talaltam sem Pythont, sem Node.js-t a gepen.
echo.
echo   Telepitsd valamelyiket, aztan probald ujra:
echo     Python  -  https://www.python.org/downloads/
echo     Node.js -  https://nodejs.org/
echo.
pause

:vege
endlocal
