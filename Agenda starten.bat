@echo off
rem Dubbelklik op dit bestand om de gezinsagenda te starten (thuis, via wifi).
title Gezinsagenda
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is nog niet geinstalleerd.
  echo Installeer eerst de LTS-versie van https://nodejs.org
  echo en dubbelklik daarna opnieuw op dit bestand.
  start "" https://nodejs.org
  pause
  exit /b 1
)

rem Eenmalig een certificaat maken, zodat telefoons de microfoon mogen gebruiken.
if not exist "data\cert\cert.pem" (
  echo Eenmalig een certificaat maken...
  node scripts\certificaat.js
  echo.
)

set "URL=http://localhost:3000"
if exist "data\cert\cert.pem" set "URL=https://localhost:3000"

echo ==========================================================
echo   De gezinsagenda wordt gestart.
echo   Laat dit venster open; sluit het om de agenda te stoppen.
echo   Op de telefoons gebruik je het adres hieronder bij
echo   "Op de telefoon (zelfde wifi)".
echo ==========================================================
echo.

rem Open de agenda na 2 seconden in de browser.
start "" /min cmd /c "timeout /t 2 /nobreak >nul && start %URL%"
node server.js

echo.
echo De agenda is gestopt. Staat er hierboven een foutmelding, maak dan een foto
echo van dit venster zodat je kunt laten zien wat er mis ging.
pause
