Write-Host ""
Write-Host "=== Website Health Report - Deploy ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check wrangler is logged in
$null = npx wrangler whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Not logged in to Cloudflare." -ForegroundColor Red
    Write-Host "Run:  npx wrangler login"
    exit 1
}
Write-Host "Logged in to Cloudflare" -ForegroundColor Green
Write-Host ""

# 2. Get or create D1 database
Write-Host "Looking up D1 database..." -ForegroundColor Yellow
$dbId = ""

# Try listing first (handles already-exists case)
$listOutput = (npx wrangler d1 list 2>&1) -join "`n"
foreach ($line in $listOutput.Split("`n")) {
    if ($line.Contains("webhealthreport")) {
        foreach ($token in $line.Split([char]32)) {
            $token = $token.Trim()
            if ($token.Length -eq 36 -and ($token -split "-").Length -eq 5) {
                $dbId = $token; break
            }
        }
    }
    if ($dbId) { break }
}

# If not found in list, create it
if (-not $dbId) {
    Write-Host "  Creating new database..." -ForegroundColor Yellow
    $dbOutput = (npx wrangler d1 create webhealthreport 2>&1) -join "`n"
    foreach ($line in $dbOutput.Split("`n")) {
        if ($line.Contains("database_id")) {
            $parts = $line.Split([char]34)
            if ($parts.Length -ge 2) { $dbId = $parts[1]; break }
        }
    }
}

if (-not $dbId) {
    Write-Host "ERROR: Could not find database ID." -ForegroundColor Red
    Write-Host "Run: npx wrangler d1 create webhealthreport"
    Write-Host "Copy the database_id value into wrangler.toml and re-run."
    exit 1
}

Write-Host "Database ID: $dbId" -ForegroundColor Green
Write-Host ""

# 3. Patch wrangler.toml
$wranglerPath = Join-Path $PSScriptRoot "wrangler.toml"
$wranglerContent = Get-Content $wranglerPath -Raw
if ($wranglerContent.Contains("DATABASE_ID_PLACEHOLDER")) {
    $wranglerContent = $wranglerContent.Replace("DATABASE_ID_PLACEHOLDER", $dbId)
    Set-Content -Path $wranglerPath -Value $wranglerContent -NoNewline
    Write-Host "Updated wrangler.toml" -ForegroundColor Green
} else {
    Write-Host "wrangler.toml already configured"
}
Write-Host ""

# 4. Apply schema (CREATE TABLE IF NOT EXISTS — always safe to re-run)
Write-Host "Applying schema..." -ForegroundColor Yellow
npx wrangler d1 execute webhealthreport --file=schema.sql --remote
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Schema failed" -ForegroundColor Red; exit 1 }
Write-Host "Schema applied" -ForegroundColor Green
Write-Host ""

# 4b. Apply column migrations (ALTER TABLE ADD COLUMN — skip silently if column already exists)
Write-Host "Applying column migrations..." -ForegroundColor Yellow
$migrations = @(
    "ALTER TABLE crawl_queue ADD COLUMN anchor_text TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE crawl_queue ADD COLUMN claimed_at INTEGER",
    "ALTER TABLE link_checks ADD COLUMN anchor_text TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE monitored_sites ADD COLUMN last_scan_status TEXT",
    "ALTER TABLE monitored_sites ADD COLUMN last_scan_error TEXT"
)
foreach ($m in $migrations) {
    $tmp = New-TemporaryFile
    try {
        Set-Content -Path $tmp.FullName -Value $m -Encoding UTF8
        $null = npx wrangler d1 execute webhealthreport --file=$($tmp.FullName) --remote 2>&1
    } catch { <# duplicate column — already applied #> }
    finally { Remove-Item $tmp.FullName -ErrorAction SilentlyContinue }
}
Write-Host "Column migrations done" -ForegroundColor Green
Write-Host ""

# 5. Build
Write-Host "Building..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Build failed" -ForegroundColor Red; exit 1 }
Write-Host "Build complete" -ForegroundColor Green
Write-Host ""

# 6. Deploy
Write-Host "Deploying to Cloudflare Pages..." -ForegroundColor Yellow
npx wrangler pages deploy dist --project-name=webhealthreport --branch=production
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Deploy failed" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host "Live at: https://webhealthreport.pages.dev"
Write-Host ""
