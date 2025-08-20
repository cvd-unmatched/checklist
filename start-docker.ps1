# Quick start script for Docker
Write-Host "🚀 Starting Checklist App with Docker..." -ForegroundColor Green

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Host "❌ .env file not found. Please create one based on env.example" -ForegroundColor Red
    exit 1
}

# Pull latest image and start
Write-Host "📥 Pulling latest image..." -ForegroundColor Yellow
docker-compose pull

Write-Host "🚀 Starting app..." -ForegroundColor Yellow
docker-compose up -d

Write-Host "✅ App started! Access at: http://localhost:8080" -ForegroundColor Green
Write-Host "📊 View logs: docker-compose logs -f" -ForegroundColor Cyan
Write-Host "🛑 Stop app: docker-compose down" -ForegroundColor Cyan
