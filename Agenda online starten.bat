@echo off
rem Dubbelklik op dit bestand om de gezinsagenda te starten voor gebruik buitenshuis,
rem via Tailscale Funnel (zie README.md, "Manier 1").
title Gezinsagenda (online)
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

set "TAILSCALE=tailscale"
where tailscale >nul 2>nul
if errorlevel 1 set "TAILSCALE=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TAILSCALE%" if not "%TAILSCALE%"=="tailscale" (
  echo Tailscale is nog niet geinstalleerd.
  echo Installeer het van https://tailscale.com/download en log in.
  echo Dubbelklik daarna opnieuw op dit bestand.
  start "" https://tailscale.com/download
  pause
  exit /b 1
)

echo ==========================================================
echo   De gezinsagenda wordt gestart voor gebruik buitenshuis.
echo   Laat dit venster open; sluit het om de agenda te stoppen.
echo ==========================================================
echo.
echo De agenda wordt via Tailscale bereikbaar gemaakt...
"%TAILSCALE%" funnel --bg 3000
echo.
echo Het adres voor de telefoons staat hierboven (eindigt op .ts.net).
echo Vraagt Tailscale om Funnel aan te zetten? Open dan de link hierboven,
echo zet Funnel aan en dubbelklik daarna opnieuw op dit bestand.
echo.

start "" /min cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"
node server.js --online

echo.
echo De agenda is gestopt.
pause
