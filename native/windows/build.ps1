$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$project = Join-Path $root "native\windows\XsyncTray\XsyncTray.csproj"
$output = Join-Path $root "dist\windows"

dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $output

Write-Host "Built $output"
