# API Documentation

## Table of Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Health Check Endpoints](#health-check-endpoints)
- [API Endpoints](#api-endpoints)
- [Error Responses](#error-responses)
- [Rate Limit Presets](#rate-limit-presets)

---

## Base URL

**Development:** `http://localhost:3000`  
**Production:** `https://api.ratetui.com` (TBD)

---

## Authentication

Currently, all API endpoints are public. JWT authentication will be added in Week 2.

**Headers (Coming in Week 2):**
```
Authorization: Bearer <token>
```

---

## Rate Limiting

All API endpoints (except `/health`) are rate limited. Rate limit information is returned in response headers:

**Headers:**
- `X-RateLimit-Limit` - Maximum requests allowed in the window
- `X-RateLimit-Remaining` - Requests remaining in current window
- `X-RateLimit-Reset` - Unix timestamp when the window resets
- `X-RateLimit-RetryAfter` - Seconds to wait before retrying (only when limit exceeded)
- `X-Request-ID` - Unique request identifier for tracking

**429 Response (Rate Limit Exceeded):**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later",
    "statusCode": 429
  }
}
```

---

## Health Check Endpoints

### GET /health

Basic health check for quick status verification.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-25T12:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

**Rate Limit:** None

---

### GET /health/detailed

Detailed health information including Redis status and system metrics.

**Response (200 OK - Healthy):**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-25T12:00:00.000Z",
  "uptime": 3600,
  "components": {
    "redis": {
      "status": "healthy",
      "connected": true,
      "latency": "2ms",
      "failureMode": "open"
    }
  },
  "memory": {
    "heapUsed": "45.2 MB",
    "heapTotal": "67.8 MB",
    "rss": "89.5 MB",
    "external": "1.2 MB"
  },
  "process": {
    "pid": 12345,
    "nodeVersion": "v20.10.0",
    "platform": "linux"
  }
}
```

**Response (503 Service Unavailable - Degraded):**
```json
{
  "status": "degraded",
  "timestamp": "2026-01-25T12:00:00.000Z",
  "uptime": 3600,
  "components": {
    "redis": {
      "status": "unhealthy",
      "connected": false,
      "error": "Connection refused",
      "failureMode": "open"
    }
  },
  "memory": { ... },
  "process": { ... }
}
```

**Rate Limit:** None

---

### GET /health/live

Kubernetes liveness probe. Always returns 200 unless the process is dead.

**Response (200 OK):**
```json
{
  "status": "alive"
}
```

**Rate Limit:** None

---

### GET /health/ready

Kubernetes readiness probe. Returns 503 if Redis is disconnected.

**Response (200 OK):**
```json
{
  "status": "ready"
}
```

**Response (503 Service Unavailable):**
```json
{
  "status": "not ready",
  "reason": "Redis is not connected"
}
```

**Rate Limit:** None

---

## API Endpoints

### GET /api/data

General purpose data endpoint.

**Rate Limit:** 200 requests per minute

**Response (200 OK):**
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

---

### GET /api/search

Search endpoint with query parameter.

**Rate Limit:** 30 requests per minute

**Query Parameters:**
- `q` (optional) - Search query string

**Example Request:**
```bash
curl "http://localhost:3000/api/search?q=rate+limiter"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Search endpoint with 30 req/min limit",
    "query": "rate limiter",
    "results": [
      {
        "id": 1,
        "title": "Sample result 1"
      },
      {
        "id": 2,
        "title": "Sample result 2"
      }
    ],
    "timestamp": "2026-01-25T12:00:00.000Z"
  }
}
```

---

### GET /api/expensive

Resource-intensive operation with strict rate limiting.

**Rate Limit:** 10 requests per minute

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Expensive operation with stricter limit (10 req/min)",
    "timestamp": "2026-01-25T12:00:00.000Z",
    "computationTime": "532ms"
  }
}
```

---

### POST /api/upload

File upload simulation endpoint.

**Rate Limit:** 5 requests per hour

**Request Body:**
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Upload successful (5 req/hour limit)",
    "timestamp": "2026-01-25T12:00:00.000Z",
    "fileId": "file_1706184000000"
  }
}
```

