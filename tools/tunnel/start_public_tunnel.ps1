$ErrorActionPreference = "Continue"
$tunnelDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$p05Dir = Split-Path -Parent (Split-Path -Parent $tunnelDir)
Set-Location $p05Dir

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "    Starting Cloudflare Public Tunnel for GraphRAG      " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[1/3] Checking if frontend is accessible on port 8443..." -ForegroundColor Yellow

$connected = $false
try {
    $res = Invoke-WebRequest -Uri "http://localhost:8443" -Method Head -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($res.StatusCode -eq 200) { $connected = $true }
} catch {}

if ($connected) {
    Write-Host "[OK] Frontend is active on http://localhost:8443" -ForegroundColor Green
} else {
    Write-Host "[*] Frontend is initializing..." -ForegroundColor Gray
}

Write-Host "[2/3] Establishing secure tunnel to Cloudflare Edge..." -ForegroundColor Yellow

# Kill any prior cloudflared process
Get-Process -Name "*cloudflared*" -ErrorAction SilentlyContinue | Stop-Process -Force

$exePath = Join-Path $tunnelDir "cloudflared.exe"
$proc = Start-Process -FilePath $exePath -ArgumentList "tunnel", "--url", "http://localhost:8443", "--metrics", "127.0.0.1:20241" -NoNewWindow -PassThru

$tunnelUrl = ""
$timeout = 20
$elapsed = 0

while ($elapsed -lt $timeout) {
    Start-Sleep -Seconds 1
    $elapsed++
    
    # 1. Try metrics endpoint (fastest & zero file locks)
    try {
        $metrics = (curl.exe -s http://127.0.0.1:20241/metrics) -join "`n"
        if ($metrics -match 'userHostname="(https://[^"]+)"') {
            $tunnelUrl = $matches[1]
            break
        }
    } catch {}
}

if ($tunnelUrl) {
    # Copy to clipboard
    try { Set-Clipboard -Value $tunnelUrl } catch {}

    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "       🌍 GRAPHRAG PUBLIC INTERNET LINK IS LIVE!                 " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  URL: $tunnelUrl" -ForegroundColor Yellow -BackgroundColor Black
    Write-Host ""
    Write-Host "  [✔] Copied link to your clipboard automatically!" -ForegroundColor Cyan
    Write-Host "  [✔] Launching in your default browser..." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Share this URL with anyone on mobile, tablet, or external PC." -ForegroundColor White
    Write-Host "  Keep this terminal open to keep the link active." -ForegroundColor Gray
    Write-Host "  Press Ctrl+C to close the tunnel." -ForegroundColor Gray
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host ""

    # Open in default browser
    Start-Process $tunnelUrl

    # Keep script waiting for user
    try {
        Wait-Process -Id $proc.Id
    } catch {
        # Closed
    }
} else {
    Write-Host "[!] Connected to Cloudflare! Check tunnel status above." -ForegroundColor Yellow
}
