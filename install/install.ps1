# Nitro installer for Windows.
#   powershell -ExecutionPolicy Bypass -File install\install.ps1          (copies the extension)
#   powershell -ExecutionPolicy Bypass -File install\install.ps1 -Dev     (links to this folder, for development)
#   powershell -ExecutionPolicy Bypass -File install\install.ps1 -Uninstall
param([switch]$Dev, [switch]$Uninstall, [switch]$Deps)
$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$extRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$dest = Join-Path $extRoot 'Nitro'

function Remove-Existing {
    if (Test-Path $dest) {
        $item = Get-Item $dest -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $item.Delete() }
        else { Remove-Item $dest -Recurse -Force }
    }
}

if ($Uninstall) {
    Remove-Existing
    Write-Host 'Nitro removido.' -ForegroundColor Yellow
    exit 0
}

# Unsigned extensions need PlayerDebugMode for each CEP version (AE 2019+ = CSXS 9..12).
foreach ($v in 9..12) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
}

New-Item -ItemType Directory -Force $extRoot | Out-Null
Remove-Existing
if ($Dev) {
    New-Item -ItemType Junction -Path $dest -Target $src | Out-Null
    Write-Host "Link de desenvolvimento criado: $dest -> $src" -ForegroundColor Cyan
} else {
    New-Item -ItemType Directory -Force $dest | Out-Null
    foreach ($d in 'CSXS', 'client', 'host', 'scripts') {
        Copy-Item (Join-Path $src $d) -Destination $dest -Recurse -Force
    }
    Write-Host "Nitro instalado em $dest" -ForegroundColor Green
}

if ($Deps) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) { winget install -e --id yt-dlp.yt-dlp --accept-source-agreements --accept-package-agreements }
        if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements }
    } else {
        Write-Warning 'winget não encontrado: instale yt-dlp e ffmpeg pelo painel (Ajustes).'
    }
}

Write-Host ''
Write-Host 'Pronto! Reinicie o After Effects e abra: Window > Extensions > Nitro' -ForegroundColor Green
