$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace "release"))
$unpackedRoot = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "YT-Auto-Translate-TTS-unpacked"))
$manifestData = Get-Content -LiteralPath (Join-Path $workspace "manifest.json") -Raw | ConvertFrom-Json
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "YT-Auto-Translate-TTS-v$($manifestData.version).zip"))

function Assert-InWorkspace {
  param([string]$Candidate)

  $workspacePrefix = $workspace.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Candidate.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the workspace: $Candidate"
  }
}

Assert-InWorkspace $releaseRoot
Assert-InWorkspace $unpackedRoot
Assert-InWorkspace $zipPath

if (Test-Path -LiteralPath $releaseRoot) {
  Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $unpackedRoot -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $workspace "manifest.json") -Destination $unpackedRoot
Copy-Item -LiteralPath (Join-Path $workspace "extension") -Destination $unpackedRoot -Recurse

Compress-Archive -LiteralPath (Join-Path $unpackedRoot "manifest.json"), (Join-Path $unpackedRoot "extension") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output "Unpacked extension: $unpackedRoot"
Write-Output "ZIP archive: $zipPath"
