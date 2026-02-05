# Ratetui - Rate Limiter System

A robust, secure API rate limiting system built with Node.js, Express, and Redis.

## 🎯 Overview

Ratetui protects your APIs from abuse and ensures fair resource allocation by implementing configurable rate limiting based on:
- IP Address
- User Identity
- API Endpoint
- Custom Keys

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (LTS recommended)
- Docker & Docker Compose (for Redis)
- Git

**For detailed setup instructions, see [backend/SETUP.md](backend/SETUP.md)**

### Development Setup

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/shiv-0101/Ratetui.git
   cd Ratetui/backend
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration (see SETUP.md for details)
   ```

3. **Start Redis with Docker:**
   ```bash
   cd ..
   docker compose up redis -d
   ```

4. **Run the backend:**
   ```bash
   cd backend
   npm run dev
   ```

5. **Test the rate limiter:**
   ```bash
   # Check health
   curl http://localhost:3000/health

   # Test rate limiting (run multiple times)
   curl http://localhost:3000/api/data
   
   # View rate limit status
   curl http://localhost:3000/api/status
   ```

### Docker Setup (Full Stack)

```bash
docker compose up -d
```

**Documentation:**
- **Setup Guide:** [backend/SETUP.md](backend/SETUP.md) - Detailed installation instructions
- **API Docs:** [backend/API.md](backend/API.md) - Complete API reference
- **Troubleshooting:** [backend/TROUBLESHOOTING.md](backend/TROUBLESHOOTING.md) - Common issues and solutions

## 📁 Project Structure

```
Ratetui/
├── docs/
│   └── PRD.md              # Product Requirements Document
├── backend/
│   ├── src/
│   │   ├── config/         # Configuration (Redis, CORS)
│   │   ├── middleware/     # Express middleware (rate limiter, error handler)
│   │   ├── routes/         # API routes
│   │   └── utils/          # Utilities (logger)
│   ├── Dockerfile
│   └── package.json
├── frontend/               # Coming in Week 3
├── docker-compose.yml
└── README.md
```

## 🔧 Configuration

**For complete environment variable documentation, see [backend/.env.example](backend/.env.example)**

Key environment variables:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | development | Yes |
| `PORT` | Server port | 3000 | Yes |
| `REDIS_HOST` | Redis host | localhost | Yes |
| `REDIS_PORT` | Redis port | 6379 | Yes |
| `REDIS_FAILURE_MODE` | open or closed | open | Yes |
| `JWT_SECRET` | JWT signing key | - | Yes (Week 2) |
| `DEFAULT_RATE_LIMIT` | Requests per window | 100 | No |
| `DEFAULT_RATE_WINDOW` | Window in seconds | 60 | No |
| `CORS_ORIGINS` | Allowed origins | - | No |
| `TRUST_PROXY` | Proxy configuration | loopback | No |

**Security Note:** Always change `JWT_SECRET` in production!

See [backend/SETUP.md](backend/SETUP.md) for detailed configuration guide.

## 📊 API Endpoints

**For complete API documentation, see [backend/API.md](backend/API.md)**

### Health Checks

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/health` | Basic health check | None |
| GET | `/health/detailed` | Full system status with Redis metrics | None |
| GET | `/health/live` | Kubernetes liveness probe | None |
| GET | `/health/ready` | Kubernetes readiness probe | None |

### Public API

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/data` | General data endpoint | 200/min |
| GET | `/api/search` | Search with query param | 30/min |
| GET | `/api/expensive` | Resource-intensive operation | 10/min |
| POST | `/api/upload` | File upload simulation | 5/hour |
| GET | `/api/status` | Rate limiter status & presets | 200/min |

### Response Headers

All rate-limited responses include:
```
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 199
X-RateLimit-Reset: 1706184060
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

### Rate Limited Response (429)

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later",
    "statusCode": 429
  }
}
```

**Headers include:**
```
X-RateLimit-RetryAfter: 45
```

---

## 🧪 Testing

### Run Unit Tests
```bash
cd backend
npm test
```

### Run Integration Tests
```bash
# Start server first
npm run dev

# In another terminal
npm run test:integration
```

### Manual Testing
See [backend/API.md](backend/API.md) for cURL examples and client integration code.

---

## 📚 Documentation

- **[Setup Guide](backend/SETUP.md)** - Detailed installation and configuration
- **[API Reference](backend/API.md)** - Complete API documentation with examples
- **[Troubleshooting](backend/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Development Roadmap](ROADMAP.md)** - Project phases and tasks
- **[PRD](docs/PRD.md)** - Product requirements
- **[TRD](docs/TRD.md)** - Technical requirements
- CORS protection
- Input validation
- Rate limiting on all endpoints
- Graceful Redis failure handling
- Sanitized error messages
- Structured audit logging

## 📖 Documentation

- [Product Requirements Document](docs/PRD.md) - Detailed PRD with all requirements

## 🧪 Testing

```bash
cd backend
npm test
```

## 📄 License

MIT
