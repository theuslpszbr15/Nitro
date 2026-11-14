@echo off
title Nitro - instalador
echo Instalando Nitro para After Effects...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Deps
echo.
pause