---

### GET /api/status

Shows current rate limiter status and available presets.

**Rate Limit:** 200 requests per minute

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Rate limiter is active",
    "timestamp": "2026-01-25T12:00:00.000Z",
    "clientInfo": {
      "ip": "127.0.0.1"
    },
    "rateLimit": {
      "limit": 200,
      "remaining": 198,
      "reset": 1706184060,
      "resetInSeconds": 42
    },
    "availablePresets": {
      "api": {
        "points": 200,
        "duration": 60,
        "description": "General API endpoints"
      },
      "auth": {
        "points": 10,
        "duration": 60,
        "description": "Authentication endpoints"
      },
      "login": {
        "points": 5,
        "duration": 900,
        "description": "Login attempts with IP blocking"
      },
      "admin": {
        "points": 50,
        "duration": 60,
        "description": "Admin operations (user-based)"
      },
      "search": {
        "points": 30,
        "duration": 60,
        "description": "Search functionality"
      },
      "expensive": {
        "points": 10,
        "duration": 60,
        "description": "Resource-intensive operations"
      },
      "upload": {
        "points": 5,
        "duration": 3600,
        "description": "File uploads"
      },
      "passwordReset": {
        "points": 3,
        "duration": 3600,
        "description": "Password reset with blocking"
      },
      "email": {
        "points": 10,
        "duration": 3600,
        "description": "Email sending"
      },
      "apiKey": {
        "points": 1000,
        "duration": 3600,
        "description": "API key based access"
      }
    }
  }
}
```

---

## Error Responses

All errors follow a consistent structure:

### 400 Bad Request
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "statusCode": 400,
    "details": {
      "field": "email",
      "reason": "Invalid format"
    }
  }
}
```

### 401 Unauthorized
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "statusCode": 401
  }
}
```

### 403 Forbidden
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied",
    "statusCode": 403
  }
}
```

### 404 Not Found
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "statusCode": 404
  }
}
```

### 429 Too Many Requests
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later",
    "statusCode": 429
  }
}
```

### 500 Internal Server Error
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred",
    "statusCode": 500
  }
}
```

**Note:** In production, 500 errors are sanitized and don't include stack traces or internal details.

### 503 Service Unavailable
```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Service temporarily unavailable",
    "statusCode": 503
  }
}
```

---

## Rate Limit Presets

Pre-configured rate limiters for common use cases:

| Preset | Limit | Window | Use Case |
|--------|-------|--------|----------|
| `api` | 200 req | 1 min | General API endpoints |
| `auth` | 10 req | 1 min | Authentication endpoints |
| `login` | 5 req | 15 min | Login attempts (with IP blocking) |
| `admin` | 50 req | 1 min | Admin operations (user-based) |
| `search` | 30 req | 1 min | Search functionality |
| `expensive` | 10 req | 1 min | Resource-intensive operations |
| `upload` | 5 req | 1 hour | File uploads |
| `passwordReset` | 3 req | 1 hour | Password reset (with blocking) |
| `email` | 10 req | 1 hour | Email sending |
| `apiKey` | 1000 req | 1 hour | API key based access |

**Usage in Code:**
```javascript
const { rateLimiters } = require('./middleware/rateLimiter');

// Apply preset to route
router.get('/search', rateLimiters.search, (req, res) => {
  res.json({ results: [] });
});
```

**Custom Rate Limiter:**
```javascript
const { createRateLimiter } = require('./middleware/rateLimiter');

const customLimiter = createRateLimiter({
  points: 50,        // 50 requests
  duration: 3600,    // per hour
  blockDuration: 0,  // no blocking
});

router.get('/custom', customLimiter, handler);
```

---

## Request & Response Examples

### Successful Request

**Request:**
```bash
curl -X GET http://localhost:3000/api/data \
  -H "Content-Type: application/json"
```

**Response Headers:**
```
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 199
X-RateLimit-Reset: 1706184060
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

**Response Body:**
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

---

### Rate Limit Exceeded

**Request:**
```bash
# After making 200 requests in 1 minute
curl -X GET http://localhost:3000/api/data
```

