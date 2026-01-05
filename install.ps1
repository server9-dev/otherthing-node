# RhizOS Node Agent Installer for Windows
# https://github.com/Huck-dev/rhizos-node

$ErrorActionPreference = "Stop"

$repo = "Huck-dev/rhizos-node"
$installDir = "$env:LOCALAPPDATA\RhizOS"
$binaryName = "rhizos-node.exe"

Write-Host ""
Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     RhizOS Node Agent Installer       ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Create install directory
if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

# Get latest release
Write-Host "Fetching latest release..." -ForegroundColor Yellow
$releaseUrl = "https://api.github.com/repos/$repo/releases/latest"

try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers @{"Accept"="application/vnd.github.v3+json"}
    $asset = $release.assets | Where-Object { $_.name -like "*windows*amd64*" } | Select-Object -First 1

    if ($asset) {
        $downloadUrl = $asset.browser_download_url
        Write-Host "Downloading from $downloadUrl..." -ForegroundColor Yellow

        $outputPath = Join-Path $installDir $binaryName
        Invoke-WebRequest -Uri $downloadUrl -OutFile $outputPath
    } else {
        throw "No Windows binary found in release"
    }
} catch {
    Write-Host "No pre-built binary available. Please build from source:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  git clone https://github.com/$repo.git" -ForegroundColor White
    Write-Host "  cd rhizos-node" -ForegroundColor White
    Write-Host "  cargo build --release" -ForegroundColor White
    Write-Host ""
    exit 1
}

# Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    Write-Host "Added $installDir to PATH" -ForegroundColor Green
}

Write-Host ""
Write-Host "Installation successful!" -ForegroundColor Green
Write-Host ""
Write-Host "Quick Start:" -ForegroundColor Cyan
Write-Host "  rhizos-node --orchestrator http://ORCHESTRATOR_IP:8080" -ForegroundColor White
Write-Host ""
Write-Host "Show hardware info:" -ForegroundColor Cyan
Write-Host "  rhizos-node info" -ForegroundColor White
Write-Host ""
Write-Host "NOTE: Restart your terminal for PATH changes to take effect." -ForegroundColor Yellow
