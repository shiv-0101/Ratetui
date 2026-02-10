# Rate Limit Headers Documentation

## Overview
This document describes the rate limit headers returned by the API to help clients understand their current usage and limits.

## Standard Headers

### X-RateLimit-Limit
The maximum number of requests allowed in the current time window.

**Example:**
```
X-RateLimit-Limit: 100
```

### X-RateLimit-Remaining
The number of requests remaining in the current time window.

**Example:**
```
X-RateLimit-Remaining: 95
```

### X-RateLimit-Reset
Unix timestamp (in seconds) when the rate limit window resets.

**Example:**
```
X-RateLimit-Reset: 1705420800
```

### X-RateLimit-Policy
A string describing the rate limit policy in the format: `{requests};w={window_seconds}`.

**Example:**
```
X-RateLimit-Policy: "100;w=60"
```
This indicates 100 requests per 60 seconds (1 minute).

## 429 Response Headers

When rate limit is exceeded, the following additional header is included:

### Retry-After
Number of seconds to wait before making another request.

**Example:**
```
Retry-After: 45
```

## Complete Response Example

### Successful Request (200)
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705420800
X-RateLimit-Policy: "100;w=60"

{
  "data": "..."
}
```

### Rate Limited Request (429)
```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 45
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705420800

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please retry after 45 seconds.",
    "retryAfter": 45,
    "limit": 100,
    "window": "1m"
  }
}
```

## Client Implementation Guidelines

1. **Always check headers**: Parse rate limit headers on every response
2. **Implement backoff**: Use `Retry-After` header value for exponential backoff
3. **Monitor remaining**: Alert when `X-RateLimit-Remaining` is low
4. **Cache reset time**: Use `X-RateLimit-Reset` to plan request scheduling

## References
- [RFC 6585 - HTTP 429 Status Code](https://tools.ietf.org/html/rfc6585)
- [IETF Rate Limit Headers Draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
