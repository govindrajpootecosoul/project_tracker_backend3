# Script to regenerate Prisma client
# This script will help regenerate Prisma after schema changes

Write-Host "Regenerating Prisma Client..." -ForegroundColor Yellow

# Try to remove the .prisma folder if it exists
if (Test-Path "node_modules\.prisma") {
    Write-Host "Removing old Prisma client files..." -ForegroundColor Yellow
    try {
        Remove-Item -Recurse -Force "node_modules\.prisma" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    } catch {
        Write-Host "Could not remove .prisma folder. Please close all Node processes and try again." -ForegroundColor Red
        exit 1
    }
}

# Generate Prisma client
Write-Host "Running: npx prisma generate" -ForegroundColor Cyan
npx prisma generate

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nPrisma client regenerated successfully!" -ForegroundColor Green
    Write-Host "Please restart your backend server now." -ForegroundColor Yellow
} else {
    Write-Host "`nFailed to regenerate Prisma client." -ForegroundColor Red
    Write-Host "Please make sure:" -ForegroundColor Yellow
    Write-Host "1. All Node processes are stopped (especially the backend server)" -ForegroundColor Yellow
    Write-Host "2. VS Code/Cursor is closed or Prisma extension is disabled" -ForegroundColor Yellow
    Write-Host "3. Try running this script again" -ForegroundColor Yellow
}

