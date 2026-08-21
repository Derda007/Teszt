@echo off
rem ---------------------------------------------------------------
rem  OCR Szovegkinyero - inditas Windowson
rem
rem  Kattints ra duplan. Elindit egy helyi kiszolgalot, megvarja, amig
rem  az tenyleg valaszol, es csak utana nyitja meg a bongeszot.
rem
rem  Ezt az ablakot hagyd nyitva, amig hasznalod. Bezarassal leall.
rem
rem  A vezerles szandekosan gotokkal megy, zarojeles blokkok nelkul:
rem  azok a cmd leggyakoribb hibaforrasai.
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0."

set "PORT=8080"
set "URL=http://localhost:%PORT%"

rem A szkript onmagat hivja meg ezzel a kapcsoloval egy kulon ablakban,
rem hogy a bongeszot csak a kiszolgalo elindulasa utan nyissa meg.
if /i "%~1"=="--megnyitas" goto megnyitas

echo.
echo   OCR Szovegkinyero
echo   =================
echo.

rem ---------------------------------------------------------------
rem  Ertelmezo keresese
rem
rem  Nem eleg megnezni, hogy letezik-e a parancs: a Windows 10/11
rem  alapbol tesz a PATH-ra egy "python" helyettesitot, ami valojaban
rem  csak a Microsoft Store-t nyitja meg. Ezert mindegyiket ki is
rem  probaljuk egy artalmatlan parancesal.
rem ---------------------------------------------------------------
set "SERVER="

py -3 -c "pass" >nul 2>nul
if not errorlevel 1 set "SERVER=py -3 -m http.server %PORT% --bind 127.0.0.1"
if defined SERVER goto indit

python -c "pass" >nul 2>nul
if not errorlevel 1 set "SERVER=python -m http.server %PORT% --bind 127.0.0.1"
if defined SERVER goto indit

python3 -c "pass" >nul 2>nul
if not errorlevel 1 set "SERVER=python3 -m http.server %PORT% --bind 127.0.0.1"
if defined SERVER goto indit

node -e "0" >nul 2>nul
if not errorlevel 1 set "SERVER=node scripts\server.js %PORT%"
if defined SERVER goto indit

goto nincs_ertelmezo


:indit
echo   Kiszolgalo indul a(z^) %PORT% porton...
echo   Cim: %URL%
echo.
echo   Leallitas: zard be ezt az ablakot, vagy nyomj Ctrl+C-t.
echo.

rem A bongeszot kulon ablak nyitja meg, amint a kiszolgalo valaszol.
start "OCR - bongeszo" /min "%~f0" --megnyitas

%SERVER%

echo.
echo   A kiszolgalo leallt.
echo.
echo   Ha azonnal leallt, a %PORT% port valoszinuleg mar foglalt:
echo   zard be a masik peldanyt, vagy ird at a PORT sort ebben a fajlban.
echo.
pause
exit /b


:nincs_ertelmezo
echo   Nem talaltam mukodo Pythont vagy Node.js-t a gepen.
echo.
echo   Ha a Windows a Microsoft Store-t ajanlja fel, amikor a "python"
echo   parancsot beirod, akkor a Python nincs telepitve - csak egy
echo   helyettesito all a helyen.
echo.
echo   Telepitsd valamelyiket, aztan probald ujra:
echo     Python  -  https://www.python.org/downloads/
echo                telepiteskor pipald be: Add python.exe to PATH
echo     Node.js -  https://nodejs.org/
echo.
pause
exit /b 1


rem ---------------------------------------------------------------
rem  Kulon ablakban fut: megvarja a kiszolgalot, majd megnyitja
rem ---------------------------------------------------------------
:megnyitas
where curl >nul 2>nul
if errorlevel 1 goto varakozas_fixen

set /a PROBA=0
:varakozas_ciklus
curl -s -o nul "%URL%" >nul 2>nul
if not errorlevel 1 goto nyitas
set /a PROBA+=1
if %PROBA% GEQ 60 goto nyitas
timeout /t 1 /nobreak >nul
goto varakozas_ciklus

:varakozas_fixen
rem Nincs curl: adjunk a kiszolgalonak nehany masodpercet.
timeout /t 3 /nobreak >nul

:nyitas
start "" "%URL%"
exit /b
