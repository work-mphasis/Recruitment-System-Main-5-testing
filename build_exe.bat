@echo off
echo ============================================================
echo  ATS Exe Builder
echo ============================================================
echo.

:: Check venv
if not exist ".venv\Scripts\python.exe" (
    echo ERROR: .venv not found. Run this from the project root.
    pause & exit /b 1
)

:: Build React frontend
echo [1/3] Building React frontend...
cd frontend
call npm run build
if errorlevel 1 ( echo ERROR: npm build failed & cd .. & pause & exit /b 1 )
cd ..
echo Done.
echo.

:: Install PyInstaller if missing
echo [2/3] Checking PyInstaller...
.venv\Scripts\python.exe -m pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo Installing PyInstaller...
    .venv\Scripts\python.exe -m pip install pyinstaller
)
echo Done.
echo.

:: Run PyInstaller
echo [3/3] Building exe (this takes a few minutes)...
cd Backend
"..\\.venv\Scripts\pyinstaller.exe" ats.spec --noconfirm
if errorlevel 1 ( echo ERROR: PyInstaller failed & cd .. & pause & exit /b 1 )
cd ..
echo.

echo ============================================================
echo  Build complete!
echo  Exe folder: Backend\dist\ATS\
echo  Copy that entire ATS folder to the other laptop and
echo  double-click ATS.exe to launch.
echo ============================================================
pause
