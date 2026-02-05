# Rate Limiter System - Technical Requirements Document

**Version:** 1.0  
**Author:** Shiv  
**Date:** January 17, 2026  
**Classification:** Internal - Engineering  
**Status:** Draft  

---

## Table of Contents

1. [Document Overview](#1-document-overview)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack Specifications](#3-technology-stack-specifications)
4. [Security Architecture](#4-security-architecture)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Cryptographic Requirements](#6-cryptographic-requirements)
7. [Input Validation & Sanitization](#7-input-validation--sanitization)
8. [Network Security](#8-network-security)
9. [Data Security](#9-data-security)
10. [Rate Limiting Implementation](#10-rate-limiting-implementation)
11. [Error Handling & Logging](#11-error-handling--logging)
12. [Infrastructure Security](#12-infrastructure-security)
13. [API Security Standards](#13-api-security-standards)
14. [Dependency Management](#14-dependency-management)
15. [Testing Requirements](#15-testing-requirements)
16. [Monitoring & Alerting](#16-monitoring--alerting)
17. [Incident Response](#17-incident-response)
18. [Compliance Checklist](#18-compliance-checklist)
19. [Security Threat Model](#19-security-threat-model)
20. [Appendix](#20-appendix)

---

## 1. Document Overview

### 1.1 Purpose

This Technical Requirements Document (TRD) defines the technical specifications, security measures, and implementation guidelines for the Rate Limiter System. It serves as the authoritative reference for engineering teams implementing the system.

### 1.2 Scope

| In Scope | Out of Scope |
|----------|--------------|
| Backend API implementation | Third-party API gateway integration |
| Redis data store | Paid WAF services |
| Admin dashboard | Mobile applications |
| Security controls | Multi-region deployment |
| Monitoring & logging | Compliance certifications |

### 1.3 Related Documents

| Document | Location | Description |
|----------|----------|-------------|
| PRD | [docs/PRD.md](./PRD.md) | Product Requirements |
| API Spec | TBD | OpenAPI Specification |
| Runbook | TBD | Operations Runbook |

### 1.4 Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-17 | Shiv | Initial TRD |

---

## 2. System Architecture

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SECURITY PERIMETER                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         NETWORK LAYER (L3/L4)                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │ │
│  │  │   Firewall   │  │   DDoS       │  │   Network    │                 │ │
│  │  │   Rules      │  │   Mitigation │  │   ACLs       │                 │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      APPLICATION LAYER (L7)                            │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │ │
│  │  │                     LOAD BALANCER / REVERSE PROXY               │  │ │
│  │  │  • TLS Termination (TLS 1.3)                                    │  │ │
│  │  │  • Request Size Limiting                                        │  │ │
│  │  │  • Header Validation                                            │  │ │
│  │  │  • X-Forwarded-For Handling                                     │  │ │
│  │  └─────────────────────────────────────────────────────────────────┘  │ │
│  │                                  │                                     │ │
│  │                                  ▼                                     │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │ │
│  │  │                      NODE.JS APPLICATION                        │  │ │
│  │  │                                                                  │  │ │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │  │ │
│  │  │  │   Helmet    │  │    CORS     │  │   Request   │             │  │ │
│  │  │  │  Security   │  │   Policy    │  │   Logger    │             │  │ │
│  │  │  │  Headers    │  │             │  │             │             │  │ │
│  │  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │  │ │
│  │  │         └────────────────┼────────────────┘                     │  │ │
│  │  │                          ▼                                      │  │ │
│  │  │  ┌─────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │              RATE LIMITER MIDDLEWARE                     │   │  │ │
│  │  │  │  ┌───────────┐  ┌───────────┐  ┌───────────┐           │   │  │ │
│  │  │  │  │ IP Check  │  │User Check │  │ Endpoint  │           │   │  │ │
│  │  │  │  │           │  │           │  │  Check    │           │   │  │ │
│  │  │  │  └───────────┘  └───────────┘  └───────────┘           │   │  │ │
│  │  │  └─────────────────────────┬───────────────────────────────┘   │  │ │
│  │  │                            ▼                                    │  │ │
│  │  │  ┌─────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │               INPUT VALIDATION LAYER                     │   │  │ │
│  │  │  │  • Schema Validation (Joi/Zod)                          │   │  │ │
│  │  │  │  • Type Coercion Prevention                             │   │  │ │
│  │  │  │  • SQL/NoSQL Injection Prevention                       │   │  │ │
│  │  │  │  • XSS Sanitization                                     │   │  │ │
│  │  │  └─────────────────────────────────────────────────────────┘   │  │ │
│  │  │                            ▼                                    │  │ │
│  │  │  ┌─────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │              AUTHENTICATION MIDDLEWARE                   │   │  │ │
│  │  │  │  • JWT Verification (RS256)                             │   │  │ │
│  │  │  │  • Token Blacklist Check                                │   │  │ │
│  │  │  │  • Session Validation                                   │   │  │ │
│  │  │  └─────────────────────────────────────────────────────────┘   │  │ │
│  │  │                            ▼                                    │  │ │
│  │  │  ┌─────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │               AUTHORIZATION MIDDLEWARE                   │   │  │ │
│  │  │  │  • Role-Based Access Control (RBAC)                     │   │  │ │
│  │  │  │  • Permission Verification                              │   │  │ │
│  │  │  │  • Resource-Level Authorization                         │   │  │ │
│  │  │  └─────────────────────────────────────────────────────────┘   │  │ │
│  │  │                            ▼                                    │  │ │
│  │  │  ┌─────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │                   BUSINESS LOGIC                         │   │  │ │
│  │  │  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        │   │  │ │
│  │  │  │  │   Rules    │  │     IP     │  │  Metrics   │        │   │  │ │
│  │  │  │  │  Service   │  │  Service   │  │  Service   │        │   │  │ │
│  │  │  │  └────────────┘  └────────────┘  └────────────┘        │   │  │ │
│  │  │  └─────────────────────────────────────────────────────────┘   │  │ │
│  │  │                            ▼                                    │  │ │
│  │  │  ┌─────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │                 ERROR HANDLER                            │   │  │ │
│  │  │  │  • Error Sanitization                                   │   │  │ │
│  │  │  │  • Stack Trace Removal (Production)                     │   │  │ │
│  │  │  │  • Audit Logging                                        │   │  │ │
│  │  │  └─────────────────────────────────────────────────────────┘   │  │ │
│  │  └─────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         DATA LAYER                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │ │
│  │  │                          REDIS                                    │ │ │
│  │  │  • TLS Encryption (In-Transit)                                   │ │ │
│  │  │  • AUTH Password Protected                                       │ │ │
│  │  │  • Network Isolation (Private Subnet)                            │ │ │
│  │  │  • Memory Encryption (At-Rest) - if available                    │ │ │
│  │  │  • AOF Persistence                                               │ │ │
│  │  └──────────────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Interactions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SECURE DATA FLOW DIAGRAM                              │
└─────────────────────────────────────────────────────────────────────────────┘

   CLIENT                    SERVER                         REDIS
     │                         │                              │
     │  1. HTTPS Request       │                              │
     │  ──────────────────────>│                              │
     │  [TLS 1.3 Encrypted]    │                              │
     │                         │                              │
     │                         │  2. Extract & Validate IP    │
     │                         │  ─────────────────────────   │
     │                         │  [X-Forwarded-For Check]     │
     │                         │                              │
     │                         │  3. Check Blacklist          │
     │                         │  ────────────────────────────>│
     │                         │  [TLS Encrypted]             │
     │                         │                              │
     │                         │  4. Blacklist Result         │
     │                         │  <────────────────────────────│
     │                         │                              │
     │                         │  5. Increment Counter        │
     │                         │  ────────────────────────────>│
     │                         │  [Atomic INCR Operation]     │
     │                         │                              │
     │                         │  6. Counter Value            │
     │                         │  <────────────────────────────│
     │                         │                              │
     │                         │  7. Validate Input           │
     │                         │  ─────────────────────────   │
     │                         │  [Schema Validation]         │
     │                         │                              │
     │                         │  8. Verify JWT               │
     │                         │  ─────────────────────────   │
     │                         │  [RS256 Signature Check]     │
     │                         │                              │
     │                         │  9. Check Permissions        │
     │                         │  ─────────────────────────   │
     │                         │  [RBAC Validation]           │
     │                         │                              │
     │                         │  10. Process Request         │
     │                         │  ─────────────────────────   │
     │                         │                              │
     │                         │  11. Audit Log               │
     │                         │  ────────────────────────────>│
     │                         │  [Structured JSON]           │
     │                         │                              │
     │  12. HTTPS Response     │                              │
     │  <──────────────────────│                              │
     │  [Rate Limit Headers]   │                              │
     │                         │                              │
```

### 2.3 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PRODUCTION DEPLOYMENT TOPOLOGY                          │
└─────────────────────────────────────────────────────────────────────────────┘

                              INTERNET
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │      CLOUD FIREWALL     │
                    │  • IP Allowlist/Blocklist│
                    │  • DDoS Protection       │
                    │  • Geo-Blocking          │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │     LOAD BALANCER       │
                    │  • TLS Termination      │
                    │  • Health Checks        │
                    │  • Session Affinity     │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │   APP NODE 1     │ │   APP NODE 2     │ │   APP NODE N     │
    │                  │ │                  │ │                  │
    │ ┌──────────────┐ │ │ ┌──────────────┐ │ │ ┌──────────────┐ │
    │ │  Express +   │ │ │ │  Express +   │ │ │ │  Express +   │ │
    │ │ Rate Limiter │ │ │ │ Rate Limiter │ │ │ │ Rate Limiter │ │
    │ └──────────────┘ │ │ └──────────────┘ │ │ └──────────────┘ │
    │                  │ │                  │ │                  │
    │  CPU: 2 cores    │ │  CPU: 2 cores    │ │  CPU: 2 cores    │
    │  RAM: 1GB        │ │  RAM: 1GB        │ │  RAM: 1GB        │
    │                  │ │                  │ │                  │
    └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     PRIVATE SUBNET        │
                    │                           │
                    │  ┌─────────────────────┐  │
                    │  │   REDIS CLUSTER     │  │
                    │  │                     │  │
                    │  │  Primary (Master)   │  │
                    │  │       │             │  │
                    │  │  ┌────┴────┐        │  │
                    │  │  ▼         ▼        │  │
                    │  │ Replica  Replica    │  │
                    │  │                     │  │
                    │  │  RAM: 1GB           │  │
                    │  │  Persistence: AOF   │  │
                    │  └─────────────────────┘  │
                    │                           │
                    └───────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────────┐
    │                        MONITORING SUBNET                             │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
    │  │ Prometheus  │  │   Grafana   │  │    Loki     │                 │
    │  │  (Metrics)  │  │ (Dashboard) │  │   (Logs)    │                 │
    │  └─────────────┘  └─────────────┘  └─────────────┘                 │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack Specifications

### 3.1 Runtime Environment

| Component | Specification | Security Requirement |
|-----------|---------------|---------------------|
| **Node.js** | v20.x LTS | Latest security patches |
| **npm** | v10.x | Audit enabled, lock file enforced |
| **OS** | Alpine Linux 3.19+ | Minimal attack surface |
| **Container** | Docker 24.x | Non-root user, read-only filesystem |

### 3.2 Dependencies Matrix

| Package | Version | Purpose | Security Notes |
|---------|---------|---------|----------------|
| express | ^4.18.2 | Web framework | Helmet required |
| rate-limiter-flexible | ^4.0.1 | Rate limiting | Redis backend |
| ioredis | ^5.3.2 | Redis client | TLS support |
| helmet | ^7.1.0 | Security headers | All options enabled |
| jsonwebtoken | ^9.0.2 | JWT handling | RS256 only |
| bcryptjs | ^2.4.3 | Password hashing | Cost factor ≥12 |
| express-validator | ^7.0.1 | Input validation | Strict mode |
| winston | ^3.11.0 | Logging | Sanitization enabled |
| cors | ^2.8.5 | CORS handling | Whitelist mode |
| uuid | ^9.0.1 | ID generation | v4 (random) |

### 3.3 Minimum Version Requirements

```yaml
# .nvmrc / .node-version
20.11.0

# engines in package.json
{
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}
```

---

## 4. Security Architecture

### 4.1 Defense in Depth Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEFENSE IN DEPTH LAYERS                              │
└─────────────────────────────────────────────────────────────────────────────┘

Layer 1: PERIMETER SECURITY
├── Cloud Firewall / WAF
├── DDoS Protection
├── Geographic Restrictions
└── IP Reputation Filtering

Layer 2: NETWORK SECURITY
├── TLS 1.3 Encryption
├── Private Subnets
├── Network ACLs
└── VPN for Admin Access

Layer 3: APPLICATION SECURITY
├── Security Headers (Helmet)
├── CORS Policy
├── Rate Limiting
├── Input Validation
└── Output Encoding

Layer 4: AUTHENTICATION & AUTHORIZATION
├── JWT with RS256
├── Token Expiration
├── Refresh Token Rotation
├── Role-Based Access Control
└── Session Management

Layer 5: DATA SECURITY
├── Encryption at Rest
├── Encryption in Transit
├── Data Masking in Logs
├── Secure Key Storage
└── Audit Logging

Layer 6: INFRASTRUCTURE SECURITY
├── Container Hardening
├── Secrets Management
├── Vulnerability Scanning
├── Patch Management
└── Backup & Recovery
```

### 4.2 Security Boundaries

| Boundary | Trust Level | Controls |
|----------|-------------|----------|
| Internet → Load Balancer | Untrusted | TLS, WAF, Rate Limit |
| Load Balancer → App | Semi-trusted | Internal TLS, Auth |
| App → Redis | Trusted | TLS, Password, Network ACL |
| App → Admin UI | Semi-trusted | Authentication, RBAC |

### 4.3 Attack Surface Analysis

| Surface | Threats | Mitigations |
|---------|---------|-------------|
| HTTP Endpoints | Injection, XSS, CSRF | Validation, Sanitization, Tokens |
| Authentication | Brute force, Credential stuffing | Rate limiting, Account lockout |
| Redis Connection | Data exposure, DoS | TLS, Auth, Network isolation |
| Admin Dashboard | Privilege escalation | RBAC, Audit logging |
| Configuration | Secret exposure | Environment variables, Vault |

---

## 5. Authentication & Authorization

### 5.1 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION SEQUENCE                               │
└─────────────────────────────────────────────────────────────────────────────┘

   ADMIN CLIENT                    AUTH SERVER                    REDIS
        │                              │                            │
        │  1. Login Request            │                            │
        │  POST /admin/auth/login      │                            │
        │  {email, password}           │                            │
        │  ────────────────────────────>                            │
        │                              │                            │
        │                              │  2. Check Rate Limit       │
        │                              │  ─────────────────────────>│
        │                              │                            │
        │                              │  3. Rate Limit OK          │
        │                              │  <─────────────────────────│
        │                              │                            │
        │                              │  4. Validate Credentials   │
        │                              │  [bcrypt.compare()]        │
        │                              │  [Constant-time]           │
        │                              │                            │
        │                              │  5. Generate Tokens        │
        │                              │  [Access: 1hr, RS256]      │
        │                              │  [Refresh: 7d, Opaque]     │
        │                              │                            │
        │                              │  6. Store Refresh Token    │
        │                              │  ─────────────────────────>│
        │                              │  [Hashed, with metadata]   │
        │                              │                            │
        │  7. Return Tokens            │                            │
        │  <────────────────────────────                            │
        │  {accessToken, refreshToken} │                            │
        │  [Set-Cookie: HttpOnly]      │                            │
        │                              │                            │

   ─────────────────────────────────────────────────────────────────────────

   AUTHENTICATED REQUEST FLOW:

   ADMIN CLIENT                    API SERVER                     REDIS
        │                              │                            │
        │  1. API Request              │                            │
        │  Authorization: Bearer xxx   │                            │
        │  ────────────────────────────>                            │
        │                              │                            │
        │                              │  2. Verify JWT Signature   │
        │                              │  [RS256 Public Key]        │
        │                              │                            │
        │                              │  3. Check Token Blacklist  │
        │                              │  ─────────────────────────>│
        │                              │                            │
        │                              │  4. Not Blacklisted        │
        │                              │  <─────────────────────────│
        │                              │                            │
        │                              │  5. Verify Claims          │
        │                              │  [exp, iat, iss, sub]      │
        │                              │                            │
        │                              │  6. Load Permissions       │
        │                              │  ─────────────────────────>│
        │                              │                            │
        │                              │  7. User Permissions       │
        │                              │  <─────────────────────────│
        │                              │                            │
        │                              │  8. Authorize Action       │
        │                              │  [RBAC Check]              │
        │                              │                            │
        │  9. API Response             │                            │
        │  <────────────────────────────                            │
        │                              │                            │
```

### 5.2 JWT Specification

```typescript
// Access Token Payload
interface AccessTokenPayload {
  // Standard Claims
  iss: string;          // Issuer: "ratetui-auth"
  sub: string;          // Subject: User ID
  aud: string;          // Audience: "ratetui-api"
  exp: number;          // Expiration: Current + 1 hour
  iat: number;          // Issued At: Current timestamp
  jti: string;          // JWT ID: UUID v4
  
  // Custom Claims
  email: string;        // User email (for audit logs)
  role: 'admin' | 'viewer';
  permissions: string[];
}

// Token Configuration
const TOKEN_CONFIG = {
  accessToken: {
    algorithm: 'RS256',
    expiresIn: '1h',
    issuer: 'ratetui-auth',
    audience: 'ratetui-api',
  },
  refreshToken: {
    length: 64,         // Bytes (512 bits)
    expiresIn: '7d',
    rotateOnUse: true,
    maxReuse: 0,        // Single use only
  }
};
```

### 5.3 Password Requirements

| Requirement | Specification |
|-------------|---------------|
| Minimum Length | 12 characters |
| Complexity | Uppercase, lowercase, number, special char |
| Hashing Algorithm | bcrypt |
| Cost Factor | 12 (production), 10 (development) |
| Max Attempts | 5 per 15 minutes |
| Lockout Duration | 15 minutes |

### 5.4 Role-Based Access Control (RBAC)

```typescript
// Permission Matrix
const PERMISSIONS = {
  admin: [
    'rules:read',
    'rules:create',
    'rules:update',
    'rules:delete',
    'ip:read',
    'ip:block',
    'ip:unblock',
    'ip:whitelist',
    'metrics:read',
    'logs:read',
    'settings:read',
    'settings:update',
  ],
  viewer: [
    'rules:read',
    'ip:read',
    'metrics:read',
    'logs:read',
    'settings:read',
  ],
};

// Resource-Level Authorization
interface AuthorizationCheck {
  user: User;
  action: string;        // e.g., 'rules:update'
  resource?: {
    type: string;        // e.g., 'rule'
    id: string;
    ownerId?: string;
  };
}
```

---

## 6. Cryptographic Requirements

### 6.1 Cryptographic Standards

| Use Case | Algorithm | Key Size | Notes |
|----------|-----------|----------|-------|
| JWT Signing | RS256 (RSA-SHA256) | 2048-bit minimum | 4096-bit recommended |
| Password Hashing | bcrypt | Cost factor 12 | Salt auto-generated |
| API Key Storage | SHA-256 | 256-bit | With random salt |
| Token Generation | CSPRNG | 256-bit minimum | Node.js crypto.randomBytes |
| TLS | TLS 1.3 | Curve25519/P-256 | AEAD ciphers only |

### 6.2 Key Management

```typescript
// Key Storage Locations (Priority Order)
const KEY_SOURCES = [
  'ENVIRONMENT_VARIABLE',     // For container deployments
  'AWS_SECRETS_MANAGER',      // For AWS deployments
  'AZURE_KEY_VAULT',          // For Azure deployments
  'HASHICORP_VAULT',          // For on-premise
  'LOCAL_FILE',               // Development only (never production)
];

// Key Rotation Policy
const KEY_ROTATION = {
  jwtSigningKey: {
    rotationPeriod: '90 days',
    gracePeriod: '24 hours',
    algorithm: 'RS256',
  },
  redisPassword: {
    rotationPeriod: '90 days',
    gracePeriod: '1 hour',
  },
  adminApiKeys: {
    rotationPeriod: '30 days',
    gracePeriod: '24 hours',
  },
};
```

### 6.3 Secure Random Generation

```typescript
import crypto from 'crypto';

// Generate secure random token
const generateSecureToken = (bytes: number = 32): string => {
  return crypto.randomBytes(bytes).toString('hex');
};

// Generate UUID v4 (for non-security-critical IDs)
import { v4 as uuidv4 } from 'uuid';
const generateId = (): string => uuidv4();

// Constant-time comparison (for tokens)
const secureCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    // Still do comparison to maintain constant time
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};
```

---

## 7. Input Validation & Sanitization

### 7.1 Validation Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INPUT VALIDATION PIPELINE                             │
└─────────────────────────────────────────────────────────────────────────────┘

                              RAW INPUT
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │   1. SIZE VALIDATION    │
                    │   • Max body: 100KB     │
                    │   • Max URL: 2048 chars │
                    │   • Max header: 8KB     │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   2. TYPE VALIDATION    │
                    │   • Content-Type check  │
                    │   • JSON parsing        │
                    │   • Encoding validation │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   3. SCHEMA VALIDATION  │
                    │   • Required fields     │
                    │   • Data types          │
                    │   • Value constraints   │
                    │   • Format validation   │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   4. SANITIZATION       │
                    │   • HTML encoding       │
                    │   • SQL escape          │
                    │   • Trim whitespace     │
                    │   • Normalize unicode   │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   5. BUSINESS RULES     │
                    │   • Domain validation   │
                    │   • Relationship checks │
                    │   • Permission scope    │
                    └────────────┬────────────┘
                                 │
                                 ▼
                           VALIDATED INPUT
```

### 7.2 Validation Schemas

```typescript
import Joi from 'joi';

// Common Patterns
const patterns = {
  ip: Joi.string().ip({ version: ['ipv4', 'ipv6'], cidr: 'optional' }),
  email: Joi.string().email({ minDomainSegments: 2 }),
  uuid: Joi.string().uuid({ version: 'uuidv4' }),
  slug: Joi.string().pattern(/^[a-z0-9-]+$/).min(1).max(100),
  safeName: Joi.string().pattern(/^[a-zA-Z0-9\s\-_]+$/).min(1).max(200),
};

// Rate Limit Rule Schema
const rateLimitRuleSchema = Joi.object({
  name: patterns.safeName.required(),
  description: Joi.string().max(500).allow(''),
  target: Joi.object({
    type: Joi.string().valid('global', 'endpoint', 'user', 'ip', 'apiKey').required(),
    pattern: Joi.when('type', {
      is: 'endpoint',
      then: Joi.string().max(500).required(),
      otherwise: Joi.forbidden(),
    }),
    value: Joi.when('type', {
      is: Joi.valid('user', 'ip', 'apiKey'),
      then: Joi.string().max(500).required(),
      otherwise: Joi.forbidden(),
    }),
  }).required(),
  limit: Joi.object({
    requests: Joi.number().integer().min(1).max(1000000).required(),
    window: Joi.string().pattern(/^\d+[smhd]$/).required(), // e.g., "60s", "1m", "1h"
    burstLimit: Joi.number().integer().min(0).max(10000),
  }).required(),
  action: Joi.string().valid('reject', 'throttle', 'log').default('reject'),
  priority: Joi.number().integer().min(0).max(1000).default(100),
  enabled: Joi.boolean().default(true),
}).options({ stripUnknown: true });

// IP Block Schema
const ipBlockSchema = Joi.object({
  ip: patterns.ip.required(),
  reason: patterns.safeName.required(),
  expiresAt: Joi.date().iso().min('now').allow(null),
}).options({ stripUnknown: true });

// Login Schema
const loginSchema = Joi.object({
  email: patterns.email.required(),
  password: Joi.string().min(8).max(128).required(),
}).options({ stripUnknown: true });
```

### 7.3 Sanitization Functions

```typescript
import validator from 'validator';

// Sanitization utilities
const sanitize = {
  // HTML escape for output
  html: (input: string): string => {
    return validator.escape(input);
  },

  // Trim and normalize whitespace
  trim: (input: string): string => {
    return validator.trim(input).replace(/\s+/g, ' ');
  },

  // Remove null bytes and control characters
  controlChars: (input: string): string => {
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  },

  // Normalize unicode
  unicode: (input: string): string => {
    return input.normalize('NFC');
  },

  // Full sanitization pipeline
  full: (input: string): string => {
    return sanitize.unicode(
      sanitize.controlChars(
        sanitize.trim(input)
      )
    );
  },

  // IP address sanitization
  ip: (input: string): string | null => {
    const trimmed = validator.trim(input);
    if (validator.isIP(trimmed)) {
      return trimmed;
    }
    return null;
  },
};
```

### 7.4 Injection Prevention

| Attack Type | Prevention Method |
|-------------|-------------------|
| SQL Injection | Parameterized queries (N/A - using Redis) |
| NoSQL Injection | Schema validation, type checking |
| Command Injection | Never use shell commands with user input |
| LDAP Injection | N/A - not using LDAP |
| XSS | Output encoding, CSP headers |
| Header Injection | Validate header values, reject newlines |
| Path Traversal | Validate paths, use allowlists |

---

## 8. Network Security

### 8.1 TLS Configuration

```typescript
// TLS Configuration for Node.js
const tlsConfig = {
  // Minimum TLS version
  minVersion: 'TLSv1.3',
  
  // Preferred cipher suites (TLS 1.3)
  ciphers: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
  ].join(':'),
  
  // ECDHE curves
  ecdhCurve: 'X25519:P-256:P-384',
  
  // Disable session tickets for forward secrecy
  honorCipherOrder: true,
  
  // Certificate verification
  rejectUnauthorized: true,
};

// Redis TLS Configuration
const redisTlsConfig = {
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production',
    minVersion: 'TLSv1.2',
  },
};
```

### 8.2 Security Headers

```typescript
// Helmet.js Configuration
const helmetConfig = {
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // For inline styles
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  
  // Cross-Origin Policies
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  
  // DNS Prefetch Control
  dnsPrefetchControl: { allow: false },
  
  // Frameguard (Clickjacking Protection)
  frameguard: { action: 'deny' },
  
  // Hide X-Powered-By
  hidePoweredBy: true,
  
  // HSTS
  hsts: {
    maxAge: 31536000,          // 1 year
    includeSubDomains: true,
    preload: true,
  },
  
  // IE No Open
  ieNoOpen: true,
  
  // No Sniff
  noSniff: true,
  
  // Origin Agent Cluster
  originAgentCluster: true,
  
  // Permitted Cross-Domain Policies
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  
  // Referrer Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  
  // XSS Filter
  xssFilter: true,
};
```

### 8.3 CORS Policy

```typescript
// CORS Configuration
const corsConfig = {
  // Strict origin validation
  origin: (origin, callback) => {
    const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [];
    
    // Block requests without origin in production
    if (!origin && process.env.NODE_ENV === 'production') {
      return callback(new Error('Origin required'), false);
    }
    
    // Validate against whitelist
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error('CORS: Origin not allowed'), false);
  },
  
  // Allowed methods
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  
  // Allowed headers
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
  ],
  
  // Exposed headers
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
  ],
  
  // Credentials
  credentials: true,
  
  // Preflight cache
  maxAge: 86400, // 24 hours
  
  // Options success status
  optionsSuccessStatus: 204,
};
```

### 8.4 Request Size Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Request Body | 100KB | Prevent memory exhaustion |
| URL Length | 2048 chars | Browser compatibility |
| Header Size | 8KB | Standard limit |
| Query String | 1KB | Prevent abuse |
| Upload Size | N/A | No uploads in this system |

---

## 9. Data Security

### 9.1 Data Classification

| Classification | Examples | Handling Requirements |
|----------------|----------|----------------------|
| **Critical** | JWT secrets, Redis password | Encrypted at rest, never logged, rotate regularly |
| **Sensitive** | User emails, IP addresses | Masked in logs, access controlled |
| **Internal** | Rate limit rules, metrics | Access controlled, audit logged |
| **Public** | API documentation, health status | No restrictions |

### 9.2 Data at Rest

```typescript
// Redis Persistence Configuration
const redisConfig = {
  // AOF (Append Only File) for durability
  appendonly: 'yes',
  appendfsync: 'everysec',
  
  // RDB snapshots disabled (AOF is sufficient)
  save: '',
  
  // Memory limit
  maxmemory: '256mb',
  maxmemoryPolicy: 'allkeys-lru',
  
  // Disable dangerous commands
  renameCommand: {
    FLUSHDB: '',
    FLUSHALL: '',
    KEYS: '',
    DEBUG: '',
    CONFIG: '',
  },
};
```

### 9.3 Data in Transit

| Connection | Encryption | Certificate |
|------------|------------|-------------|
| Client → Load Balancer | TLS 1.3 | Public CA |
| Load Balancer → App | TLS 1.2+ | Internal CA |
| App → Redis | TLS 1.2+ | Internal CA |
| Admin → Dashboard | TLS 1.3 | Public CA |

### 9.4 Data Retention

| Data Type | Retention Period | Deletion Method |
|-----------|------------------|-----------------|
| Rate limit counters | Window duration + 1 min | Redis TTL auto-expire |
| Blocked IPs | Until manually removed or expiry | Admin action or TTL |
| Audit logs | 90 days | Automated cleanup job |
| Metrics | 30 days | Prometheus retention |
| Session data | Session duration | Redis TTL auto-expire |

### 9.5 Data Masking

```typescript
// Log Masking Configuration
const maskingRules = {
  // Full masking
  fullMask: ['password', 'secret', 'token', 'authorization', 'apiKey'],
  
  // Partial masking (show last 4 chars)
  partialMask: ['email'],
  
  // IP masking (hide last octet)
  ipMask: ['ip', 'clientIp', 'remoteAddress'],
};

// Masking function
const maskSensitiveData = (obj: any, path: string = ''): any => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const masked = Array.isArray(obj) ? [...obj] : { ...obj };
  
  for (const key of Object.keys(masked)) {
    const lowerKey = key.toLowerCase();
    
    if (maskingRules.fullMask.some(f => lowerKey.includes(f))) {
      masked[key] = '[REDACTED]';
    } else if (maskingRules.partialMask.some(f => lowerKey.includes(f))) {
      masked[key] = typeof masked[key] === 'string' 
        ? `***${masked[key].slice(-4)}` 
        : '[REDACTED]';
    } else if (maskingRules.ipMask.some(f => lowerKey.includes(f))) {
      masked[key] = typeof masked[key] === 'string'
        ? masked[key].replace(/\.\d+$/, '.***')
        : '[REDACTED]';
    } else if (typeof masked[key] === 'object') {
      masked[key] = maskSensitiveData(masked[key], `${path}.${key}`);
    }
  }
  
  return masked;
};
```

---

## 10. Rate Limiting Implementation

### 10.1 Algorithm Selection

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RATE LIMITING ALGORITHM COMPARISON                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ FIXED WINDOW                                                                 │
│                                                                              │
│ Window 1 (00:00-01:00)     Window 2 (01:00-02:00)                           │
│ ├──────────────────────────┼──────────────────────────┤                     │
│ │████████████████████░░░░░░│████████████████░░░░░░░░░░│                     │
│ │        80 req            │        60 req            │                     │
│                                                                              │
│ ⚠ Problem: At 00:59, user makes 100 requests. At 01:01, makes 100 more.    │
│            Result: 200 requests in 2 minutes (should be 100/min)            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ SLIDING WINDOW LOG (Precise but memory intensive)                            │
│                                                                              │
│ ┌────────────────────────────────────────────────────────────────────────┐  │
│ │ Sorted Set: timestamp → request_id                                     │  │
│ │ [1705420000001, req_1] [1705420000050, req_2] [1705420000123, req_3]   │  │
│ │                                                                        │  │
│ │ On each request:                                                       │  │
│ │ 1. Remove entries older than window (ZREMRANGEBYSCORE)                 │  │
│ │ 2. Count remaining entries (ZCARD)                                     │  │
│ │ 3. If count < limit, add new entry (ZADD)                             │  │
│ └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│ ✓ Precise                                                                    │
│ ⚠ High memory usage for high-traffic endpoints                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ SLIDING WINDOW COUNTER (Recommended - Balanced approach)                     │
│                                                                              │
│      Previous Window              Current Window                             │
│ ├────────────────────────┼────────────────────────┤                         │
│ │        80 req          │        30 req          │                         │
│                          │                                                   │
│                    Current Time                                              │
│                          │                                                   │
│ │◄── 30% of window ──►│◄── 70% of window ──►│                               │
│                                                                              │
│ Weighted count = (prev_count × overlap%) + current_count                     │
│                = (80 × 0.3) + 30                                             │
│                = 24 + 30 = 54                                                │
│                                                                              │
│ ✓ Memory efficient (2 counters per key)                                      │
│ ✓ Smooth rate limiting                                                       │
│ ✓ ~0.003% error rate (acceptable)                                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ TOKEN BUCKET (For burst allowance)                                           │
│                                                                              │
│ ┌─────────┐                                                                  │
│ │ ● ● ● ● │ ← Bucket (capacity: 10 tokens)                                  │
│ │ ● ● ● ● │                                                                  │
│ │ ● ●     │ ← Current: 6 tokens                                             │
│ └────┬────┘                                                                  │
│      │                                                                       │
│      ▼                                                                       │
│   Request consumes 1 token                                                   │
│   Tokens refill at constant rate (e.g., 10/second)                          │
│                                                                              │
│ ✓ Allows controlled bursts                                                   │
│ ✓ Smooth average rate                                                        │
│ ⚠ More complex to implement correctly                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Implementation Specification

```typescript
import { RateLimiterRedis, IRateLimiterOptions } from 'rate-limiter-flexible';

// Rate Limiter Configuration
interface RateLimiterConfig {
  keyPrefix: string;
  points: number;           // Max requests
  duration: number;         // Window in seconds
  blockDuration?: number;   // Block duration after limit exceeded
  inmemoryBlockOnConsumed?: number;
  insuranceLimiter?: RateLimiterMemory;
}

// Multi-layer rate limiting
const rateLimitLayers = {
  // Layer 1: Global system protection
  global: {
    keyPrefix: 'rl:global',
    points: 10000,
    duration: 60,
    keyGenerator: () => 'global',
  },
  
  // Layer 2: Per-IP protection
  ip: {
    keyPrefix: 'rl:ip',
    points: 200,
    duration: 60,
    keyGenerator: (req) => extractClientIP(req),
  },
  
  // Layer 3: Per-user (authenticated)
  user: {
    keyPrefix: 'rl:user',
    points: 100,
    duration: 60,
    keyGenerator: (req) => req.user?.id,
  },
  
  // Layer 4: Per-endpoint
  endpoint: {
    keyPrefix: 'rl:endpoint',
    points: 'dynamic',  // Based on endpoint config
    duration: 60,
    keyGenerator: (req) => `${req.method}:${req.baseUrl}${req.path}`,
  },
  
  // Layer 5: Per-user-per-endpoint
  userEndpoint: {
    keyPrefix: 'rl:user:endpoint',
    points: 'dynamic',
    duration: 60,
    keyGenerator: (req) => `${req.user?.id}:${req.method}:${req.path}`,
  },
};

// Endpoint-specific limits
const endpointLimits: Record<string, { points: number; duration: number }> = {
  'POST:/admin/auth/login': { points: 5, duration: 900 },   // 5 per 15 min
  'POST:/admin/auth/refresh': { points: 10, duration: 60 }, // 10 per min
  'GET:/api/search': { points: 30, duration: 60 },          // 30 per min
  'POST:/api/export': { points: 5, duration: 3600 },        // 5 per hour
  'default': { points: 100, duration: 60 },                 // 100 per min
};
```

### 10.3 IP Extraction Security

```typescript
/**
 * Secure IP extraction with proxy handling
 * 
 * SECURITY CONSIDERATIONS:
 * 1. X-Forwarded-For can be spoofed by clients
 * 2. Only trust X-Forwarded-For from known proxies
 * 3. Use the rightmost non-trusted IP
 */

interface TrustedProxyConfig {
  enabled: boolean;
  proxies: string[];  // IP ranges of trusted proxies
}

const extractClientIP = (req: Request, config: TrustedProxyConfig): string => {
  // If no proxy trust configured, use direct connection IP
  if (!config.enabled) {
    return req.socket.remoteAddress || 'unknown';
  }
  
  // Get X-Forwarded-For header
  const xForwardedFor = req.headers['x-forwarded-for'];
  
  if (!xForwardedFor) {
    return req.socket.remoteAddress || 'unknown';
  }
  
  // Parse IPs from header (leftmost is original client)
  const ips = typeof xForwardedFor === 'string'
    ? xForwardedFor.split(',').map(ip => ip.trim())
    : xForwardedFor;
  
  // Find the rightmost IP that is not a trusted proxy
  // This prevents spoofing by untrusted clients
  for (let i = ips.length - 1; i >= 0; i--) {
    const ip = ips[i];
    
    // Skip if this is a trusted proxy
    if (isTrustedProxy(ip, config.proxies)) {
      continue;
    }
    
    // Validate IP format
    if (isValidIP(ip)) {
      return ip;
    }
  }
  
  // Fallback to direct connection
  return req.socket.remoteAddress || 'unknown';
};

// Validate IP is in trusted proxy ranges
const isTrustedProxy = (ip: string, trustedRanges: string[]): boolean => {
  return trustedRanges.some(range => {
    // Support CIDR notation
    if (range.includes('/')) {
      return isIPInCIDR(ip, range);
    }
    // Exact match
    return ip === range;
  });
};
```

### 10.4 Redis Key Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REDIS KEY SCHEMA                                   │
└─────────────────────────────────────────────────────────────────────────────┘

RATE LIMIT COUNTERS
───────────────────
rl:ip:{ip_address}
  Type: String (counter via INCR)
  TTL: Window duration
  Example: rl:ip:192.168.1.100 = "45"

rl:user:{user_id}
  Type: String (counter)
  TTL: Window duration
  Example: rl:user:usr_abc123 = "78"

rl:endpoint:{method}:{path}:{identifier}
  Type: String (counter)
  TTL: Window duration
  Example: rl:endpoint:GET:/api/search:192.168.1.100 = "15"


BLOCK LISTS
───────────
rl:blocked:ip
  Type: Set
  Members: Blocked IP addresses
  No TTL (persistent)
  Example: SADD rl:blocked:ip "192.168.1.100"

rl:blocked:ip:temp
  Type: Hash
  Field: IP address
  Value: Expiry timestamp
  Example: HSET rl:blocked:ip:temp "192.168.1.100" "1705420800"

rl:blocked:user
  Type: Set
  Members: Blocked user IDs


WHITELIST
─────────
rl:whitelist:ip
  Type: Set
  Members: Whitelisted IP addresses

rl:whitelist:user
  Type: Set
  Members: Whitelisted user IDs


RATE LIMIT RULES
────────────────
rl:rules
  Type: Hash
  Field: Rule ID
  Value: JSON-encoded rule configuration
  Example: HSET rl:rules "rule_123" '{"name":"api-limit",...}'

rl:rules:index:endpoint
  Type: Hash
  Field: Endpoint pattern
  Value: Rule ID
  Example: HSET rl:rules:index:endpoint "/api/*" "rule_123"


SESSIONS & TOKENS
─────────────────
rl:session:{session_id}
  Type: Hash
  Fields: user_id, created_at, last_active, ip
  TTL: Session duration

rl:refresh:{token_hash}
  Type: Hash
  Fields: user_id, created_at, device_info
  TTL: Refresh token duration

rl:blacklist:token:{jti}
  Type: String
  Value: "1" (exists check)
  TTL: Token expiry time


METRICS
───────
rl:metrics:requests:{date}
  Type: Hash
  Fields: total, blocked, by_endpoint, by_status
  TTL: 30 days

rl:metrics:blocked:{date}
  Type: Sorted Set
  Score: Block count
  Member: IP address
  TTL: 30 days


AUDIT LOGS
──────────
rl:audit:{date}
  Type: List
  Values: JSON-encoded audit entries
  TTL: 90 days
```

---

## 11. Error Handling & Logging

### 11.1 Error Classification

| Category | Status Code | Logging Level | User Message |
|----------|-------------|---------------|--------------|
| Validation | 400 | WARN | Detailed field errors |
| Authentication | 401 | WARN | Generic "unauthorized" |
| Authorization | 403 | WARN | Generic "forbidden" |
| Rate Limit | 429 | INFO | Retry-After info |
| Not Found | 404 | DEBUG | Generic "not found" |
| Server Error | 500 | ERROR | Generic error, no details |
| Service Unavailable | 503 | ERROR | Retry later |

### 11.2 Error Response Format

```typescript
// Standard error response
interface ErrorResponse {
  error: {
    code: string;           // Machine-readable: RATE_LIMIT_EXCEEDED
    message: string;        // Human-readable: "Too many requests"
    details?: any;          // Additional context (only in non-500 errors)
    requestId?: string;     // For support correlation
    retryAfter?: number;    // Seconds (for 429 responses)
  };
}

// Error codes enum
enum ErrorCode {
  // Client errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  IP_BLOCKED = 'IP_BLOCKED',
  USER_BLOCKED = 'USER_BLOCKED',
  
  // Server errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  REDIS_ERROR = 'REDIS_ERROR',
}

// Production error sanitization
const sanitizeError = (error: Error, statusCode: number): ErrorResponse => {
  // Never expose internal details for 500 errors
  if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
    return {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: generateRequestId(),
      }
    };
  }
  
  // Return appropriate error details
  return {
    error: {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message,
      requestId: generateRequestId(),
    }
  };
};
```

### 11.3 Logging Specification

```typescript
// Log levels and usage
const LOG_LEVELS = {
  error: 0,   // System errors, exceptions
  warn: 1,    // Security events, deprecations
  info: 2,    // Business events, successful operations
  http: 3,    // HTTP request/response logging
  debug: 4,   // Detailed debugging information
};

// Structured log format
interface LogEntry {
  timestamp: string;      // ISO 8601
  level: string;
  service: string;
  requestId?: string;
  userId?: string;
  ip?: string;            // Partially masked in logs
  event: string;
  message: string;
  data?: Record<string, any>;
  duration?: number;      // For timing logs
  error?: {
    name: string;
    message: string;
    stack?: string;       // Only in development
  };
}

// Security event logging
const securityEvents = {
  // Authentication events
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESH: 'auth.token.refresh',
  TOKEN_INVALID: 'auth.token.invalid',
  
  // Rate limiting events
  RATE_LIMIT_EXCEEDED: 'ratelimit.exceeded',
  IP_BLOCKED: 'ratelimit.ip.blocked',
  IP_UNBLOCKED: 'ratelimit.ip.unblocked',
  
  // Admin events
  RULE_CREATED: 'admin.rule.created',
  RULE_UPDATED: 'admin.rule.updated',
  RULE_DELETED: 'admin.rule.deleted',
  
  // Security events
  SUSPICIOUS_ACTIVITY: 'security.suspicious',
  BRUTE_FORCE_DETECTED: 'security.bruteforce',
};

// Audit log entry
interface AuditLogEntry extends LogEntry {
  actor: {
    id: string;
    email: string;
    ip: string;
    userAgent?: string;
  };
  action: string;
  resource: {
    type: string;
    id: string;
  };
  changes?: {
    before: any;
    after: any;
  };
  result: 'success' | 'failure';
}
```

### 11.4 Log Retention & Security

| Log Type | Retention | Access Level | Storage |
|----------|-----------|--------------|---------|
| Application Logs | 30 days | Operations | Loki/CloudWatch |
| Audit Logs | 90 days | Security Team | Immutable storage |
| Security Events | 1 year | Security Team | SIEM |
| Debug Logs | 7 days | Developers | Local/Dev only |

---

## 12. Infrastructure Security

### 12.1 Container Hardening

```dockerfile
# Dockerfile security best practices

# Use specific version, not 'latest'
FROM node:20.11.0-alpine3.19

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy package files first (layer caching)
COPY --chown=appuser:appgroup package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application code
COPY --chown=appuser:appgroup . .

# Remove unnecessary files
RUN rm -rf .git .env* *.md tests/

# Security: No new privileges
USER appuser

# Security: Read-only root filesystem (configure in orchestrator)
# Security: Drop all capabilities (configure in orchestrator)

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

# Non-root port
EXPOSE 3000

CMD ["node", "src/index.js"]
```

### 12.2 Docker Compose Security

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    read_only: true
    tmpfs:
      - /tmp:noexec,nosuid,size=64M
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 256M
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - internal
    environment:
      - NODE_ENV=production

  redis:
    image: redis:7.2-alpine
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    read_only: true
    volumes:
      - redis-data:/data:rw
    command: >
      redis-server
      --appendonly yes
      --requirepass ${REDIS_PASSWORD}
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --rename-command FLUSHDB ""
      --rename-command FLUSHALL ""
      --rename-command DEBUG ""
      --rename-command CONFIG ""
    networks:
      - internal
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M

networks:
  internal:
    driver: bridge
    internal: true

volumes:
  redis-data:
    driver: local
```

### 12.3 Secrets Management

```typescript
// Secrets loading priority
const secretsSources = [
  // 1. Environment variables (container injection)
  'ENVIRONMENT',
  
  // 2. Docker secrets (Swarm mode)
  'DOCKER_SECRETS',  // /run/secrets/*
  
  // 3. Kubernetes secrets (mounted volumes)
  'K8S_SECRETS',     // /var/run/secrets/*
  
  // 4. Cloud provider (AWS/Azure/GCP)
  'AWS_SECRETS_MANAGER',
  'AZURE_KEY_VAULT',
  'GCP_SECRET_MANAGER',
  
  // 5. HashiCorp Vault
  'HASHICORP_VAULT',
];

// Required secrets
const requiredSecrets = [
  'JWT_PRIVATE_KEY',    // RSA private key for signing
  'JWT_PUBLIC_KEY',     // RSA public key for verification
  'REDIS_PASSWORD',     // Redis AUTH password
  'ADMIN_PASSWORD_HASH', // Initial admin password hash
];

// Secret validation on startup
const validateSecrets = (): void => {
  const missing = requiredSecrets.filter(s => !process.env[s]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }
  
  // Validate JWT key format
  if (!process.env.JWT_PRIVATE_KEY?.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error('JWT_PRIVATE_KEY must be a valid RSA private key');
  }
};
```

---

## 13. API Security Standards

### 13.1 Rate Limit Response Headers

```http
# Success Response (within limits)
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705420800
X-RateLimit-Policy: "100;w=60"

# Rate Limited Response
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705420800
Content-Type: application/json

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please retry after 45 seconds.",
    "retryAfter": 45
  }
}
```

### 13.2 Authentication Headers

```http
# JWT Bearer Token
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...

# API Key (alternative)
X-API-Key: your_api_key_here
```

### 13.3 Security Headers (Response)

```http
# All responses include these headers
Content-Security-Policy: default-src 'self'; script-src 'self'; ...
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
```

### 13.4 Request Validation Checklist

| Check | Implementation |
|-------|----------------|
| Content-Type validation | Accept only `application/json` |
| Body size limit | 100KB max |
| JSON depth limit | 10 levels max |
| Array size limit | 1000 items max |
| String length limit | Field-specific |
| No prototype pollution | Use `Object.create(null)` or validation |
| No type coercion | Strict schema validation |

---

## 14. Dependency Management

### 14.1 Dependency Security Policy

```yaml
# .npmrc
audit=true
fund=false
save-exact=true
engine-strict=true
package-lock=true

# Security scanning
audit-level=moderate
```

### 14.2 Automated Scanning

```yaml
# GitHub Actions workflow for dependency scanning
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * *'  # Daily

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run npm audit
        run: npm audit --audit-level=moderate
        
      - name: Run Snyk
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

### 14.3 Allowed/Blocked Dependencies

```typescript
// Blocked packages (known security issues or unnecessary risk)
const blockedPackages = [
  'eval',              // Dynamic code execution
  'serialize-to-js',   // Prototype pollution risk
  'js-yaml',           // Use @js-yaml/js-yaml instead
  'moment',            // Use dayjs or date-fns
  'request',           // Deprecated, use axios/fetch
  'node-uuid',         // Use uuid package
];

// Required security packages
const requiredPackages = [
  'helmet',            // Security headers
  'express-validator', // Input validation
  'bcryptjs',          // Password hashing
  'jsonwebtoken',      // JWT (with RS256)
];
```

---

## 15. Testing Requirements

### 15.1 Security Testing Matrix

| Test Type | Coverage Target | Tools |
|-----------|-----------------|-------|
| Unit Tests | 80%+ | Jest |
| Integration Tests | Critical paths | Supertest |
| Security Tests | OWASP Top 10 | Custom + OWASP ZAP |
| Load Tests | 10k req/sec | k6, Artillery |
| Penetration Tests | Annual | External vendor |

### 15.2 Security Test Cases

```typescript
// Security test examples
describe('Security Tests', () => {
  describe('Authentication', () => {
    it('should reject requests without auth token', async () => {
      const res = await request(app).get('/admin/rules');
      expect(res.status).toBe(401);
    });

    it('should reject invalid JWT signatures', async () => {
      const invalidToken = 'eyJ...tampered';
      const res = await request(app)
        .get('/admin/rules')
        .set('Authorization', `Bearer ${invalidToken}`);
      expect(res.status).toBe(401);
    });

    it('should reject expired tokens', async () => {
      const expiredToken = generateExpiredToken();
      const res = await request(app)
        .get('/admin/rules')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });

    it('should rate limit login attempts', async () => {
      // Attempt 6 logins (limit is 5)
      for (let i = 0; i < 6; i++) {
        const res = await request(app)
          .post('/admin/auth/login')
          .send({ email: 'test@test.com', password: 'wrong' });
        
        if (i < 5) {
          expect(res.status).toBe(401);
        } else {
          expect(res.status).toBe(429);
        }
      }
    });
  });

  describe('Input Validation', () => {
    it('should reject SQL injection attempts', async () => {
      const res = await request(app)
        .post('/admin/rules')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ name: "'; DROP TABLE rules; --" });
      expect(res.status).toBe(400);
    });

    it('should reject XSS payloads', async () => {
      const res = await request(app)
        .post('/admin/rules')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ name: '<script>alert("xss")</script>' });
      expect(res.status).toBe(400);
    });

    it('should reject oversized payloads', async () => {
      const largePayload = { data: 'x'.repeat(200000) };
      const res = await request(app)
        .post('/admin/rules')
        .set('Authorization', `Bearer ${validToken}`)
        .send(largePayload);
      expect(res.status).toBe(413);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      // Make 101 requests (limit is 100)
      const results = await Promise.all(
        Array(101).fill(null).map(() => 
          request(app).get('/api/data')
        )
      );
      
      const rateLimited = results.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it('should include rate limit headers', async () => {
      const res = await request(app).get('/api/data');
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('Security Headers', () => {
    it('should include all security headers', async () => {
      const res = await request(app).get('/health');
      
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      expect(res.headers['content-security-policy']).toBeDefined();
    });
  });
});
```

---

## 16. Monitoring & Alerting

### 16.1 Metrics to Collect

| Metric | Type | Labels | Alert Threshold |
|--------|------|--------|-----------------|
| `ratelimit_requests_total` | Counter | status, endpoint | N/A |
| `ratelimit_blocked_total` | Counter | reason, endpoint | >100/min |
| `ratelimit_latency_seconds` | Histogram | endpoint | p99 > 10ms |
| `redis_connection_status` | Gauge | | = 0 (disconnected) |
| `auth_failures_total` | Counter | reason | >10/min |
| `admin_actions_total` | Counter | action, user | Audit only |

### 16.2 Alert Definitions

```yaml
# Prometheus alerting rules
groups:
  - name: rate-limiter-alerts
    rules:
      - alert: HighBlockRate
        expr: rate(ratelimit_blocked_total[5m]) > 100
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: High rate of blocked requests
          
      - alert: RedisConnectionLost
        expr: redis_connection_status == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: Redis connection lost
          
      - alert: AuthBruteForce
        expr: rate(auth_failures_total[5m]) > 10
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: Possible brute force attack detected
          
      - alert: HighLatency
        expr: histogram_quantile(0.99, ratelimit_latency_seconds) > 0.01
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: Rate limiter latency exceeds 10ms
```

### 16.3 Dashboard Panels

| Panel | Visualization | Purpose |
|-------|---------------|---------|
| Request Rate | Time series | Traffic overview |
| Block Rate | Time series | Abuse detection |
| Top Blocked IPs | Table | Identify attackers |
| Latency Distribution | Heatmap | Performance |
| Active Rules | Stat | Configuration status |
| Redis Health | Gauge | Infrastructure |

---

## 17. Incident Response

### 17.1 Security Incident Levels

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| P1 - Critical | Active attack, data breach | 15 minutes | Credential leak |
| P2 - High | Potential breach, DoS | 1 hour | Brute force attack |
| P3 - Medium | Security misconfiguration | 24 hours | Missing header |
| P4 - Low | Minor vulnerability | 1 week | Outdated dependency |

### 17.2 Incident Response Procedures

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      INCIDENT RESPONSE WORKFLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

1. DETECTION
   │
   ├── Automated alert triggers
   ├── Manual report received
   └── Anomaly detected in logs
         │
         ▼
2. TRIAGE (15 min SLA for P1)
   │
   ├── Assess severity level
   ├── Identify affected systems
   └── Notify incident commander
         │
         ▼
3. CONTAINMENT
   │
   ├── Block malicious IPs
   ├── Revoke compromised tokens
   ├── Enable stricter rate limits
   └── Isolate affected components
         │
         ▼
4. INVESTIGATION
   │
   ├── Collect and preserve logs
   ├── Analyze attack vectors
   ├── Identify root cause
   └── Document timeline
         │
         ▼
5. REMEDIATION
   │
   ├── Patch vulnerabilities
   ├── Update configurations
   ├── Rotate credentials
   └── Deploy fixes
         │
         ▼
6. RECOVERY
   │
   ├── Restore normal operations
   ├── Monitor for recurrence
   └── Communicate status
         │
         ▼
7. POST-INCIDENT
   │
   ├── Write incident report
   ├── Conduct blameless postmortem
   ├── Update runbooks
   └── Implement preventive measures
```

### 17.3 Emergency Procedures

```bash
# Emergency IP Block
curl -X POST https://api.ratetui.local/admin/ip/block \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"ip": "192.168.1.100", "reason": "Active attack"}'

# Emergency Rate Limit (reduce to 10 req/min)
redis-cli SET rl:emergency:enabled 1
redis-cli SET rl:emergency:limit 10

# Revoke All Sessions
redis-cli FLUSHDB  # DANGER: Only in emergency

# Enable Fail-Closed Mode
export REDIS_FAILURE_MODE=closed
```

---

## 18. Compliance Checklist

### 18.1 Security Checklist

```markdown
## Pre-Deployment Security Checklist

### Authentication & Authorization
- [ ] JWT uses RS256 algorithm
- [ ] Token expiration is configured (1 hour max)
- [ ] Refresh token rotation is enabled
- [ ] Password requirements enforced (12+ chars, complexity)
- [ ] Account lockout after failed attempts
- [ ] RBAC is properly configured

### Input Validation
- [ ] All inputs validated against schemas
- [ ] Request size limits enforced
- [ ] Content-Type validation enabled
- [ ] No prototype pollution vulnerabilities
- [ ] SQL/NoSQL injection prevented

### Network Security
- [ ] TLS 1.3 enforced
- [ ] HSTS enabled with preload
- [ ] CORS whitelist configured
- [ ] Security headers via Helmet
- [ ] Redis not publicly accessible

### Data Security
- [ ] Sensitive data masked in logs
- [ ] Secrets loaded from secure source
- [ ] No secrets in code or config files
- [ ] Data encryption at rest (if applicable)
- [ ] Audit logging enabled

### Infrastructure
- [ ] Container runs as non-root
- [ ] Read-only filesystem (where possible)
- [ ] Resource limits configured
- [ ] Health checks enabled
- [ ] Vulnerability scanning in CI/CD

### Monitoring
- [ ] Security alerts configured
- [ ] Audit logs retained 90+ days
- [ ] Anomaly detection enabled
- [ ] Incident response documented
```

### 18.2 OWASP Top 10 Mapping

| OWASP Risk | Status | Mitigation |
|------------|--------|------------|
| A01 Broken Access Control | ✅ Mitigated | RBAC, JWT validation |
| A02 Cryptographic Failures | ✅ Mitigated | TLS 1.3, RS256, bcrypt |
| A03 Injection | ✅ Mitigated | Input validation, parameterized queries |
| A04 Insecure Design | ✅ Mitigated | Defense in depth, threat modeling |
| A05 Security Misconfiguration | ✅ Mitigated | Secure defaults, hardening |
| A06 Vulnerable Components | ✅ Mitigated | Dependency scanning, updates |
| A07 Auth Failures | ✅ Mitigated | MFA-ready, rate limiting |
| A08 Data Integrity Failures | ✅ Mitigated | JWT signatures, validation |
| A09 Logging Failures | ✅ Mitigated | Comprehensive audit logging |
| A10 SSRF | ✅ Mitigated | No external requests from user input |

---

## 19. Security Threat Model

### 19.1 STRIDE Analysis

| Threat | Category | Asset | Mitigation |
|--------|----------|-------|------------|
| Token theft | Spoofing | JWT | Short expiry, refresh rotation |
| Credential stuffing | Spoofing | Login | Rate limiting, lockout |
| Log tampering | Tampering | Audit logs | Append-only storage |
| Rule manipulation | Tampering | Rate rules | RBAC, audit logging |
| Data exfiltration | Info Disclosure | Config | Access control, encryption |
| IP address leak | Info Disclosure | User IPs | Log masking |
| Service exhaustion | Denial of Service | API | Rate limiting, resource limits |
| Redis flooding | Denial of Service | Redis | Memory limits, key expiry |
| Token elevation | Elevation | JWT | Signature validation, claims check |
| Admin bypass | Elevation | Admin API | Strong auth, RBAC |

### 19.2 Attack Trees

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ATTACK TREE: BYPASS RATE LIMITING                         │
└─────────────────────────────────────────────────────────────────────────────┘

                         Bypass Rate Limit
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
      Spoof IP           Exploit Logic       Exhaust Resources
           │                   │                   │
     ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐
     │           │       │           │       │           │
     ▼           ▼       │           ▼       ▼           ▼
 Forge X-FF   Use Proxy  │      Race      Redis      Memory
   Header      Rotation  │    Condition   Flood      Exhaust
     │           │       │           │       │           │
 [MITIGATED]  [MITIGATED]│    [MITIGATED]  [MITIGATED]  [MITIGATED]
 Trusted      Block      │     Atomic     Memory      Resource
 proxy only   known VPNs │     INCR       limits      limits
                         │
                   ┌─────┴─────┐
                   │           │
                   ▼           ▼
              Time-based   Endpoint
              Window Bug   Mismatch
                   │           │
              [MITIGATED]  [MITIGATED]
              Sliding      Normalized
              window       path matching
```

### 19.3 Risk Register

| ID | Risk | Likelihood | Impact | Score | Mitigation Status |
|----|------|------------|--------|-------|-------------------|
| R1 | Credential compromise | Medium | Critical | High | Mitigated |
| R2 | DDoS attack | High | High | High | Partially mitigated |
| R3 | Redis failure | Low | High | Medium | Mitigated |
| R4 | Configuration error | Medium | Medium | Medium | Mitigated |
| R5 | Dependency vulnerability | Medium | High | High | Ongoing |
| R6 | Insider threat | Low | Critical | Medium | Mitigated |

---

## 20. Appendix

### 20.1 Security Headers Reference

```typescript
// Complete security headers configuration
const securityHeaders = {
  // Content Security Policy
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; '),
  
  // Transport Security
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  
  // Content Type
  'X-Content-Type-Options': 'nosniff',
  
  // Frame Options
  'X-Frame-Options': 'DENY',
  
  // XSS Protection (legacy, CSP preferred)
  'X-XSS-Protection': '0',
  
  // Referrer Policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Permissions Policy
  'Permissions-Policy': [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
  ].join(', '),
  
  // Cross-Origin Policies
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
```

### 20.2 Environment Variables Reference

```bash
# ===========================================
# REQUIRED VARIABLES
# ===========================================

# Server
NODE_ENV=production              # Environment: development, staging, production
PORT=3000                        # Server port
HOST=0.0.0.0                     # Bind address

# Redis
REDIS_HOST=localhost             # Redis host
REDIS_PORT=6379                  # Redis port
REDIS_PASSWORD=<secure-password> # Redis AUTH password
REDIS_TLS=true                   # Enable TLS for Redis

# Authentication
JWT_PRIVATE_KEY=<rsa-private>    # RSA private key (PEM format)
JWT_PUBLIC_KEY=<rsa-public>      # RSA public key (PEM format)
JWT_EXPIRY=1h                    # Access token expiry
REFRESH_TOKEN_EXPIRY=7d          # Refresh token expiry

# ===========================================
# OPTIONAL VARIABLES
# ===========================================

# Rate Limiting
DEFAULT_RATE_LIMIT=100           # Default requests per window
DEFAULT_RATE_WINDOW=60           # Default window in seconds
REDIS_FAILURE_MODE=open          # 'open' or 'closed' on Redis failure

# Security
BCRYPT_ROUNDS=12                 # bcrypt cost factor
CORS_ORIGINS=https://admin.example.com  # Allowed CORS origins
TRUST_PROXY=loopback             # Trusted proxy configuration

# Logging
LOG_LEVEL=info                   # Log level: error, warn, info, debug
LOG_FORMAT=json                  # Log format: json, dev

# ===========================================
# NEVER SET IN PRODUCTION .env FILE
# Use secrets management instead
# ===========================================
# JWT_PRIVATE_KEY - Use AWS Secrets Manager, Vault, etc.
# REDIS_PASSWORD - Use AWS Secrets Manager, Vault, etc.
# ADMIN_PASSWORD_HASH - Use AWS Secrets Manager, Vault, etc.
```

### 20.3 Glossary

| Term | Definition |
|------|------------|
| **AEAD** | Authenticated Encryption with Associated Data |
| **bcrypt** | Password hashing function based on Blowfish |
| **CORS** | Cross-Origin Resource Sharing |
| **CSP** | Content Security Policy |
| **CSRF** | Cross-Site Request Forgery |
| **HSTS** | HTTP Strict Transport Security |
| **JWT** | JSON Web Token |
| **OWASP** | Open Web Application Security Project |
| **RBAC** | Role-Based Access Control |
| **RS256** | RSA Signature with SHA-256 |
| **STRIDE** | Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation |
| **TLS** | Transport Layer Security |
| **XSS** | Cross-Site Scripting |

### 20.4 References

| Document | URL |
|----------|-----|
| OWASP Top 10 | https://owasp.org/Top10/ |
| OWASP API Security | https://owasp.org/www-project-api-security/ |
| Node.js Security | https://nodejs.org/en/docs/guides/security/ |
| Express Security | https://expressjs.com/en/advanced/best-practice-security.html |
| Redis Security | https://redis.io/docs/management/security/ |
| JWT Best Practices | https://datatracker.ietf.org/doc/html/rfc8725 |
| NIST Guidelines | https://csrc.nist.gov/publications |

---

**Document Status:** Ready for Review  
**Security Classification:** Internal - Engineering  
**Next Review Date:** 2026-02-17  
**Approvers:** [Pending Security Review]
