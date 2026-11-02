# build_exe.ps1
# One-click script to build the Recruitment System .exe for distribution.
# Run from the project root:  .\build_exe.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host ""
Write-Host "=== Recruitment System — Build EXE ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Build the React frontend ─────────────────────────────────────────
Write-Host "[1/3] Building React frontend..." -ForegroundColor Yellow
Set-Location "$Root\frontend"
npm install
npm run build
if (-not (Test-Path "dist\index.html")) {
    Write-Error "Frontend build failed — dist\index.html not found."
}
Write-Host "      Frontend built OK." -ForegroundColor Green
Set-Location $Root

# ── Step 2: Install PyInstaller if missing ────────────────────────────────────
Write-Host "[2/3] Checking PyInstaller..." -ForegroundColor Yellow
$pip = "$Root\.venv\Scripts\pip.exe"
if (-not (Test-Path $pip)) { $pip = "pip" }
& $pip install --quiet pyinstaller
Write-Host "      PyInstaller OK." -ForegroundColor Green

# ── Step 3: Run PyInstaller ───────────────────────────────────────────────────
Write-Host "[3/3] Packaging with PyInstaller..." -ForegroundColor Yellow
$pyinstaller = "$Root\.venv\Scripts\pyinstaller.exe"
if (-not (Test-Path $pyinstaller)) { $pyinstaller = "pyinstaller" }
& $pyinstaller recruitment.spec --noconfirm

$distPath = "$Root\dist\RecruitmentSystem"
if (-not (Test-Path "$distPath\RecruitmentSystem.exe")) {
    Write-Error "Build failed — exe not found in dist\RecruitmentSystem\"
}

Write-Host ""
Write-Host "=== Build complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Distribute the folder:  dist\RecruitmentSystem\" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your team:"
Write-Host "  1. Unzip / copy the RecruitmentSystem folder anywhere"
Write-Host "  2. Double-click  RecruitmentSystem.exe"
Write-Host "  3. Browser opens automatically at http://127.0.0.1:8000"
Write-Host ""
