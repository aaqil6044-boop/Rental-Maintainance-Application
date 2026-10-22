# Starts EstateOps (backend + bundled UI). No Maven install needed.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location (Join-Path $PSScriptRoot 'backend')

$mvnVer  = '3.9.9'
$base    = Join-Path $PSScriptRoot '.maven'
$mvnHome = Join-Path $base "apache-maven-$mvnVer"
$mvnCmd  = Join-Path $mvnHome 'bin\mvn.cmd'

if (-not (Test-Path $mvnCmd)) {
    Write-Host "Setting up Maven $mvnVer (one time, needs internet)..." -ForegroundColor Cyan
    if (Test-Path $base) { Remove-Item $base -Recurse -Force }   # clear any partial download
    New-Item -ItemType Directory -Force -Path $base | Out-Null
    $zip = Join-Path $base 'maven.zip'
    Invoke-WebRequest -Uri "https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/$mvnVer/apache-maven-$mvnVer-bin.zip" -OutFile $zip
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $base)  # reliable, no Expand-Archive bug
    Remove-Item $zip -Force
}

if (-not (Test-Path $mvnCmd)) {
    Write-Host "Maven setup failed - see the messages above." -ForegroundColor Red
    exit 1
}

$env:Path = (Join-Path $mvnHome 'bin') + ';' + $env:Path
Write-Host ""
Write-Host "Building and starting the app (first run downloads dependencies)..." -ForegroundColor Green
Write-Host "When you see 'Started Application', open:  http://localhost:8080" -ForegroundColor Green
Write-Host ""
& $mvnCmd spring-boot:run
