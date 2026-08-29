@echo off
title Claude Code (Open Gravity Bridge)
cd /d "%~dp0"

if exist "open-gravity.exe" (
    "open-gravity.exe" claude %*
) else (
    node dist\index.js claude %*
)
