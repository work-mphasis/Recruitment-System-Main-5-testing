param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Command = "start"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunDir = Join-Path $Root ".run"
$LogDir = Join-Path $Root "logs"
$LocalVenvDir = Join-Path $Root ".venv"
$RequirementsFile = Join-Path $Root "requirements.txt"
$BackendDir = Join-Path $Root "Backend"
$FrontendDir = Join-Path $Root "frontend"
$BackendPidFile = Join-Path $RunDir "backend.pid"
$FrontendPidFile = Join-Path $RunDir "frontend.pid"
$BackendOutLog = Join-Path $LogDir "backend.out.log"
$BackendErrLog = Join-Path $LogDir "backend.err.log"
$FrontendOutLog = Join-Path $LogDir "frontend.out.log"
$FrontendErrLog = Join-Path $LogDir "frontend.err.log"
$BackendPort = 8000
$FrontendPort = 5173

function Ensure-Directories {
    New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null
}

function Get-PidFromFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return $null
    }

    $rawPid = (Get-Content $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($rawPid -match "^\d+$") {
        return [int]$rawPid
    }

    return $null
}

function Test-ProcessRunning {
    param([Nullable[int]]$ProcessId)

    if ($null -eq $ProcessId) {
        return $false
    }

    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-ListeningProcessIds {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq "127.0.0.1" -or $_.LocalAddress -eq "0.0.0.0" }
    if (-not $connections) {
        return @()
    }

    return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-PythonExecutable {
    param([string]$FilePath)

    try {
        & $FilePath --version *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Resolve-BasePythonCommand {
    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    if (-not $pyLauncher) {
        $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    }

    if ($pyLauncher) {
        return @{
            FilePath = $pyLauncher.Source
            PrefixArgs = @("-3")
        }
    }

    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) {
        $python = Get-Command python -ErrorAction Stop
    }

    return @{
        FilePath = $python.Source
        PrefixArgs = @()
    }
}

function Invoke-PythonCommand {
    param(
        [hashtable]$Python,
        [string[]]$Arguments
    )

    & $Python.FilePath @($Python.PrefixArgs + $Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed: $($Python.FilePath) $($Python.PrefixArgs + $Arguments -join ' ')"
    }
}

function Install-BackendDependencies {
    param([string]$PythonPath)

    if (-not (Test-Path $RequirementsFile)) {
        return
    }

    Write-Host "Installing backend dependencies from requirements.txt..."
    & $PythonPath -m pip install -r $RequirementsFile 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install backend dependencies."
    }
}

function Ensure-LocalVenv {
    $localVenvPython = Join-Path $LocalVenvDir "Scripts\python.exe"
    if (Test-PythonExecutable $localVenvPython) {
        return $localVenvPython
    }

    $basePython = Resolve-BasePythonCommand
    Write-Host "Creating local Python environment in .venv..."
    Invoke-PythonCommand -Python $basePython -Arguments @("-m", "venv", $LocalVenvDir)

    if (-not (Test-PythonExecutable $localVenvPython)) {
        throw "Created .venv, but its Python executable is not working."
    }

    Install-BackendDependencies -PythonPath $localVenvPython
    return $localVenvPython
}

function Resolve-PythonCommand {
    $localVenvPython = Join-Path $LocalVenvDir "Scripts\python.exe"
    if (Test-PythonExecutable $localVenvPython) {
        return @{
            FilePath = $localVenvPython
            PrefixArgs = @()
        }
    }

    $legacyVenvPython = Join-Path $Root "venv\Scripts\python.exe"
    if (Test-PythonExecutable $legacyVenvPython) {
        return @{
            FilePath = $legacyVenvPython
            PrefixArgs = @()
        }
    }

    $createdVenvPython = Ensure-LocalVenv
    return @{
        FilePath = $createdVenvPython
        PrefixArgs = @()
    }
}

function Test-PythonModule {
    param(
        [hashtable]$Python,
        [string]$ModuleName
    )

    try {
        & $Python.FilePath @($Python.PrefixArgs + @("-c", "import $ModuleName")) *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Resolve-BackendPythonCommand {
    $python = Resolve-PythonCommand

    if (-not (Test-PythonModule -Python $python -ModuleName "uvicorn")) {
        if ($python.FilePath -like (Join-Path $LocalVenvDir "*")) {
            Install-BackendDependencies -PythonPath $python.FilePath
        } else {
            $createdVenvPython = Ensure-LocalVenv
            $python = @{
                FilePath = $createdVenvPython
                PrefixArgs = @()
            }
        }
    }

    return $python
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    }

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Start-Backend {
    $existingPid = Get-PidFromFile $BackendPidFile
    $portPids = Get-ListeningProcessIds -Port $BackendPort
    if ($portPids.Count -gt 0) {
        if (Test-ProcessRunning $existingPid) {
            Write-Host "Backend already running on http://127.0.0.1:$BackendPort (PID $existingPid)."
        } else {
            Set-Content -Path $BackendPidFile -Value $portPids[0]
            Write-Host "Backend already listening on http://127.0.0.1:$BackendPort (PID $($portPids[0]))."
        }
        return
    }

    if (Test-ProcessRunning $existingPid) {
        Write-Host "Backend process was running without listening on port $BackendPort; restarting it."
        Stop-ProcessTree -ProcessId $existingPid
        Remove-Item $BackendPidFile -ErrorAction SilentlyContinue
    }

    $python = Resolve-BackendPythonCommand
    $backendArgs = @($python.PrefixArgs) + @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort", "--reload")

    $oldPythonUtf8 = $env:PYTHONUTF8
    $oldPythonIoEncoding = $env:PYTHONIOENCODING
    try {
        $env:PYTHONUTF8 = "1"
        $env:PYTHONIOENCODING = "utf-8"

        $process = Start-Process `
            -FilePath $python.FilePath `
            -ArgumentList $backendArgs `
            -WorkingDirectory $BackendDir `
            -RedirectStandardOutput $BackendOutLog `
            -RedirectStandardError $BackendErrLog `
            -WindowStyle Hidden `
            -PassThru
    } finally {
        $env:PYTHONUTF8 = $oldPythonUtf8
        $env:PYTHONIOENCODING = $oldPythonIoEncoding
    }

    Set-Content -Path $BackendPidFile -Value $process.Id
    Write-Host "Backend started on http://127.0.0.1:$BackendPort (PID $($process.Id))."
}

function Start-Frontend {
    $existingPid = Get-PidFromFile $FrontendPidFile
    $portPids = Get-ListeningProcessIds -Port $FrontendPort
    if ($portPids.Count -gt 0) {
        if (Test-ProcessRunning $existingPid) {
            Write-Host "Frontend already running on http://127.0.0.1:$FrontendPort (PID $existingPid)."
        } else {
            Set-Content -Path $FrontendPidFile -Value $portPids[0]
            Write-Host "Frontend already listening on http://127.0.0.1:$FrontendPort (PID $($portPids[0]))."
        }
        return
    }

    if (Test-ProcessRunning $existingPid) {
        Write-Host "Frontend process was running without listening on port $FrontendPort; restarting it."
        Stop-ProcessTree -ProcessId $existingPid
        Remove-Item $FrontendPidFile -ErrorAction SilentlyContinue
    }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm -ErrorAction Stop
    }

    $process = Start-Process `
        -FilePath $npm.Source `
        -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$FrontendPort") `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $FrontendOutLog `
        -RedirectStandardError $FrontendErrLog `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -Path $FrontendPidFile -Value $process.Id
    Write-Host "Frontend started on http://127.0.0.1:$FrontendPort (PID $($process.Id))."
}

function Stop-ServiceProcess {
    param(
        [string]$Name,
        [string]$PidFile,
        [int]$Port
    )

    $pidValue = Get-PidFromFile $PidFile
    $portPids = Get-ListeningProcessIds -Port $Port
    if ((-not (Test-ProcessRunning $pidValue)) -and $portPids.Count -eq 0) {
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        Write-Host "$Name is not running."
        return
    }

    if (Test-ProcessRunning $pidValue) {
        Stop-ProcessTree -ProcessId $pidValue
    }

    foreach ($portPid in $portPids) {
        if (Test-ProcessRunning $portPid) {
            Stop-ProcessTree -ProcessId $portPid
        }
    }

    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host "$Name stopped."
}

function Show-Status {
    $backendPid = Get-PidFromFile $BackendPidFile
    $frontendPid = Get-PidFromFile $FrontendPidFile
    $backendPortPids = Get-ListeningProcessIds -Port $BackendPort
    $frontendPortPids = Get-ListeningProcessIds -Port $FrontendPort

    if ((Test-ProcessRunning $backendPid) -and $backendPortPids.Count -gt 0) {
        Write-Host "Backend:  running on http://127.0.0.1:$BackendPort (PID $backendPid)"
    } elseif ($backendPortPids.Count -gt 0) {
        Write-Host "Backend:  running on http://127.0.0.1:$BackendPort (PID $($backendPortPids[0]), discovered by port)"
    } elseif (Test-ProcessRunning $backendPid) {
        Write-Host "Backend:  process running but port $BackendPort is not listening (PID $backendPid)"
    } else {
        Write-Host "Backend:  stopped"
    }

    if ((Test-ProcessRunning $frontendPid) -and $frontendPortPids.Count -gt 0) {
        Write-Host "Frontend: running on http://127.0.0.1:$FrontendPort (PID $frontendPid)"
    } elseif ($frontendPortPids.Count -gt 0) {
        Write-Host "Frontend: running on http://127.0.0.1:$FrontendPort (PID $($frontendPortPids[0]), discovered by port)"
    } elseif (Test-ProcessRunning $frontendPid) {
        Write-Host "Frontend: process running but port $FrontendPort is not listening (PID $frontendPid)"
    } else {
        Write-Host "Frontend: stopped"
    }

    Write-Host "Logs:     $LogDir"
}

function Start-App {
    Ensure-Directories
    Start-Backend
    Start-Frontend
    Write-Host ""
    Write-Host "Open http://127.0.0.1:$FrontendPort in your browser."
}

function Stop-App {
    Stop-ServiceProcess -Name "Frontend" -PidFile $FrontendPidFile -Port $FrontendPort
    Stop-ServiceProcess -Name "Backend" -PidFile $BackendPidFile -Port $BackendPort
}

switch ($Command) {
    "start" {
        Start-App
    }
    "stop" {
        Stop-App
    }
    "restart" {
        Stop-App
        Start-App
    }
    "status" {
        Ensure-Directories
        Show-Status
    }
}
