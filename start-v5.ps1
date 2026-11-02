param(
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $Root "Backend"
$FrontendDir = Join-Path $Root "frontend"
$RunDir = Join-Path $Root ".run"
$LogDir = Join-Path $Root "logs"
$BackendPidFile = Join-Path $RunDir "backend.pid"
$FrontendPidFile = Join-Path $RunDir "frontend.pid"
$BackendOutLog = Join-Path $LogDir "backend.out.log"
$BackendErrLog = Join-Path $LogDir "backend.err.log"
$FrontendOutLog = Join-Path $LogDir "frontend.out.log"
$FrontendErrLog = Join-Path $LogDir "frontend.err.log"
$BackendPort = 8000
$FrontendPort = 5173
$DatabaseUrl = "sqlite:///../.run/runtime-v5.db"

New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null

function Get-PidFromFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $raw = Get-Content $Path -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($raw -match "^\d+$") { return [int]$raw }
    return $null
}

function Test-ProcessRunning {
    param([Nullable[int]]$ProcessId)
    return $null -ne $ProcessId -and $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Get-PortPids {
    param([int]$Port)
    @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-AppPort {
    param([int]$Port)
    foreach ($pidValue in Get-PortPids $Port) {
        if (Test-ProcessRunning $pidValue) {
            Stop-ProcessTree -ProcessId $pidValue
        }
    }
}

function Resolve-Python {
    $localPython = Join-Path $Root ".venv\Scripts\python.exe"
    if (Test-Path $localPython) { return $localPython }

    $legacyPython = Join-Path $Root "venv\Scripts\python.exe"
    if (Test-Path $legacyPython) { return $legacyPython }

    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) { $python = Get-Command python -ErrorAction Stop }
    return $python.Source
}

function Start-Backend {
    $python = Resolve-Python

    $oldDatabaseUrl = $env:DATABASE_URL
    $oldPythonUtf8 = $env:PYTHONUTF8
    $oldPythonIoEncoding = $env:PYTHONIOENCODING
    try {
        $env:DATABASE_URL = $DatabaseUrl
        $env:PYTHONUTF8 = "1"
        $env:PYTHONIOENCODING = "utf-8"

        $process = Start-Process `
            -FilePath $python `
            -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort", "--reload") `
            -WorkingDirectory $BackendDir `
            -RedirectStandardOutput $BackendOutLog `
            -RedirectStandardError $BackendErrLog `
            -WindowStyle Hidden `
            -PassThru
    } finally {
        $env:DATABASE_URL = $oldDatabaseUrl
        $env:PYTHONUTF8 = $oldPythonUtf8
        $env:PYTHONIOENCODING = $oldPythonIoEncoding
    }

    Set-Content -Path $BackendPidFile -Value $process.Id
    Write-Host "Backend started on http://127.0.0.1:$BackendPort (PID $($process.Id))"
}

function Start-Frontend {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { $npm = Get-Command npm -ErrorAction Stop }

    $oldApiUrl = $env:VITE_API_URL
    try {
        $env:VITE_API_URL = "http://127.0.0.1:$BackendPort"
        $process = Start-Process `
            -FilePath $npm.Source `
            -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$FrontendPort", "--strictPort") `
            -WorkingDirectory $FrontendDir `
            -RedirectStandardOutput $FrontendOutLog `
            -RedirectStandardError $FrontendErrLog `
            -WindowStyle Hidden `
            -PassThru
    } finally {
        $env:VITE_API_URL = $oldApiUrl
    }

    Set-Content -Path $FrontendPidFile -Value $process.Id
    Write-Host "Frontend started on http://127.0.0.1:$FrontendPort (PID $($process.Id))"
}

function Wait-ForUrl {
    param(
        [string]$Url,
        [int]$Seconds = 20
    )
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
            return $true
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)
    return $false
}

if (-not $NoRestart) {
    foreach ($pidFile in @($BackendPidFile, $FrontendPidFile)) {
        $pidValue = Get-PidFromFile $pidFile
        if (Test-ProcessRunning $pidValue) {
            Stop-ProcessTree -ProcessId $pidValue
        }
        Remove-Item $pidFile -ErrorAction SilentlyContinue
    }
    Stop-AppPort $BackendPort
    Stop-AppPort $FrontendPort
}

Start-Backend
Start-Frontend

$backendReady = Wait-ForUrl "http://127.0.0.1:$BackendPort/talentnext-catalog/status" 30
$frontendReady = Wait-ForUrl "http://127.0.0.1:$FrontendPort" 30

Write-Host ""
Write-Host "Backend:  http://127.0.0.1:$BackendPort $(if ($backendReady) { '(ready)' } else { '(starting - check logs)' })"
Write-Host "Frontend: http://127.0.0.1:$FrontendPort $(if ($frontendReady) { '(ready)' } else { '(starting - check logs)' })"
Write-Host "Database: $DatabaseUrl"
Write-Host "Logs:     $LogDir"
