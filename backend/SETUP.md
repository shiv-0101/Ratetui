# Setup Guide

## Quick Start

### 1. Prerequisites

Ensure you have the following installed:

- **Node.js:** 18+ (LTS recommended)
- **npm:** 9+ (comes with Node.js)
- **Docker:** 20+ (for Redis)
- **Docker Compose:** 2.0+
- **Git:** For version control

**Verify installations:**
```bash
node --version    # Should be v18.x or higher
npm --version     # Should be 9.x or higher
docker --version  # Should be 20.x or higher
git --version
```

---

### 2. Clone Repository

```bash
git clone https://github.com/shiv-0101/Ratetui.git
cd Ratetui
```

---

### 3. Backend Setup

#### Install Dependencies

```bash
cd backend
npm install
```

This installs all required packages:
- `express` - Web framework
- `ioredis` - Redis client
- `rate-limiter-flexible` - Rate limiting
- `helmet` - Security headers
- `cors` - CORS middleware
- `winston` - Logging
- `morgan` - HTTP request logging
- `jsonwebtoken` - JWT authentication (Week 2)
- `bcryptjs` - Password hashing (Week 2)
- And development dependencies (Jest, ESLint, Supertest)

#### Configure Environment

```bash
cp .env.example .env
```

**Edit `.env` file:**

**Required Settings:**
```env
NODE_ENV=development
PORT=3000

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_FAILURE_MODE=open

# JWT (generate a secure secret)
JWT_SECRET=your-64-character-random-string-here
```

**Generate JWT Secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Optional Settings:**
- `LOG_LEVEL` - debug, info, warn, error (default: debug)
- `CORS_ORIGINS` - Comma-separated allowed origins
- `TRUST_PROXY` - loopback, linklocal, uniquelocal, or IP addresses
- `DEFAULT_RATE_LIMIT` - Default requests per window (default: 100)
- `DEFAULT_RATE_WINDOW` - Window in seconds (default: 60)

---

### 4. Redis Setup

#### Option A: Docker (Recommended)

**Start Redis:**
```bash
# From project root
docker compose up redis -d
```

**Verify Redis is running:**
```bash
docker ps
docker exec -it ratetui-redis redis-cli ping
# Should return: PONG
```

**Stop Redis:**
```bash
docker compose down
```

#### Option B: Local Redis

If you have Redis installed locally:
```bash
# Linux/Mac
redis-server

# Windows (with Redis installed via WSL or native)
redis-server.exe
```

**Update `.env`:**
```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

### 5. Run Backend

#### Development Mode (with auto-reload)

```bash
npm run dev
```

Server starts on `http://localhost:3000`

#### Production Mode

```bash
npm start
```

---

### 6. Verify Installation

#### Test Health Endpoint

```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-25T12:00:00.000Z",
  "uptime": 5,
  "version": "1.0.0"
}
```

#### Test API Endpoint

```bash
curl http://localhost:3000/api/data
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "message": "General API endpoint - 200 req/min",
    "timestamp": "2026-01-25T12:00:00.000Z",
    "rateLimit": {
      "limit": 200,
      "window": "1 minute"
    }
  }
}
```

#### Check Rate Limit Headers

```bash
curl -I http://localhost:3000/api/data
```

**Expected headers:**
```
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 199
X-RateLimit-Reset: 1706184060
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

---

### 7. Run Tests

#### Unit Tests

```bash
npm test
```

**Expected output:**
```
Test Suites: 6 passed, 6 total
Tests:       120+ passed, 120+ total
```

#### Integration Tests

```bash
# Make sure server is running first
npm run dev

# In another terminal
npm run test:integration
```

---

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

---

## Next Steps

1. ✅ Verify all health checks pass
2. ✅ Run unit tests
3. ✅ Test rate limiting behavior
4. ⏳ Continue with Week 2: Authentication System
5. ⏳ Continue with Week 3: Admin Dashboard UI

---

## Development Workflow

### Making Changes

1. Create a feature branch
2. Make your changes
3. Run tests: `npm test`
4. Run linter: `npm run lint`
5. Commit with meaningful messages
6. Push and create PR

### Before Committing

```bash
# Run tests
npm test

# Fix linting issues
npm run lint:fix

# Verify server starts
npm run dev
```

---

## Production Deployment

**Coming in Week 5**

Will include:
- Docker deployment
- Kubernetes manifests
- CI/CD pipelines
- Monitoring setup
- Production environment variables

---

## Support

For issues or questions:
- Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Review [API Documentation](API.md)
- Create an issue on GitHub