**Response Headers:**
```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1706184060
X-RateLimit-RetryAfter: 42
```

**Response Body:**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later",
    "statusCode": 429
  }
}
```

---

## Testing with cURL

### Basic Tests

```bash
# Health check
curl http://localhost:3000/health

# Detailed health
curl http://localhost:3000/health/detailed | jq

# API data
curl http://localhost:3000/api/data | jq

# Search with query
curl "http://localhost:3000/api/search?q=test" | jq

# Upload
curl -X POST http://localhost:3000/api/upload \
  -H "Content-Type: application/json" \
  -d '{}' | jq

# Status
curl http://localhost:3000/api/status | jq
```

### Rate Limit Testing

```bash
# Test expensive endpoint (10 req/min limit)
for i in {1..12}; do
  echo "Request $i:"
  curl -s -w "\nStatus: %{http_code}\n\n" http://localhost:3000/api/expensive
  sleep 1
done

# Check rate limit headers
curl -I http://localhost:3000/api/data | grep RateLimit
```

### Error Testing

```bash
# 404 Not Found
curl http://localhost:3000/api/nonexistent

# 400 Bad Request (malformed JSON)
curl -X POST http://localhost:3000/api/upload \
  -H "Content-Type: application/json" \
  -d 'invalid json'
```

---

## Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `IP_BLOCKED` | 403 | IP address blocked |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Access denied |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily down |
| `BAD_REQUEST` | 400 | Malformed request |
| `INVALID_TOKEN` | 401 | Invalid JWT token |

---

## Client Integration Examples

### JavaScript (Fetch)

```javascript
async function fetchData() {
  try {
    const response = await fetch('http://localhost:3000/api/data');
    
    // Check rate limit headers
    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('X-RateLimit-RetryAfter');
      console.log(`Rate limited. Retry after ${retryAfter} seconds`);
      return;
    }
    
    const data = await response.json();
    console.log(data);
    
  } catch (error) {
    console.error('Request failed:', error);
  }
}
```

### Python (Requests)

```python
import requests
import time

def fetch_data():
    try:
        response = requests.get('http://localhost:3000/api/data')
        
        # Check rate limit
        limit = response.headers.get('X-RateLimit-Limit')
        remaining = response.headers.get('X-RateLimit-Remaining')
        
        if response.status_code == 429:
            retry_after = int(response.headers.get('X-RateLimit-RetryAfter', 60))
            print(f'Rate limited. Waiting {retry_after} seconds...')
            time.sleep(retry_after)
            return fetch_data()
        
        response.raise_for_status()
        return response.json()
        
    except requests.exceptions.RequestException as e:
        print(f'Request failed: {e}')
        return None
```

### Node.js (Axios)

```javascript
const axios = require('axios');

async function fetchData() {
  try {
    const response = await axios.get('http://localhost:3000/api/data');
    
    // Check rate limit
    const limit = response.headers['x-ratelimit-limit'];
    const remaining = response.headers['x-ratelimit-remaining'];
    
    console.log(`Rate limit: ${remaining}/${limit} remaining`);
    return response.data;
    
  } catch (error) {
    if (error.response && error.response.status === 429) {
      const retryAfter = error.response.headers['x-ratelimit-retryafter'];
      console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    } else {
      console.error('Request failed:', error.message);
    }
  }
}
```

---

## Webhooks & Callbacks

*Coming in Week 4*

---

## Changelog

### Version 1.0.0 (Week 1) - January 2026

**Added:**
- Basic rate limiting with Redis backend
- Health check endpoints
- Sample API endpoints
- Error handling middleware
- Request logging with UUID tracking
- IP validation and extraction
- 10 rate limiter presets
- Graceful degradation (open/closed failure modes)

**Security:**
- Helmet.js security headers
- CORS configuration
- Request size limits
- IP masking in production logs
- Error sanitization

---

## Support

- **Setup Issues:** See [SETUP.md](SETUP.md)
- **Common Problems:** See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **GitHub Issues:** https://github.com/shiv-0101/Ratetui/issues
