# Run from D:\Projects\teraye in PowerShell after extracting teraye-fixes.zip into the repo root
$ErrorActionPreference = "Stop"

# 1. Patch AuthScreen.tsx login endpoint in-place (preserves Amharic UTF-8 text)
$authScreen = "frontend/src/components/AuthScreen.tsx"
if (Test-Path $authScreen) {
    $content = Get-Content $authScreen -Raw -Encoding UTF8
    $updated = $content.Replace("'/auth/mobile/login'", "'/auth/login'")
    Set-Content $authScreen -Value $updated -Encoding UTF8 -NoNewline
    Write-Host "Patched $authScreen"
}

# 2. Patch 002_seed.sql phone number typo in-place (preserves Amharic UTF-8 text)
$seedSql = "backend/sql/002_seed.sql"
if (Test-Path $seedSql) {
    $content = Get-Content $seedSql -Raw -Encoding UTF8
    $updated = $content.Replace("'+2519121319216'", "'+251921319216'")
    Set-Content $seedSql -Value $updated -Encoding UTF8 -NoNewline
    Write-Host "Patched $seedSql"
}

# 3. Untrack backend/.env if tracked
git rm --cached --ignore-unmatch backend/.env

# 4. Rebuild React frontend into backend/public
Push-Location frontend
npm run build
Pop-Location

Write-Host "`nDone! Review changes with 'git status' and then commit & push."
