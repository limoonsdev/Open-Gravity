@echo off
title Open Gravity - Local AI Proxy
cd /d "%~dp0"

if exist "open-gravity.exe" (
    start "" "open-gravity.exe" start --open
) else (
    node dist\index.js start --open
)
