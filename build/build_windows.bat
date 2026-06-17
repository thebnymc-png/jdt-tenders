@echo off
REM ============================================================
REM  Build JDT_Pricing_Model.exe on Windows
REM  Requires Python 3.10+ installed (python.org or Microsoft Store).
REM  You can DOUBLE-CLICK this file - it cd's to the project root
REM  itself and keeps the window open so you can read any error.
REM ============================================================
setlocal EnableDelayedExpansion

REM --- Always run from the project root (parent of this build\ folder) ---
cd /d "%~dp0.."
echo Working directory: %CD%

set "LOG=%CD%\build\build.log"
echo JDT build log - %DATE% %TIME% > "%LOG%"

REM --- Find a Python launcher: prefer "py -3", fall back to "python" ---
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (
  python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo.
  echo *** Python was not found on this PC. ***
  echo Install Python 3.10+ from https://www.python.org/downloads/
  echo IMPORTANT: tick "Add python.exe to PATH" during install, then re-run this.
  goto :fail
)
echo Using Python launcher: %PY%
%PY% --version

echo.
echo === [1/4] Creating virtual environment ===
%PY% -m venv .venv               >> "%LOG%" 2>&1 || goto :fail
call .venv\Scripts\activate.bat                          || goto :fail

echo.
echo === [2/4] Upgrading pip ===
python -m pip install --upgrade pip   >> "%LOG%" 2>&1 || goto :fail

echo.
echo === [3/4] Installing dependencies (this can take a few minutes) ===
pip install -r requirements.txt                   >> "%LOG%" 2>&1 || goto :fail
pip install pyinstaller==6.10.0 pythonnet==3.0.3   >> "%LOG%" 2>&1 || goto :fail

echo.
echo === [4/4] Building executable ===
pyinstaller --noconfirm --clean build\JDT_Pricing_Model.spec >> "%LOG%" 2>&1 || goto :fail

if not exist "dist\JDT_Pricing_Model.exe" goto :fail

echo.
echo ============================================================
echo  SUCCESS. Your portable app is at:
echo     %CD%\dist\JDT_Pricing_Model.exe
echo ============================================================
echo  Copy that single .exe anywhere (USB stick, shared drive).
echo  It creates jdt_pricing_data.json and quote PDFs next to itself.
echo.
echo Press any key to close this window...
pause >nul
exit /b 0

:fail
echo.
echo ************************************************************
echo  BUILD FAILED.
echo  The full log was saved to:
echo     %LOG%
echo  Scroll up to see the error, or open that log file and
echo  send it over so it can be diagnosed.
echo ************************************************************
echo.
echo Press any key to close this window...
pause >nul
exit /b 1
