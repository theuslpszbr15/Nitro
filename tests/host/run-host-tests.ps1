# Runs tests\host\host-tests.jsx inside After Effects and prints the results.
param(
    [string]$AfterFX = "",
    [int]$TimeoutSec = 600
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$media = Join-Path $here 'media'
$results = Join-Path $here 'results.json'

if (-not $AfterFX) {
    $AfterFX = Get-ChildItem 'C:\Program Files\Adobe' -Directory -Filter 'Adobe After Effects*' |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'Support Files\AfterFX.exe' } |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $AfterFX) { throw 'AfterFX.exe not found. Pass -AfterFX <path>.' }

New-Item -ItemType Directory -Force $media | Out-Null
$video = Join-Path $media 'speech.mp4'
if (-not (Test-Path $video)) {
    # Tone / silence pattern: speech 0-1s, 2.5-4.5s, 5.5-6s.
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=1280x720:r=30:d=6" `
        -f lavfi -i "aevalsrc='(lt(t,1)+between(t,2.5,4.5)+gt(t,5.5))*0.5*sin(440*2*PI*t)':s=48000:d=6" `
        -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest $video
}
$png = Join-Path $media 'logo.png'
if (-not (Test-Path $png)) {
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=0xfe2c55:s=512x512,format=rgba" -frames:v 1 $png
}

Remove-Item $results -ErrorAction SilentlyContinue
Get-ChildItem $media -Filter 'nx_render_*' -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue

# Preferred: run through the open Nitro panel (no file-write preference needed).
node (Join-Path $here 'run-via-panel.js')
if ($LASTEXITCODE -ne 2) { exit $LASTEXITCODE }

# Fallback: panel closed. Needs Preferences > Scripting & Expressions > "Allow Scripts to Write Files".
$jsx = (Join-Path $here 'host-tests.jsx') -replace '\\', '/'
Write-Host "Panel closed; running $jsx via AfterFX -s (writes results.json)"
& $AfterFX -s "NX_TEST_WRITE_FILE = true; `$.evalFile(new File('$jsx'))"

$sw = [Diagnostics.Stopwatch]::StartNew()
while (-not (Test-Path $results)) {
    if ($sw.Elapsed.TotalSeconds -gt $TimeoutSec) { throw "Timed out waiting for $results" }
    Start-Sleep -Seconds 2
}
Start-Sleep -Milliseconds 500
$data = Get-Content $results -Raw -Encoding UTF8 | ConvertFrom-Json
$fail = @($data | Where-Object { -not $_.pass })
foreach ($r in $data) {
    $mark = if ($r.pass) { 'PASS' } else { 'FAIL' }
    Write-Host ("[{0}] {1} {2}" -f $mark, $r.name, $(if (-not $r.pass) { $r.info } else { '' }))
}
Write-Host ("{0} passed, {1} failed" -f ($data.Count - $fail.Count), $fail.Count)
if ($fail.Count) { exit 1 }
