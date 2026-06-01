param(
  [Parameter(Mandatory=$true)]
  [string]$HostPath
)

$ErrorActionPreference = "Stop"

if (-not [System.IO.Path]::IsPathRooted($HostPath)) {
  throw "HostPath must be absolute."
}

$root = "HKCU:\Software\Classes\xsync"
New-Item -Force -Path $root | Out-Null
Set-Item -Path $root -Value "URL:xsync Protocol"
New-ItemProperty -Force -Path $root -Name "URL Protocol" -Value "" | Out-Null

$commandPath = Join-Path $root "shell\open\command"
New-Item -Force -Path $commandPath | Out-Null
Set-Item -Path $commandPath -Value "`"$HostPath`" `"%1`""

Write-Host "Installed xsync:// URL protocol handler"
