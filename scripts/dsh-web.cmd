@echo off
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dsh-web.ps1" %*
