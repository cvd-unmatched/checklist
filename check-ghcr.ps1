# Check GHCR images for the checklist repository
Write-Host "Checking available images in GHCR..." -ForegroundColor Green

# Try to list available tags
Write-Host "`nAttempting to list available tags..." -ForegroundColor Yellow
try {
    docker manifest inspect ghcr.io/cvd-unmatched/checklist:latest
    Write-Host "`n✅ Image ghcr.io/cvd-unmatched/checklist:latest exists!" -ForegroundColor Green
} catch {
    Write-Host "`n❌ Image ghcr.io/cvd-unmatched/checklist:latest not found" -ForegroundColor Red
    Write-Host "This suggests the image was never pushed to GHCR" -ForegroundColor Yellow
}

Write-Host "`nTrying to pull the image..." -ForegroundColor Yellow
try {
    docker pull ghcr.io/cvd-unmatched/checklist:latest
    Write-Host "`n✅ Successfully pulled the image!" -ForegroundColor Green
} catch {
    Write-Host "`n❌ Failed to pull the image" -ForegroundColor Red
}

Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Commit and push the updated workflow file" -ForegroundColor White
Write-Host "2. Check GitHub Actions to ensure the build completes and pushes" -ForegroundColor White
Write-Host "3. Try pulling again after the workflow succeeds" -ForegroundColor White
