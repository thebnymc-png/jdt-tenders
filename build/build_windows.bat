@echo off
REM ============================================================
REM  Build JDT_Pricing_Model.exe on Windows
REM  Requires Python 3.10+ installed and on PATH.
REM  Run this from the project root:  build\build_windows.bat
REM ============================================================
setlocal

echo.
echo === Creating virtual environment ===
python -m venv .venv || goto :err
call .venv\Scripts\activate.bat || goto :err

echo.
echo === Installing dependencies ===
python -m pip install --upgrade pip || goto :err
pip install -r requirements.txt || goto :err
pip install pyinstaller==6.10.0 pythonnet==3.0.3 || goto :err

echo.
echo === Building executable ===
pyinstaller --noconfirm --clean build\JDT_Pricing_Model.spec || goto :err

echo.
echo ============================================================
echo  Done.  Your portable app is at:
echo     dist\JDT_Pricing_Model.exe
echo ============================================================
echo  Copy that single .exe anywhere (USB stick, shared drive).
echo  It creates jdt_pricing_data.json and quote PDFs next to itself.
goto :eof

:err
echo.
echo *** BUILD FAILED — see the error above. ***
exit /b 1
