@echo off
setlocal
title ComfyUI Launcher

if not defined COMFYUI_ROOT (
    for %%I in ("%~dp0..\..\..") do set "COMFYUI_ROOT=%%~fI"
)
if not defined COMFYUI_HOST set "COMFYUI_HOST=127.0.0.1"
if not defined COMFYUI_PORT set "COMFYUI_PORT=8188"

cd /d "%COMFYUI_ROOT%"
if errorlevel 1 (
    echo [ERROR] ComfyUI root not found: %COMFYUI_ROOT%
    pause
    exit /b 1
)

if not exist "main.py" (
    echo [ERROR] main.py not found in: %COMFYUI_ROOT%
    pause
    exit /b 1
)

for /f "tokens=5" %%P in ('netstat -aon ^| findstr /R /C:":%COMFYUI_PORT% .*LISTENING"') do (
    set "COMFYUI_PID=%%P"
)

if defined COMFYUI_PID (
    echo ComfyUI is already running on %COMFYUI_HOST%:%COMFYUI_PORT% ^(PID %COMFYUI_PID%^).
    echo Opening the existing instance...
    start "" http://%COMFYUI_HOST%:%COMFYUI_PORT%
    pause
    exit /b 0
)

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Python virtual environment not found: %COMFYUI_ROOT%\.venv
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [ERROR] Failed to activate virtual environment.
    pause
    exit /b 1
)

echo Starting ComfyUI...
python main.py --enable-manager --listen %COMFYUI_HOST% --port %COMFYUI_PORT%

if errorlevel 1 (
    echo.
    echo ComfyUI exited with an error.
    pause
)

endlocal
