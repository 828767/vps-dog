<#
.SYNOPSIS
    Cross-compile the VPS-DOG agent for every supported platform.

.DESCRIPTION
    Windows PowerShell equivalent of build.sh. Produces the same artifact
    names in dist/.

.EXAMPLE
    .\build.ps1
    .\build.ps1 -Version 1.2.3
#>
[CmdletBinding()]
param(
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not $Version) {
    $match = Select-String -Path 'version.go' -Pattern 'Version\s*=\s*"([^"]+)"' |
        Select-Object -First 1
    if ($match) { $Version = $match.Matches[0].Groups[1].Value }
}
if (-not $Version) {
    throw 'build.ps1: could not determine version; pass -Version x.y.z'
}

$ldflags = "-s -w -X main.Version=$Version"
$out = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$targets = @(
    @{ GOOS = 'linux';   GOARCH = 'amd64'; GOARM = ''  }
    @{ GOOS = 'linux';   GOARCH = 'arm64'; GOARM = ''  }
    @{ GOOS = 'linux';   GOARCH = 'arm';   GOARM = '7' }
    @{ GOOS = 'linux';   GOARCH = '386';   GOARM = ''  }
    @{ GOOS = 'darwin';  GOARCH = 'amd64'; GOARM = ''  }
    @{ GOOS = 'darwin';  GOARCH = 'arm64'; GOARM = ''  }
    @{ GOOS = 'windows'; GOARCH = 'amd64'; GOARM = ''  }
)

$env:CGO_ENABLED = '0'
Write-Host "building vps-dog $Version (CGO_ENABLED=0)"

foreach ($t in $targets) {
    $ext = if ($t.GOOS -eq 'windows') { '.exe' } else { '' }
    $name = "vps-dog-$($t.GOOS)-$($t.GOARCH)"
    if ($t.GOARM) { $name += "v$($t.GOARM)" }
    $name += $ext

    $env:GOOS = $t.GOOS
    $env:GOARCH = $t.GOARCH
    if ($t.GOARM) { $env:GOARM = $t.GOARM } else { Remove-Item Env:GOARM -ErrorAction SilentlyContinue }

    Write-Host ("  {0,-28}" -f $name) -NoNewline
    & go build -trimpath -ldflags $ldflags -o (Join-Path $out $name) .
    if ($LASTEXITCODE -ne 0) { throw "go build failed for $name" }
    Write-Host 'ok'
}

Remove-Item Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
Remove-Item Env:GOARM -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "artifacts in $out`:"
Get-ChildItem -Path $out | Format-Table Name, Length -AutoSize
