Param(
  [string]$RepoPath = "."
)
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -Path (Join-Path $Here "package.json") -Destination (Join-Path $RepoPath "package.json") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $RepoPath ".github\workflows") | Out-Null
Copy-Item -Path (Join-Path $Here ".github\workflows\release.yml") -Destination (Join-Path $RepoPath ".github\workflows\release.yml") -Force
Copy-Item -Path (Join-Path $Here "README_GitHub.md") -Destination (Join-Path $RepoPath "README_GitHub.md") -Force
Write-Host "Patch applied. Now run:"
Write-Host "  git add ."
Write-Host "  git commit -m 'ci: GitHub Releases (nsis + portable) and electron-builder publish'"
Write-Host "  git push origin main"
