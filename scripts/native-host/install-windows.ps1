param(
  [Parameter(Mandatory=$true)]
  [string]$ExtensionId,

  [Parameter(Mandatory=$true)]
  [string]$HostPath
)

$ErrorActionPreference = "Stop"

if (-not [System.IO.Path]::IsPathRooted($HostPath)) {
  throw "HostPath must be absolute."
}

$hostDir = Join-Path $env:LOCALAPPDATA "xsync"
$hostFile = Join-Path $hostDir "com.xunit.xsync.json"
New-Item -ItemType Directory -Force -Path $hostDir | Out-Null

$manifest = @{
  name = "com.xunit.xsync"
  description = "xsync native messaging host"
  path = $HostPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4

Set-Content -Path $hostFile -Value $manifest -Encoding UTF8

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.xunit.xsync"
New-Item -Force -Path $registryPath | Out-Null
Set-Item -Path $registryPath -Value $hostFile

Write-Host "Installed $hostFile"
