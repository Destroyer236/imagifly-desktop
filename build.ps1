#Requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Package,
    [switch]$Test
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$env:CGO_ENABLED = '0'
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'
if (-not $env:GOPROXY) { $env:GOPROXY = 'https://goproxy.cn,direct' }

$version = (Select-String -LiteralPath (Join-Path $root 'main.go') -Pattern 'const version = "([^"]+)"').Matches[0].Groups[1].Value
Write-Host "Imagifly Desktop $version  (windows/amd64, CGO_ENABLED=0)"

if ($Test) {
    Write-Host 'go test ./...'
    go test ./...
    if ($LASTEXITCODE -ne 0) { throw '单元测试失败' }
}

Write-Host 'go build'
$syso = Join-Path $root 'rsrc_windows_amd64.syso'
$resources = @((Join-Path $root 'app.manifest'), (Join-Path $root 'assets\app.ico'))
$needsRsrc = -not (Test-Path -LiteralPath $syso)
if (-not $needsRsrc) {
    $sysoTime = (Get-Item -LiteralPath $syso).LastWriteTimeUtc
    foreach ($res in $resources) {
        if ((Test-Path -LiteralPath $res) -and (Get-Item -LiteralPath $res).LastWriteTimeUtc -gt $sysoTime) { $needsRsrc = $true }
    }
}
if ($needsRsrc) {
    $rsrc = Get-Command rsrc -ErrorAction SilentlyContinue
    if (-not $rsrc -and (Test-Path -LiteralPath (Join-Path $env:USERPROFILE 'go\bin\rsrc.exe'))) {
        $rsrc = Get-Item -LiteralPath (Join-Path $env:USERPROFILE 'go\bin\rsrc.exe')
    }
    if (-not $rsrc) { throw '需要 rsrc 才能嵌入 manifest/icon：go install github.com/akavel/rsrc@latest' }
    $rsrcPath = if ($rsrc -is [System.Management.Automation.ApplicationInfo]) { $rsrc.Source } else { $rsrc.FullName }
    Write-Host 'rsrc: manifest + icon -> rsrc_windows_amd64.syso'
    & $rsrcPath -manifest (Join-Path $root 'app.manifest') -ico (Join-Path $root 'assets\app.ico') -o $syso
    if ($LASTEXITCODE -ne 0) { throw 'rsrc 失败' }
}
go build -trimpath -ldflags '-s -w' -o imagifly-desktop.exe .
if ($LASTEXITCODE -ne 0) { throw 'go build 失败' }

$exe = Join-Path $root 'imagifly-desktop.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw '未生成 imagifly-desktop.exe' }
$sizeMB = [math]::Round((Get-Item -LiteralPath $exe).Length / 1MB, 1)
Write-Host "OK: $exe ($sizeMB MB)"

if ($Package) {
    $distRoot = Join-Path $root 'dist'
    $dir = Join-Path $distRoot "ImagiflyDesktop-$version-win64"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item -LiteralPath $exe -Destination $dir -Force
    foreach ($doc in 'README.md', 'API-COVERAGE.md') {
        $src = Join-Path $root $doc
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $dir -Force }
    }
    if (Test-Path -LiteralPath (Join-Path $root 'assets\app.ico')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $dir 'assets') | Out-Null
        Copy-Item -LiteralPath (Join-Path $root 'assets\app.ico') -Destination (Join-Path $dir 'assets') -Force
    }
    $zip = Join-Path $distRoot "ImagiflyDesktop-$version-win64.zip"
    Compress-Archive -Path (Join-Path $dir '*') -DestinationPath $zip -CompressionLevel Optimal -Force
    Write-Host "PACKAGE: $zip"
}
