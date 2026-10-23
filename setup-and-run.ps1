# EstateOps - one-step setup and run.
# Moves the superseded generated packages out of the source tree (nothing is deleted),
# then builds and starts the application.
$ErrorActionPreference = 'Stop'

$root   = $PSScriptRoot
$srcPkg = Join-Path $root 'backend\src\main\java\com\pmp'
$attic  = Join-Path $root '_old_backend'

$superseded = @('ai','api','billing','domain','identity','maintenance','notif',
                'notifications','occupancy','onboarding','property','reporting',
                'security','shared','vendor')

Write-Host "Step 1 of 2: moving superseded packages aside" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $attic | Out-Null

$moved = 0
foreach ($name in $superseded) {
    $from = Join-Path $srcPkg $name
    if (Test-Path $from) {
        $to = Join-Path $attic $name
        if (Test-Path $to) { Remove-Item $to -Recurse -Force }
        Move-Item -LiteralPath $from -Destination $to -Force
        Write-Host ("  moved {0}" -f $name)
        $moved++
    }
}
if ($moved -eq 0) {
    Write-Host "  already done - nothing to move" -ForegroundColor DarkGray
} else {
    Write-Host ("  {0} package(s) moved to _old_backend (kept, not deleted)" -f $moved) -ForegroundColor Green
}

# Also clear any stale compiled output so the old classes cannot linger.
$target = Join-Path $root 'backend\target'
if (Test-Path $target) { Remove-Item $target -Recurse -Force; Write-Host "  cleared backend\target" }

Write-Host ""
Write-Host "Step 2 of 2: building and starting" -ForegroundColor Cyan

$mvn = Join-Path $root '.maven\apache-maven-3.9.9\bin\mvn.cmd'
if (-not (Test-Path $mvn)) {
    Write-Host "Maven not found at $mvn - run run.bat once first to download it." -ForegroundColor Red
    exit 1
}

Set-Location (Join-Path $root 'backend')
Write-Host "When you see 'Started Application', open http://localhost:8080" -ForegroundColor Green
Write-Host "Sign in: manager@estateops.test / password123" -ForegroundColor Green
Write-Host ""

& $mvn spring-boot:run
