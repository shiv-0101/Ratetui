# Rate Limiter System - Product Requirements Document

**Version:** 1.0  
**Author:** Shiv  
**Date:** January 16, 2026  
**Status:** Draft  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [User Personas](#4-user-personas)
5. [Functional Requirements](#5-functional-requirements)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Security Requirements](#7-security-requirements)
8. [System Architecture](#8-system-architecture)
9. [API Specifications](#9-api-specifications)
10. [Data Models](#10-data-models)
11. [Rate Limiting Algorithms](#11-rate-limiting-algorithms)
12. [Admin Dashboard](#12-admin-dashboard)
13. [Error Handling](#13-error-handling)
14. [Monitoring & Observability](#14-monitoring--observability)
15. [Deployment Strategy](#15-deployment-strategy)
16. [Risk Assessment](#16-risk-assessment)
17. [Timeline & Milestones](#17-timeline--milestones)
18. [Appendix](#18-appendix)

---

## 1. Executive Summary

### 1.1 Overview

The Rate Limiter System is a backend infrastructure component designed to protect APIs from abuse, ensure fair resource allocation, and maintain system stability under high traffic conditions. It provides configurable rate limiting by user identity, IP address, and API endpoint with an administrative interface for real-time management.

### 1.2 Business Value

| Metric | Before | After (Target) |
|--------|--------|----------------|
| API Uptime | 95% | 99.9% |
| Server Crashes/Month | 5-10 | 0-1 |
| Abuse Incident Response | Hours | Seconds |
| Infrastructure Costs | Variable (scaling) | Predictable |

### 1.3 Tech Stack

| Layer | Technology | Justification |
|-------|------------|---------------|
| Backend Runtime | Node.js 20 LTS | Event-driven, high concurrency |
| Web Framework | Express.js 4.x | Mature, extensive middleware ecosystem |
| Rate Limiter | rate-limiter-flexible | Production-tested, multiple algorithms |
| Cache/Store | Redis 7.x (Docker) | Sub-millisecond latency, atomic operations |
| Frontend | React 18 | Component-based, efficient updates |
| Containerization | Docker & Docker Compose | Consistent environments |

---

## 2. Problem Statement

### 2.1 Current Challenges

1. **Uncontrolled Traffic**: APIs exposed without throttling allow single clients to consume disproportionate resources
2. **Service Degradation**: Abusive request patterns cause latency spikes affecting all users
3. **No Visibility**: No mechanism to identify or block bad actors in real-time
4. **Manual Intervention**: Abuse mitigation requires manual server restarts or IP blocking at firewall level

### 2.2 Impact Analysis

```
Scenario: Single client sends 10,000 requests/minute to /api/data endpoint

Impact Chain:
├── CPU utilization spikes to 95%+
├── Database connection pool exhausted
├── Response times increase from 50ms → 5000ms
├── Legitimate users experience timeouts
├── Business transactions fail
└── Revenue loss + reputation damage
```

### 2.3 Target Outcome

- Automated request throttling with configurable limits
- Instant blocking of abusive patterns
- Zero impact on legitimate users
- Real-time visibility and control

---

## 3. Goals & Success Metrics

### 3.1 Primary Goals

| Goal | Description | Priority |
|------|-------------|----------|
| G1 | Protect APIs from request flooding | P0 |
| G2 | Ensure fair resource distribution | P0 |
| G3 | Provide administrative control | P1 |
| G4 | Enable observability | P1 |
| G5 | Support horizontal scaling | P2 |

### 3.2 Success Metrics (KPIs)

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Request Processing Latency | < 5ms overhead | Prometheus histograms |
| False Positive Rate | < 0.01% | Blocked legitimate requests / Total |
| Abuse Detection Rate | > 99% | Blocked abusive requests / Total abusive |
| System Availability | 99.9% | Uptime monitoring |
| Admin Response Time | < 30 seconds | Time to apply new rule |

---

## 4. User Personas

### 4.1 Backend Engineer (Primary)

**Name:** Alex  
**Role:** API Developer  
**Goals:**
- Integrate rate limiting with minimal code changes
- Configure limits per endpoint
- Debug rate limiting issues

**Pain Points:**
- Complex configurations
- Inconsistent behavior across services
- Difficult debugging

### 4.2 Security Engineer

**Name:** Jordan  
**Role:** Security Analyst  
**Goals:**
- Block malicious IPs instantly
- View attack patterns
- Set up alerts for anomalies

**Pain Points:**
- Delayed response to threats
- Lack of visibility
- Manual processes

### 4.3 Platform Administrator

**Name:** Sam  
**Role:** DevOps/SRE  
**Goals:**
- Manage rate limits across services
- Monitor system health
- Scale infrastructure

**Pain Points:**
- Scattered configurations
- No central dashboard
- Alert fatigue

---

## 5. Functional Requirements

### 5.1 Core Rate Limiting

#### FR-001: Request Identification

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-001.1 | System SHALL identify requests by authenticated user ID | P0 |
| FR-001.2 | System SHALL identify requests by client IP address | P0 |
| FR-001.3 | System SHALL identify requests by API key (when provided) | P1 |
| FR-001.4 | System SHALL support composite keys (user + endpoint) | P1 |
| FR-001.5 | System SHALL handle IPv4 and IPv6 addresses | P0 |
| FR-001.6 | System SHALL extract real IP behind proxies (X-Forwarded-For) | P0 |

#### FR-002: Rate Limit Enforcement

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-002.1 | System SHALL enforce requests per minute limits | P0 |
| FR-002.2 | System SHALL enforce requests per hour limits | P1 |
| FR-002.3 | System SHALL enforce requests per day limits | P2 |
| FR-002.4 | System SHALL support burst allowance | P1 |
| FR-002.5 | System SHALL return HTTP 429 when limit exceeded | P0 |
| FR-002.6 | System SHALL include Retry-After header in 429 responses | P0 |
| FR-002.7 | System SHALL include rate limit headers (X-RateLimit-*) | P0 |

#### FR-003: Rule Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-003.1 | System SHALL support global rate limits | P0 |
| FR-003.2 | System SHALL support per-endpoint rate limits | P0 |
| FR-003.3 | System SHALL support per-user tier limits | P1 |
| FR-003.4 | System SHALL support IP whitelist (bypass) | P0 |
| FR-003.5 | System SHALL support IP blacklist (block all) | P0 |
| FR-003.6 | System SHALL allow rules with time-based activation | P2 |

### 5.2 Administration

#### FR-004: Admin Dashboard

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-004.1 | Dashboard SHALL display current rate limit configurations | P0 |
| FR-004.2 | Dashboard SHALL allow creating new rate limit rules | P0 |
| FR-004.3 | Dashboard SHALL allow editing existing rules | P0 |
| FR-004.4 | Dashboard SHALL allow deleting rules | P0 |
| FR-004.5 | Dashboard SHALL display real-time request metrics | P1 |
| FR-004.6 | Dashboard SHALL show blocked requests log | P1 |
| FR-004.7 | Dashboard SHALL support rule search and filtering | P2 |

#### FR-005: Manual Controls

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-005.1 | Admin SHALL be able to block specific IP immediately | P0 |
| FR-005.2 | Admin SHALL be able to block specific user immediately | P0 |
| FR-005.3 | Admin SHALL be able to reset rate limit counter for user/IP | P1 |
| FR-005.4 | Admin SHALL be able to whitelist IP/user | P0 |
| FR-005.5 | All admin actions SHALL be logged with timestamp and actor | P0 |

---

## 6. Non-Functional Requirements

### 6.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-001 | Rate limit check latency | < 5ms (p99) |
| NFR-002 | Throughput capacity | > 10,000 req/sec per instance |
| NFR-003 | Memory footprint | < 512MB per instance |
| NFR-004 | Redis operation latency | < 1ms (p99) |
| NFR-005 | Dashboard page load | < 2 seconds |

### 6.2 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-006 | System availability | 99.9% uptime |
| NFR-007 | Redis failure handling | Graceful degradation (allow-by-default or fail-closed configurable) |
| NFR-008 | Data consistency | Eventual consistency within 100ms |
| NFR-009 | Recovery time | < 30 seconds after Redis reconnection |

### 6.3 Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-010 | Horizontal scaling | Stateless backend, shared Redis |
| NFR-011 | Concurrent connections | > 5,000 per instance |
| NFR-012 | Rule storage capacity | > 10,000 rules |

### 6.4 Maintainability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-013 | Code coverage | > 80% |
| NFR-014 | Documentation | All public APIs documented |
| NFR-015 | Configuration | Environment-based, no hardcoding |

---

## 7. Security Requirements

### 7.1 Authentication & Authorization

| ID | Requirement | Priority | Implementation |
|----|-------------|----------|----------------|
| SR-001 | Admin API SHALL require authentication | P0 | JWT with RS256 |
| SR-002 | Admin actions SHALL require role-based authorization | P0 | RBAC: admin, viewer |
| SR-003 | Tokens SHALL have configurable expiration | P0 | Default: 1 hour |
| SR-004 | Refresh tokens SHALL be rotated on use | P0 | Single-use refresh |
| SR-005 | Failed login attempts SHALL be rate-limited | P0 | 5 attempts/15 min |

### 7.2 Input Validation & Sanitization

| ID | Requirement | Priority | Implementation |
|----|-------------|----------|----------------|
| SR-006 | All API inputs SHALL be validated | P0 | Joi/Zod schemas |
| SR-007 | IP addresses SHALL be validated format | P0 | Regex + library validation |
| SR-008 | Rule names SHALL be sanitized | P0 | Alphanumeric + limited special chars |
| SR-009 | Numeric limits SHALL have min/max bounds | P0 | 1 - 1,000,000 |
| SR-010 | Request body size SHALL be limited | P0 | Max 100KB |

### 7.3 Data Protection

| ID | Requirement | Priority | Implementation |
|----|-------------|----------|----------------|
| SR-011 | Sensitive config SHALL NOT be logged | P0 | Log sanitization |
| SR-012 | Redis connection SHALL use TLS in production | P0 | TLS 1.3 |
| SR-013 | Admin passwords SHALL be hashed | P0 | bcrypt, cost factor 12 |
| SR-014 | API keys SHALL be stored hashed | P0 | SHA-256 + salt |
| SR-015 | PII in logs SHALL be masked | P0 | IP partial masking optional |

### 7.4 Network Security

| ID | Requirement | Priority | Implementation |
|----|-------------|----------|----------------|
| SR-016 | Admin dashboard SHALL use HTTPS only | P0 | HSTS header |
| SR-017 | CORS SHALL be configured restrictively | P0 | Whitelist origins |
| SR-018 | Security headers SHALL be set | P0 | Helmet.js middleware |
| SR-019 | Redis SHALL NOT be exposed publicly | P0 | Internal network only |
| SR-020 | Rate limiter SHALL prevent header injection | P0 | Header value validation |

### 7.5 Attack Prevention

| ID | Requirement | Priority | Implementation |
|----|-------------|----------|----------------|
| SR-021 | System SHALL prevent IP spoofing via headers | P0 | Trusted proxy config |
| SR-022 | System SHALL handle malformed requests safely | P0 | Try-catch + validation |
| SR-023 | System SHALL prevent timing attacks on auth | P0 | Constant-time comparison |
| SR-024 | System SHALL sanitize error messages | P0 | No stack traces in production |
| SR-025 | System SHALL implement CSRF protection | P0 | Double-submit cookie |

### 7.6 Audit & Compliance

| ID | Requirement | Priority | Implementation |
|----|-------------|----------|----------------|
| SR-026 | All admin actions SHALL be audit logged | P0 | Structured JSON logs |
| SR-027 | Audit logs SHALL be immutable | P0 | Append-only storage |
| SR-028 | Logs SHALL include: timestamp, actor, action, target, result | P0 | Structured format |
| SR-029 | Log retention SHALL be configurable | P1 | Default: 90 days |
| SR-030 | System SHALL support log export | P2 | JSON/CSV export |

### 7.7 Security Configuration Checklist

```yaml
# Production Security Checklist
authentication:
  - [ ] JWT secret is strong (256+ bits)
  - [ ] Token expiration configured
  - [ ] Refresh token rotation enabled
  - [ ] Password policy enforced

network:
  - [ ] HTTPS enforced
  - [ ] HSTS enabled
  - [ ] CORS whitelist configured
  - [ ] Redis not publicly accessible
  - [ ] Firewall rules configured

headers:
  - [ ] X-Content-Type-Options: nosniff
  - [ ] X-Frame-Options: DENY
  - [ ] X-XSS-Protection: 1; mode=block
  - [ ] Content-Security-Policy configured
  - [ ] Referrer-Policy: strict-origin-when-cross-origin

rate_limiting:
  - [ ] Admin login rate limited
  - [ ] API endpoints rate limited
  - [ ] Trusted proxy configured correctly

logging:
  - [ ] Sensitive data not logged
  - [ ] Audit logging enabled
  - [ ] Log level appropriate for environment
```

---

## 8. System Architecture

### 8.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │  Web App │  │  Mobile  │  │   CLI    │  │  Bot/    │                │
│  │          │  │   App    │  │  Tools   │  │  Script  │                │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘                │
└───────┼─────────────┼─────────────┼─────────────┼───────────────────────┘
        │             │             │             │
        └─────────────┴─────────────┴─────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         LOAD BALANCER                                    │
│                     (Extract Real Client IP)                            │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│   Backend     │       │   Backend     │       │   Backend     │
│   Instance 1  │       │   Instance 2  │       │   Instance N  │
│               │       │               │       │               │
│ ┌───────────┐ │       │ ┌───────────┐ │       │ ┌───────────┐ │
│ │  Express  │ │       │ │  Express  │ │       │ │  Express  │ │
│ │  Server   │ │       │ │  Server   │ │       │ │  Server   │ │
│ └─────┬─────┘ │       │ └─────┬─────┘ │       │ └─────┬─────┘ │
│       │       │       │       │       │       │       │       │
│ ┌─────▼─────┐ │       │ ┌─────▼─────┐ │       │ ┌─────▼─────┐ │
│ │   Rate    │ │       │ │   Rate    │ │       │ │   Rate    │ │
│ │  Limiter  │ │       │ │  Limiter  │ │       │ │  Limiter  │ │
│ │Middleware │ │       │ │Middleware │ │       │ │Middleware │ │
│ └─────┬─────┘ │       │ └─────┬─────┘ │       │ └─────┬─────┘ │
└───────┼───────┘       └───────┼───────┘       └───────┼───────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           REDIS CLUSTER                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        Redis Instance                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │   │
│  │  │ Rate Counters│  │  Rule Config │  │ Blocked List │          │   │
│  │  │   (Sorted    │  │    (Hash)    │  │    (Set)     │          │   │
│  │  │    Sets)     │  │              │  │              │          │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         ADMIN DASHBOARD                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      React Application                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │   │
│  │  │  Rules   │  │ Metrics  │  │  Logs    │  │ Settings │        │   │
│  │  │  Manager │  │  View    │  │  View    │  │          │        │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Request Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        REQUEST PROCESSING FLOW                           │
└─────────────────────────────────────────────────────────────────────────┘

     ┌──────────┐
     │ Incoming │
     │ Request  │
     └────┬─────┘
          │
          ▼
    ┌─────────────┐
    │   Extract   │
    │  Client IP  │──────────────────────────┐
    │  & User ID  │                          │
    └──────┬──────┘                          │
           │                                 │
           ▼                                 │
    ┌─────────────┐     ┌─────────────┐     │
    │   Check     │     │             │     │
    │  Blacklist  │────▶│   BLOCKED   │     │
    │             │ Yes │  (403/429)  │     │
    └──────┬──────┘     └─────────────┘     │
           │ No                             │
           ▼                                │
    ┌─────────────┐                         │
    │   Check     │                         │
    │  Whitelist  │────────────┐            │
    │             │ Yes        │            │
    └──────┬──────┘            │            │
           │ No                │            │
           ▼                   │            │
    ┌─────────────┐            │            │
    │    Get      │◄───────────┼────────────┘
    │ Rate Limit  │            │
    │   Config    │            │
    └──────┬──────┘            │
           │                   │
           ▼                   │
    ┌─────────────┐            │
    │  Increment  │            │
    │  Counter    │            │
    │  (Redis)    │            │
    └──────┬──────┘            │
           │                   │
           ▼                   │
    ┌─────────────┐            │
    │   Counter   │            │
    │  > Limit?   │            │
    └──────┬──────┘            │
           │                   │
     ┌─────┴─────┐            │
     │           │            │
    Yes          No           │
     │           │            │
     ▼           ▼            │
┌─────────┐ ┌─────────┐       │
│  429    │ │  PASS   │◄──────┘
│ Response│ │ Request │
│         │ │   to    │
│ Headers:│ │ Handler │
│ Retry-  │ └─────────┘
│ After   │
└─────────┘
```

### 8.3 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND SERVICE                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                         EXPRESS APP                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │   Helmet    │  │    CORS     │  │   Logger    │              │  │
│  │  │ (Security)  │  │ Middleware  │  │ (Morgan)    │              │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │  │
│  │         └────────────────┼────────────────┘                      │  │
│  │                          ▼                                       │  │
│  │  ┌───────────────────────────────────────────────────────────┐  │  │
│  │  │              RATE LIMITER MIDDLEWARE                       │  │  │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │  │  │
│  │  │  │  IP Check   │  │ User Check  │  │Endpoint Chk │       │  │  │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘       │  │  │
│  │  └───────────────────────────┬───────────────────────────────┘  │  │
│  │                              ▼                                   │  │
│  │  ┌───────────────────────────────────────────────────────────┐  │  │
│  │  │                    API ROUTES                              │  │  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │  │
│  │  │  │  /api/*  │  │ /admin/* │  │ /health  │  │ /metrics │  │  │  │
│  │  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │  │
│  │  └───────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                         SERVICES LAYER                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │ RateLimiter │  │   Config    │  │   Audit     │              │  │
│  │  │   Service   │  │   Service   │  │   Logger    │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      DATA ACCESS LAYER                            │  │
│  │  ┌─────────────┐  ┌─────────────┐                                │  │
│  │  │   Redis     │  │   Rule      │                                │  │
│  │  │   Client    │  │   Store     │                                │  │
│  │  └─────────────┘  └─────────────┘                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. API Specifications

### 9.1 Public Rate Limit Headers

All API responses include rate limit information:

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705420800
X-RateLimit-Policy: "100;w=60"
```

### 9.2 Rate Limited Response (429)

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

### 9.3 Admin API Endpoints

#### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/auth/login` | Admin login |
| POST | `/admin/auth/refresh` | Refresh token |
| POST | `/admin/auth/logout` | Logout (invalidate token) |

#### Rate Limit Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/rules` | List all rules |
| GET | `/admin/rules/:id` | Get rule by ID |
| POST | `/admin/rules` | Create new rule |
| PUT | `/admin/rules/:id` | Update rule |
| DELETE | `/admin/rules/:id` | Delete rule |
| POST | `/admin/rules/:id/enable` | Enable rule |
| POST | `/admin/rules/:id/disable` | Disable rule |

#### IP Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ip/blocked` | List blocked IPs |
| POST | `/admin/ip/block` | Block IP |
| DELETE | `/admin/ip/block/:ip` | Unblock IP |
| GET | `/admin/ip/whitelist` | List whitelisted IPs |
| POST | `/admin/ip/whitelist` | Whitelist IP |
| DELETE | `/admin/ip/whitelist/:ip` | Remove from whitelist |

#### Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/metrics` | Get rate limit metrics |
| GET | `/admin/logs` | Get audit logs |
| GET | `/admin/status` | System health status |

### 9.4 API Request/Response Examples

#### Create Rule

```http
POST /admin/rules
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "api-general-limit",
  "description": "General API rate limit",
  "target": {
    "type": "endpoint",
    "pattern": "/api/*"
  },
  "limit": {
    "requests": 100,
    "window": "1m"
  },
  "action": "reject",
  "enabled": true
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "rule_a1b2c3d4",
    "name": "api-general-limit",
    "description": "General API rate limit",
    "target": {
      "type": "endpoint",
      "pattern": "/api/*"
    },
    "limit": {
      "requests": 100,
      "window": "1m"
    },
    "action": "reject",
    "enabled": true,
    "createdAt": "2026-01-16T10:00:00Z",
    "createdBy": "admin@example.com"
  }
}
```

---

## 10. Data Models

### 10.1 Rate Limit Rule

```typescript
interface RateLimitRule {
  id: string;                    // Unique identifier (UUID)
  name: string;                  // Human-readable name
  description?: string;          // Optional description
  target: {
    type: 'global' | 'endpoint' | 'user' | 'ip' | 'apiKey';
    pattern?: string;            // Glob pattern for endpoint matching
    value?: string;              // Specific user/IP/apiKey
  };
  limit: {
    requests: number;            // Max requests allowed
    window: string;              // Time window: '1m', '1h', '1d'
    burstLimit?: number;         // Optional burst allowance
  };
  action: 'reject' | 'throttle' | 'log';
  priority: number;              // Rule precedence (lower = higher priority)
  enabled: boolean;
  conditions?: {                 // Optional additional conditions
    headers?: Record<string, string>;
    methods?: string[];
    timeRange?: {
      start: string;             // HH:mm format
      end: string;
      timezone: string;
    };
  };
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
```

### 10.2 Blocked Entity

```typescript
interface BlockedEntity {
  id: string;
  type: 'ip' | 'user' | 'apiKey';
  value: string;                 // IP address, user ID, or API key hash
  reason: string;
  expiresAt?: Date;              // Optional auto-unblock
  createdAt: Date;
  createdBy: string;
}
```

### 10.3 Audit Log Entry

```typescript
interface AuditLogEntry {
  id: string;
  timestamp: Date;
  actor: {
    id: string;
    email: string;
    ip: string;
  };
  action: string;                // 'rule.create', 'ip.block', etc.
  resource: {
    type: string;
    id: string;
  };
  details: Record<string, any>;  // Action-specific details
  result: 'success' | 'failure';
  errorMessage?: string;
}
```

### 10.4 Redis Key Structures

```
# Rate limit counters (Sliding Window Log)
ratelimit:counter:{identifier}:{window}
  Type: Sorted Set
  Score: Unix timestamp (ms)
  Member: Request ID
  TTL: Window duration + buffer

# Rule configurations
ratelimit:rules
  Type: Hash
  Field: Rule ID
  Value: JSON-encoded rule

# Blocked IPs
ratelimit:blocked:ip
  Type: Set
  Members: IP addresses

# Blocked users
ratelimit:blocked:user
  Type: Set
  Members: User IDs

# Whitelist
ratelimit:whitelist:ip
  Type: Set
  Members: IP addresses

# Metrics
ratelimit:metrics:{date}
  Type: Hash
  Fields: total_requests, blocked_requests, etc.
```

---

## 11. Rate Limiting Algorithms

### 11.1 Algorithm Comparison

| Algorithm | Pros | Cons | Use Case |
|-----------|------|------|----------|
| **Fixed Window** | Simple, low memory | Burst at window edges | Basic limiting |
| **Sliding Window Log** | Precise, no edge bursts | Higher memory | Strict accuracy |
| **Sliding Window Counter** | Good balance | Slight edge approximation | Production default |
| **Token Bucket** | Allows controlled bursts | More complex | APIs with burst needs |
| **Leaky Bucket** | Smooth output | Delays requests | Traffic shaping |

### 11.2 Recommended: Sliding Window Counter

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SLIDING WINDOW COUNTER ALGORITHM                      │
└─────────────────────────────────────────────────────────────────────────┘

Time: ──────────────────────────────────────────────────────────────▶

         Previous Window              Current Window
    ├────────────────────────┼────────────────────────┤
                             │
                      Current Time
                             │
    │◄── 30% of window ──►│◄── 70% of window ──►│
    
    Previous count: 80       Current count: 30
    Weighted: 80 × 0.3 + 30 × 0.7 = 24 + 21 = 45
    
    Limit: 100
    Remaining: 100 - 45 = 55 ✓ ALLOW

```

**Implementation (rate-limiter-flexible):**

```javascript
const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'ratelimit',
  points: 100,           // Number of requests
  duration: 60,          // Per 60 seconds
  blockDuration: 60,     // Block for 60 seconds if exceeded
});
```

### 11.3 Multi-Layer Rate Limiting

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     MULTI-LAYER RATE LIMITING                            │
└─────────────────────────────────────────────────────────────────────────┘

Layer 1: Global (All Requests)
├── 10,000 req/min total system capacity
│
Layer 2: Per-IP
├── 200 req/min per IP address
│
Layer 3: Per-User (Authenticated)
├── 100 req/min per user (default)
├── 500 req/min per user (premium tier)
│
Layer 4: Per-Endpoint
├── /api/login: 10 req/min (prevent brute force)
├── /api/search: 30 req/min (expensive operation)
├── /api/data: 100 req/min (standard)
│
Layer 5: Per-User-Per-Endpoint
└── /api/export: 5 req/hour per user

Request must pass ALL applicable layers to proceed.
```

---

## 12. Admin Dashboard

### 12.1 Dashboard Pages

#### 12.1.1 Overview Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│  RATE LIMITER ADMIN                                    [Admin ▼] [Logout]│
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │   24,521    │  │    1,203    │  │     12      │  │    99.9%    │   │
│  │  Requests   │  │   Blocked   │  │Active Rules │  │   Uptime    │   │
│  │  (last hr)  │  │  (last hr)  │  │             │  │             │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  REQUESTS OVER TIME                                    [1h ▼]    │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │     ▄                                                      │ │  │
│  │  │    ▄█▄    ▄▄                         ▄                     │ │  │
│  │  │   ▄███▄  ▄██▄   ▄▄    ▄    ▄▄      ▄█▄    ▄    ▄          │ │  │
│  │  │  ▄█████▄▄████▄ ▄██▄  ▄█▄  ▄██▄    ▄███▄  ▄█▄  ▄█▄         │ │  │
│  │  │ ▄███████████████████▄█████████▄  ▄█████▄▄███▄▄███▄        │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │   ■ Allowed  ■ Blocked                                          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────┐  ┌────────────────────────────────┐   │
│  │  TOP BLOCKED IPs          │  │  RECENT BLOCKS                  │   │
│  │  ──────────────────────── │  │  ───────────────────────────── │   │
│  │  192.168.1.100    523 req │  │  10:45:23  192.168.1.100      │   │
│  │  10.0.0.55        312 req │  │  10:45:21  user_12345          │   │
│  │  203.0.113.42     198 req │  │  10:45:18  192.168.1.100      │   │
│  │  172.16.0.89      156 req │  │  10:45:15  10.0.0.55          │   │
│  │                           │  │                                 │   │
│  │  [View All]               │  │  [View All]                     │   │
│  └────────────────────────────┘  └────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 12.1.2 Rules Management

```
┌─────────────────────────────────────────────────────────────────────────┐
│  RATE LIMIT RULES                                        [+ New Rule]    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Search: [________________] [Filter ▼] [All Status ▼]                   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ● api-general-limit                                    [Edit] [×]│  │
│  │   Target: /api/*  │  Limit: 100/min  │  Priority: 10            │  │
│  │   Status: ✓ Enabled                                              │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ ● login-protection                                     [Edit] [×]│  │
│  │   Target: /api/login  │  Limit: 10/min  │  Priority: 1          │  │
│  │   Status: ✓ Enabled                                              │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ ○ premium-users                                        [Edit] [×]│  │
│  │   Target: User tier: premium  │  Limit: 500/min  │  Priority: 5 │  │
│  │   Status: ○ Disabled                                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Showing 1-3 of 12 rules                          [< Prev] [Next >]     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 12.1.3 IP Management

```
┌─────────────────────────────────────────────────────────────────────────┐
│  IP MANAGEMENT                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [Blocked List]  [Whitelist]                                            │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  BLOCK IP                                                         │  │
│  │  IP Address: [________________]                                   │  │
│  │  Reason:     [________________]                                   │  │
│  │  Duration:   [Permanent ▼    ]                                    │  │
│  │                                              [Block IP]           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  CURRENTLY BLOCKED                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  IP Address      │ Reason           │ Blocked At    │ Action     │  │
│  │  ─────────────────────────────────────────────────────────────── │  │
│  │  192.168.1.100   │ Abuse detected   │ 2026-01-16    │ [Unblock]  │  │
│  │  10.0.0.55       │ Bot traffic      │ 2026-01-15    │ [Unblock]  │  │
│  │  203.0.113.42    │ Manual block     │ 2026-01-14    │ [Unblock]  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.2 Dashboard Security

- All dashboard access requires authentication
- Session timeout after 15 minutes of inactivity
- Actions logged with user identity
- Sensitive operations require confirmation
- CSP headers prevent XSS attacks

---

## 13. Error Handling

### 13.1 Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;           // Machine-readable error code
    message: string;        // Human-readable message
    details?: any;          // Additional context (non-sensitive)
    requestId?: string;     // For support/debugging
  };
}
```

### 13.2 Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RATE_LIMIT_EXCEEDED` | 429 | Request rate limit exceeded |
| `IP_BLOCKED` | 403 | IP address is blocked |
| `USER_BLOCKED` | 403 | User account is blocked |
| `INVALID_API_KEY` | 401 | Invalid or missing API key |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `RULE_NOT_FOUND` | 404 | Rate limit rule not found |
| `INTERNAL_ERROR` | 500 | Internal server error |
| `SERVICE_UNAVAILABLE` | 503 | Redis connection failed |

### 13.3 Redis Failure Handling

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    REDIS FAILURE HANDLING STRATEGY                       │
└─────────────────────────────────────────────────────────────────────────┘

Configuration Option: REDIS_FAILURE_MODE

┌─────────────────────────────────────────┐
│         Redis Connection Lost           │
└─────────────────┬───────────────────────┘
                  │
                  ▼
        ┌─────────────────┐
        │  Failure Mode?  │
        └────────┬────────┘
                 │
     ┌───────────┼───────────┐
     │           │           │
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│  OPEN   │ │ CLOSED  │ │  CACHE  │
│ (Allow) │ │ (Deny)  │ │  Local  │
└────┬────┘ └────┬────┘ └────┬────┘
     │           │           │
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│  Pass   │ │  503    │ │ In-mem  │
│   All   │ │ Service │ │ fallback│
│Requests │ │Unavail. │ │ (temp)  │
└─────────┘ └─────────┘ └─────────┘

Recommendation: CLOSED for security-critical APIs
               OPEN for non-critical with monitoring alerts
```

---

## 14. Monitoring & Observability

### 14.1 Metrics (Prometheus Format)

```prometheus
# Request counters
ratelimit_requests_total{endpoint="/api/data",status="allowed"} 45231
ratelimit_requests_total{endpoint="/api/data",status="blocked"} 1203

# Current rate limit usage
ratelimit_current_usage{identifier="user_123",limit="100"} 45

# Latency histograms
ratelimit_check_duration_seconds_bucket{le="0.001"} 42312
ratelimit_check_duration_seconds_bucket{le="0.005"} 45123
ratelimit_check_duration_seconds_bucket{le="0.01"} 45230

# Redis health
ratelimit_redis_connected 1
ratelimit_redis_latency_seconds 0.0008

# Rule counts
ratelimit_rules_total{status="enabled"} 12
ratelimit_rules_total{status="disabled"} 3
```

### 14.2 Health Check Endpoint

```http
GET /health

{
  "status": "healthy",
  "timestamp": "2026-01-16T10:00:00Z",
  "components": {
    "redis": {
      "status": "healthy",
      "latency": "0.8ms"
    },
    "ruleStore": {
      "status": "healthy",
      "rulesLoaded": 12
    }
  },
  "version": "1.0.0"
}
```

### 14.3 Logging Standards

```json
{
  "timestamp": "2026-01-16T10:45:23.456Z",
  "level": "info",
  "service": "rate-limiter",
  "requestId": "req_abc123",
  "event": "rate_limit_exceeded",
  "data": {
    "identifier": "192.168.1.***",
    "endpoint": "/api/data",
    "limit": 100,
    "current": 101,
    "action": "rejected"
  }
}
```

---

## 15. Deployment Strategy

### 15.1 Docker Compose (Development)

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  frontend:
    build: ./frontend
    ports:
      - "3001:80"
    depends_on:
      - backend

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

volumes:
  redis-data:
```

### 15.2 Environment Variables

```bash
# Server
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=<secure-password>
REDIS_TLS=true
REDIS_FAILURE_MODE=closed

# Security
JWT_SECRET=<256-bit-secret>
JWT_EXPIRY=1h
REFRESH_TOKEN_EXPIRY=7d
BCRYPT_ROUNDS=12

# Rate Limiting Defaults
DEFAULT_RATE_LIMIT=100
DEFAULT_RATE_WINDOW=60

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=<bcrypt-hash>

# CORS
CORS_ORIGINS=https://admin.example.com
```

### 15.3 Production Checklist

```markdown
## Pre-Deployment Checklist

### Security
- [ ] JWT_SECRET is cryptographically random (256+ bits)
- [ ] All secrets loaded from environment/vault
- [ ] HTTPS enforced
- [ ] Redis password set
- [ ] Redis TLS enabled
- [ ] CORS origins restricted
- [ ] Security headers configured
- [ ] Rate limiting on admin login

### Infrastructure
- [ ] Redis persistence enabled (AOF)
- [ ] Redis memory limit configured
- [ ] Health checks configured
- [ ] Resource limits set (CPU/Memory)
- [ ] Horizontal scaling tested

### Monitoring
- [ ] Metrics endpoint exposed
- [ ] Alerting rules configured
- [ ] Log aggregation setup
- [ ] Dashboard accessible

### Backup
- [ ] Redis backup scheduled
- [ ] Rule export tested
- [ ] Disaster recovery documented
```

---

## 16. Risk Assessment

### 16.1 Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Redis failure | Medium | High | Failover strategy, circuit breaker |
| False positives (blocking legit users) | Low | High | Monitoring, quick unblock capability |
| Rule misconfiguration | Medium | Medium | Validation, audit logs, rollback |
| IP spoofing bypass | Low | Medium | Trusted proxy config, header validation |
| Admin account compromise | Low | Critical | MFA, session limits, audit logs |
| DDoS overwhelming limiter | Low | High | Infrastructure scaling, upstream protection |

### 16.2 Mitigation Details

#### Redis Failure
- Implement circuit breaker pattern
- Configure failure mode (open/closed)
- Monitor Redis health
- Alert on connection issues

#### False Positives
- Start with conservative limits
- Monitor 429 rates
- Provide quick admin unblock
- Review blocked requests periodically

#### Configuration Errors
- Input validation on all rules
- Dry-run mode for new rules
- Audit log all changes
- Version control for rule sets

---

## 17. Timeline & Milestones

### 17.1 Development Phases

```
Week 1: Foundation
├── Day 1-2: Project setup, Redis integration
├── Day 3-4: Core rate limiter middleware
└── Day 5: Basic API endpoints, testing

Week 2: Core Features
├── Day 1-2: Rule management system
├── Day 3-4: IP blocking/whitelisting
└── Day 5: Multi-layer rate limiting

Week 3: Admin Dashboard
├── Day 1-2: Dashboard authentication
├── Day 3-4: Rule management UI
└── Day 5: Metrics visualization

Week 4: Polish & Security
├── Day 1-2: Security hardening
├── Day 3-4: Monitoring integration
└── Day 5: Documentation, deployment

Week 5: Testing & Launch
├── Day 1-2: Load testing
├── Day 3: Security audit
├── Day 4: Staging deployment
└── Day 5: Production deployment
```

### 17.2 Deliverables per Phase

| Phase | Deliverables |
|-------|--------------|
| Week 1 | Working rate limiter, basic API |
| Week 2 | Rule engine, IP management |
| Week 3 | Admin dashboard MVP |
| Week 4 | Production-ready system |
| Week 5 | Deployed, documented system |

---

## 18. Appendix

### 18.1 Glossary

| Term | Definition |
|------|------------|
| Rate Limit | Maximum number of requests allowed within a time window |
| Window | Time period for counting requests (e.g., 1 minute) |
| Throttling | Slowing down requests instead of rejecting |
| Burst | Short-term spike above normal limit |
| 429 | HTTP status code for "Too Many Requests" |
| TTL | Time To Live - automatic expiration |

### 18.2 References

- [RFC 6585 - HTTP 429 Status Code](https://tools.ietf.org/html/rfc6585)
- [IETF Rate Limit Headers Draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
- [rate-limiter-flexible Documentation](https://github.com/animir/node-rate-limiter-flexible)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [OWASP API Security](https://owasp.org/www-project-api-security/)

### 18.3 Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-16 | Shiv | Initial PRD |

---

**Document Status:** Ready for Review  
**Next Review Date:** 2026-01-23  
**Approvers:** [Pending]
