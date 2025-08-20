# Checklist App

A professional, minimalistic, dark-mode checklist app for trips with password protection and MySQL database integration.

## 🚀 Quick Start with Docker

### Option 1: Pull from GitHub Container Registry (Recommended)

```bash
# Create .env file from example
cp env.example .env
# Edit .env with your database credentials and password

# Start with Docker Compose
docker-compose up -d

# Or use the quick start script (Windows)
.\start-docker.ps1
```

### Option 2: Build Locally

```bash
# Build the image
docker build -t checklist .

# Run the container
docker run -p 8080:8080 --env-file .env checklist
```

## 📦 Docker Image

The app is automatically built and published to GitHub Container Registry:

```bash
# Pull latest version
docker pull ghcr.io/cvd-unmatched/checklist:latest

# Pull specific version
docker pull ghcr.io/cvd-unmatched/checklist:v1.0.0
```

## 🔧 Configuration

Create a `.env` file with your settings:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=checklist

# App Security
APP_PASSWORD=your_strong_password
JWT_SECRET=your_jwt_secret

# Logging
LOGGING=OFF

# Optional: Port
PORT=8080
```

## 🌐 Access

- **URL**: http://localhost:8080
- **Login**: Use the password from `APP_PASSWORD` in your `.env` file

## ✨ Features

- 🔐 Password-protected access
- 📋 Create, edit, and copy trip lists
- 📅 Date range support for trips
- ✅ Check/uncheck items (persistent)
- 🔢 Automatic quantity calculation for clothing items
- 📱 Mobile-first responsive design
- 🌙 Professional dark mode UI
- 🗄️ MySQL database integration
- 📊 Real-time database connection status
- 📝 Conditional logging system

## 🏗️ Architecture

- **Backend**: Node.js + Express + TypeScript
- **Database**: MySQL with automatic table creation
- **Frontend**: Single-page app with inline HTML/CSS/JS
- **Authentication**: JWT-based with configurable password
- **Containerization**: Docker with health checks

## 🔄 CI/CD

The app automatically builds and publishes Docker images on:

- **Push to main/master**: Latest version
- **Tags (v*.*.*)**: Versioned releases
- **Pull requests**: Build testing

## 📱 Mobile Support

- Responsive design for phones, tablets, and desktops
- Touch-friendly checkboxes and buttons
- Optimized layouts for small screens

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Start production build
npm start
```

## 🐳 Docker Commands

```bash
# View running containers
docker ps

# View logs
docker-compose logs -f

# Stop app
docker-compose down

# Restart app
docker-compose restart

# Update to latest version
docker-compose pull && docker-compose up -d
```

## 🔍 Health Check

The container includes a health check that monitors the `/api/status` endpoint:

```bash
# Check container health
docker inspect checklist-app | grep Health -A 10
```

## 📄 License

This project is private and intended for personal use.
