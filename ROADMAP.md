# Rate Limiter System - Development Roadmap

**Project:** Ratetui - Rate Limiter System  
**Timeline:** 5 Weeks  
**Start Date:** January 18, 2026  
**Target Completion:** February 22, 2026  

---

## 📋 Project Phases Overview

| Phase | Week | Status | Focus Area |
|-------|------|--------|------------|
| **Phase 1** | Week 1 | ✅ In Progress | Foundation & Core Rate Limiting |
| **Phase 2** | Week 2 | ⏳ Pending | Rule Management & Authentication |
| **Phase 3** | Week 3 | ⏳ Pending | Admin Dashboard UI |
| **Phase 4** | Week 4 | ⏳ Pending | Security Hardening & Monitoring |
| **Phase 5** | Week 5 | ⏳ Pending | Testing, Documentation & Deployment |

---

## 🚀 Phase 1: Foundation & Core Rate Limiting (Week 1)

**Goal:** Build the foundational backend with basic rate limiting functionality

### Task 1.1: Project Setup ✅
**Status:** COMPLETED  
**Priority:** P0  
**Estimated Time:** 2-3 hours

#### Subtasks:
- [x] Initialize Git repository
- [x] Create project structure (backend/, frontend/, docs/)
- [x] Setup package.json with dependencies
- [x] Configure Docker Compose for Redis
- [x] Create .env.example with all required variables
- [x] Setup .gitignore and .dockerignore
- [x] Write initial README.md
- [x] Create first commits and push to GitHub

**Validation:**
- Git repo exists with 3 commits
- `npm install` works without errors
- Docker Compose validates successfully

---

### Task 1.2: Redis Integration
**Status:** ⏳ Next Up  
**Priority:** P0  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **1.2.1** Test Redis connection module
  - Open `backend/src/config/redis.js`
  - Verify connection parameters from `.env`
  - Test connection with `redis.ping()`
  - Add error handling for connection failures
  
- [ ] **1.2.2** Implement Redis failure modes
  - Add `getFailureMode()` function
  - Test "open" mode (allow requests if Redis down)
  - Test "closed" mode (deny requests if Redis down)
  - Add reconnection logic with exponential backoff
  
- [ ] **1.2.3** Setup Redis persistence
  - Configure AOF (Append Only File) in docker-compose.yml
  - Set maxmemory and eviction policy
  - Test data persistence across container restarts

- [ ] **1.2.4** Create Redis health check endpoint
  - Update `/health/detailed` to check Redis latency
  - Return Redis status (connected/disconnected)
  - Add Redis ping latency measurement

**Files to Modify:**
- `backend/src/config/redis.js`
- `backend/src/routes/health.js`
- `docker-compose.yml`

**Validation:**
- [ ] Redis connects successfully on startup
- [ ] Health check shows Redis status
- [ ] Data persists after container restart
- [ ] Graceful degradation when Redis is unavailable

**Test Commands:**
```bash
# Start Redis
docker compose up redis -d

# Check connection
npm run dev
curl http://localhost:3000/health/detailed

# Test persistence
docker compose restart redis
curl http://localhost:3000/health/detailed
```

---

### Task 1.3: Core Rate Limiter Implementation
**Status:** ⏳ Todo  
**Priority:** P0  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **1.3.1** Test sliding window counter algorithm
  - Review implementation in `backend/src/middleware/rateLimiter.js`
  - Verify Redis INCR operations
  - Test window overlap calculation
  - Add unit tests for counter logic

- [ ] **1.3.2** Implement IP-based rate limiting
  - Extract client IP correctly (handle X-Forwarded-For)
  - Create rate limiter with IP as key
  - Set default limit: 200 requests/minute per IP
  - Test with multiple IPs

- [ ] **1.3.3** Add rate limit response headers
  - Set X-RateLimit-Limit header
  - Set X-RateLimit-Remaining header
  - Set X-RateLimit-Reset header (Unix timestamp)
  - Add Retry-After header on 429 responses

- [ ] **1.3.4** Implement 429 Too Many Requests response
  - Return proper JSON error format
  - Include retry information
  - Log rate limit violations
  - Test response format

- [ ] **1.3.5** Create rate limiter presets
  - General API: 100 req/min
  - Auth endpoints: 10 req/min
  - Login: 5 req/15 min with 15-min block
  - Admin: 50 req/min

**Files to Modify:**
- `backend/src/middleware/rateLimiter.js`
- `backend/src/routes/api.js`
- Create: `backend/src/middleware/__tests__/rateLimiter.test.js`

**Validation:**
- [ ] Rate limiting triggers after configured limit
- [ ] Headers show correct values
- [ ] 429 response format is correct
- [ ] Different endpoints have different limits
- [ ] Redis stores counters with TTL

**Test Commands:**
```bash
# Test general rate limit
for i in {1..101}; do curl http://localhost:3000/api/data; done

# Test login rate limit
for i in {1..6}; do 
  curl -X POST http://localhost:3000/admin/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
done

# Check Redis keys
docker exec -it ratetui-redis redis-cli
> KEYS ratelimit:*
> TTL ratelimit:ip:127.0.0.1
```

---

### Task 1.4: API Routes & Error Handling
**Status:** ⏳ Todo  
**Priority:** P0  
**Estimated Time:** 2-3 hours

#### Subtasks:
- [ ] **1.4.1** Test health check endpoints
  - Test GET /health (basic)
  - Test GET /health/detailed (with components)
  - Test GET /health/live (liveness probe)
  - Test GET /health/ready (readiness probe)

- [ ] **1.4.2** Create sample API endpoints
  - GET /api/data - general endpoint
  - GET /api/search - with custom rate limit (30/min)
  - GET /api/expensive - with strict limit (10/min)
  - GET /api/status - show rate limit info

- [ ] **1.4.3** Test error handler middleware
  - Test 400 Bad Request
  - Test 401 Unauthorized
  - Test 404 Not Found
  - Test 500 Internal Server Error
  - Verify error sanitization in production mode

- [ ] **1.4.4** Add request logging
  - Log all requests with Morgan
  - Include request ID
  - Log IP address (masked in production)
  - Log response time

**Files to Modify:**
- `backend/src/routes/health.js`
- `backend/src/routes/api.js`
- `backend/src/middleware/errorHandler.js`
- `backend/src/index.js`

**Validation:**
- [ ] All endpoints return proper status codes
- [ ] Errors don't leak sensitive information
- [ ] Request logs include all required fields
- [ ] Health checks return accurate status

---

### Task 1.5: Week 1 Testing & Documentation
**Status:** ⏳ Todo  
**Priority:** P1  
**Estimated Time:** 2-3 hours

#### Subtasks:
- [ ] **1.5.1** Write unit tests
  - Test Redis connection
  - Test rate limiter logic
  - Test error handler
  - Achieve 80%+ code coverage

- [ ] **1.5.2** Manual integration testing
  - Start full stack with docker-compose
  - Test all API endpoints
  - Test rate limiting behavior
  - Test Redis failure scenarios

- [ ] **1.5.3** Update documentation
  - Document .env variables
  - Add setup instructions to README
  - Document API endpoints
  - Add troubleshooting guide

- [ ] **1.5.4** Code review & cleanup
  - Remove console.logs
  - Fix ESLint warnings
  - Add missing JSDoc comments
  - Optimize imports

**Files to Create:**
- `backend/src/__tests__/integration.test.js`
- `backend/src/__tests__/ratelimiter.test.js`
- `backend/SETUP.md`

**Validation:**
- [ ] All tests pass (`npm test`)
- [ ] No ESLint errors
- [ ] Documentation is up to date
- [ ] System runs without errors

**Week 1 Deliverables:**
- ✅ Working rate limiter with Redis backend
- ✅ Basic API endpoints with rate limiting
- ✅ Health check endpoints
- ✅ Error handling and logging
- ✅ Docker setup
- ✅ Unit tests

---

## 🔐 Phase 2: Rule Management & Authentication (Week 2)

**Goal:** Implement authentication system and dynamic rule management

### Task 2.1: JWT Authentication System
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 5-6 hours

#### Subtasks:
- [ ] **2.1.1** Generate RSA key pair
  - Generate 2048-bit RSA private key
  - Extract public key
  - Store in secure location (not in repo)
  - Add to .env.example as placeholders

  ```bash
  # Generate keys
  openssl genrsa -out private.key 2048
  openssl rsa -in private.key -pubout -out public.key
  
  # Convert to single-line for .env
  awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private.key
  ```

- [ ] **2.1.2** Create JWT service
  - Create `backend/src/services/jwt.js`
  - Implement `generateAccessToken(user)` with RS256
  - Implement `generateRefreshToken()` (random 64-byte token)
  - Implement `verifyAccessToken(token)`
  - Add token expiration handling

- [ ] **2.1.3** Create auth middleware
  - Create `backend/src/middleware/auth.js`
  - Extract and verify JWT from Authorization header
  - Check token blacklist in Redis
  - Attach user to request object
  - Handle token expiration errors

- [ ] **2.1.4** Implement login endpoint
  - Create `backend/src/routes/auth.js`
  - POST /admin/auth/login
  - Validate email/password with bcrypt
  - Rate limit: 5 attempts per 15 minutes
  - Generate access + refresh tokens
  - Store refresh token in Redis

- [ ] **2.1.5** Implement logout endpoint
  - POST /admin/auth/logout
  - Add access token JTI to blacklist
  - Delete refresh token from Redis
  - Set blacklist TTL to token expiry

- [ ] **2.1.6** Implement token refresh
  - POST /admin/auth/refresh
  - Validate refresh token
  - Check if token already used (rotation)
  - Generate new access + refresh tokens
  - Invalidate old refresh token

**Files to Create:**
- `backend/src/services/jwt.js`
- `backend/src/services/auth.js`
- `backend/src/middleware/auth.js`
- `backend/src/routes/auth.js`
- `backend/src/__tests__/auth.test.js`

**Validation:**
- [ ] Login with valid credentials returns tokens
- [ ] Login with invalid credentials returns 401
- [ ] Access token can access protected routes
- [ ] Expired tokens return 401
- [ ] Refresh token rotation works
- [ ] Logout invalidates tokens

**Test Commands:**
```bash
# Login
curl -X POST http://localhost:3000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Access protected route
curl http://localhost:3000/admin/rules \
  -H "Authorization: Bearer <access_token>"

# Refresh token
curl -X POST http://localhost:3000/admin/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refresh_token>"}'

# Logout
curl -X POST http://localhost:3000/admin/auth/logout \
  -H "Authorization: Bearer <access_token>"
```

---

### Task 2.2: User & Role Management
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **2.2.1** Create user data model
  - Create `backend/src/models/User.js`
  - Define user schema (id, email, passwordHash, role, createdAt)
  - Store in Redis hash: `user:{userId}`
  - Create email index for lookup

- [ ] **2.2.2** Implement RBAC system
  - Create `backend/src/services/rbac.js`
  - Define permissions matrix (admin, viewer)
  - Implement `hasPermission(user, permission)` function
  - Create authorization middleware

- [ ] **2.2.3** Create initial admin user
  - Create setup script `backend/scripts/createAdmin.js`
  - Hash password with bcrypt (cost factor 12)
  - Store in Redis
  - Run on first deployment

- [ ] **2.2.4** Add authorization middleware
  - Create `backend/src/middleware/authorize.js`
  - Check user role and permissions
  - Return 403 if unauthorized
  - Log authorization failures

**Files to Create:**
- `backend/src/models/User.js`
- `backend/src/services/rbac.js`
- `backend/src/middleware/authorize.js`
- `backend/scripts/createAdmin.js`

**Validation:**
- [ ] Admin user can be created
- [ ] Login works with created admin
- [ ] RBAC correctly allows/denies actions
- [ ] Viewer role has limited permissions

---

### Task 2.3: Rate Limit Rule Management
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 6-7 hours

#### Subtasks:
- [ ] **2.3.1** Create rule data model
  - Create `backend/src/models/RateLimitRule.js`
  - Define schema (id, name, target, limit, action, priority, enabled)
  - Add validation rules
  - Store in Redis hash: `rl:rules`

- [ ] **2.3.2** Implement rule service
  - Create `backend/src/services/ruleService.js`
  - `createRule(rule)` - validate and store
  - `updateRule(id, updates)` - update existing
  - `deleteRule(id)` - remove rule
  - `getRule(id)` - retrieve single rule
  - `getAllRules()` - list all rules
  - `enableRule(id)` / `disableRule(id)` - toggle

- [ ] **2.3.3** Create rule validation
  - Create `backend/src/validators/ruleValidator.js`
  - Use Joi to validate rule schema
  - Check for conflicts (overlapping patterns)
  - Validate rate limits (1-1000000 requests)
  - Validate time windows (1s-1d)

- [ ] **2.3.4** Implement rule API endpoints
  - GET /admin/rules - list all rules
  - GET /admin/rules/:id - get single rule
  - POST /admin/rules - create new rule
  - PUT /admin/rules/:id - update rule
  - DELETE /admin/rules/:id - delete rule
  - POST /admin/rules/:id/enable - enable rule
  - POST /admin/rules/:id/disable - disable rule

- [ ] **2.3.5** Apply rules dynamically
  - Update rate limiter to load rules from Redis
  - Match request against rule patterns
  - Apply rule with highest priority
  - Fall back to default if no match
  - Cache rules in memory (with TTL)

- [ ] **2.3.6** Add audit logging for rule changes
  - Log all rule create/update/delete operations
  - Include: timestamp, actor, action, before/after
  - Store in Redis list: `rl:audit:{date}`
  - Implement log retention (90 days)

**Files to Create:**
- `backend/src/models/RateLimitRule.js`
- `backend/src/services/ruleService.js`
- `backend/src/validators/ruleValidator.js`
- `backend/src/routes/rules.js`
- `backend/src/__tests__/rules.test.js`

**Files to Modify:**
- `backend/src/middleware/rateLimiter.js` - load dynamic rules
- `backend/src/routes/admin.js` - add rule routes

**Validation:**
- [ ] Rules can be created via API
- [ ] Rules can be updated and deleted
- [ ] Dynamic rules are applied correctly
- [ ] Rule conflicts are detected
- [ ] Audit logs capture all changes

**Test Commands:**
```bash
# Create rule
curl -X POST http://localhost:3000/admin/rules \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "api-general-limit",
    "target": {"type": "endpoint", "pattern": "/api/*"},
    "limit": {"requests": 100, "window": "1m"},
    "action": "reject",
    "enabled": true
  }'

# List rules
curl http://localhost:3000/admin/rules \
  -H "Authorization: Bearer <token>"

# Update rule
curl -X PUT http://localhost:3000/admin/rules/rule_123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"limit": {"requests": 200, "window": "1m"}}'

# Test rule application
for i in {1..101}; do curl http://localhost:3000/api/data; done
```

---

### Task 2.4: IP Block & Whitelist Management
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **2.4.1** Create IP blocking service
  - Create `backend/src/services/ipService.js`
  - `blockIP(ip, reason, expiresAt)` - add to blacklist
  - `unblockIP(ip)` - remove from blacklist
  - `isIPBlocked(ip)` - check if blocked
  - Support CIDR notation (e.g., 192.168.1.0/24)

- [ ] **2.4.2** Create IP whitelist service
  - `whitelistIP(ip)` - add to whitelist
  - `removeWhitelist(ip)` - remove from whitelist
  - `isIPWhitelisted(ip)` - check whitelist
  - Whitelist bypasses all rate limits

- [ ] **2.4.3** Implement IP management endpoints
  - GET /admin/ip/blocked - list blocked IPs
  - POST /admin/ip/block - block IP
  - DELETE /admin/ip/block/:ip - unblock IP
  - GET /admin/ip/whitelist - list whitelisted IPs
  - POST /admin/ip/whitelist - add to whitelist
  - DELETE /admin/ip/whitelist/:ip - remove from whitelist

- [ ] **2.4.4** Integrate with rate limiter
  - Check blacklist before rate limiting
  - Check whitelist to bypass rate limiting
  - Return 403 for blocked IPs
  - Log blocked access attempts

- [ ] **2.4.5** Add temporary blocks
  - Support expiration time for blocks
  - Auto-remove expired blocks (Redis TTL)
  - Store permanent blocks separately

**Files to Create:**
- `backend/src/services/ipService.js`
- `backend/src/routes/ip.js`
- `backend/src/__tests__/ip.test.js`

**Files to Modify:**
- `backend/src/middleware/rateLimiter.js` - check blacklist/whitelist
- `backend/src/routes/admin.js` - add IP routes

**Validation:**
- [ ] Blocked IPs cannot access API
- [ ] Whitelisted IPs bypass rate limits
- [ ] Temporary blocks expire automatically
- [ ] CIDR ranges work correctly

**Test Commands:**
```bash
# Block IP
curl -X POST http://localhost:3000/admin/ip/block \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"ip":"192.168.1.100","reason":"Abuse detected"}'

# List blocked IPs
curl http://localhost:3000/admin/ip/blocked \
  -H "Authorization: Bearer <token>"

# Test blocked access
curl http://localhost:3000/api/data -H "X-Forwarded-For: 192.168.1.100"

# Whitelist IP
curl -X POST http://localhost:3000/admin/ip/whitelist \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"ip":"10.0.0.5"}'

# Test unlimited access
for i in {1..200}; do 
  curl http://localhost:3000/api/data -H "X-Forwarded-For: 10.0.0.5"
done
```

---

### Task 2.5: Week 2 Testing & Integration
**Status:** ⏳ Not Started  
**Priority:** P1  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **2.5.1** Write integration tests
  - Test full authentication flow
  - Test rule CRUD operations
  - Test IP blocking/whitelisting
  - Test authorization checks

- [ ] **2.5.2** Security testing
  - Test JWT tampering detection
  - Test token expiration
  - Test rate limiting on login
  - Test SQL/NoSQL injection attempts

- [ ] **2.5.3** Update API documentation
  - Document all auth endpoints
  - Document rule management endpoints
  - Document IP management endpoints
  - Add example requests/responses

- [ ] **2.5.4** Code review & refactoring
  - Review error handling
  - Optimize Redis queries
  - Add missing validations
  - Update JSDoc comments

**Week 2 Deliverables:**
- ✅ JWT authentication system
- ✅ RBAC implementation
- ✅ Dynamic rule management
- ✅ IP blocking and whitelisting
- ✅ Audit logging
- ✅ API documentation

---

## 🎨 Phase 3: Admin Dashboard UI (Week 3)

**Goal:** Build React admin dashboard with real-time monitoring

### Task 3.1: Frontend Project Setup
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 2-3 hours

#### Subtasks:
- [ ] **3.1.1** Initialize React app
  - Run `npm create vite@latest frontend -- --template react`
  - Install dependencies: React Router, Axios, Recharts
  - Setup folder structure (components, pages, services, hooks)
  - Configure Vite for proxy to backend

  ```bash
  cd frontend
  npm install react-router-dom axios recharts date-fns
  npm install -D tailwindcss postcss autoprefixer
  npx tailwindcss init -p
  ```

- [ ] **3.1.2** Configure Tailwind CSS
  - Setup tailwind.config.js
  - Add Tailwind directives to index.css
  - Create custom color scheme
  - Test with sample component

- [ ] **3.1.3** Create routing structure
  - Setup React Router
  - Create route pages: Login, Dashboard, Rules, IPs, Logs, Settings
  - Add protected route wrapper
  - Create 404 page

- [ ] **3.1.4** Create API service
  - Create `frontend/src/services/api.js`
  - Setup Axios instance with base URL
  - Add request interceptor (attach JWT)
  - Add response interceptor (handle 401)
  - Implement token refresh logic

**Files to Create:**
- `frontend/src/App.jsx`
- `frontend/src/router.jsx`
- `frontend/src/services/api.js`
- `frontend/src/services/auth.js`
- `frontend/vite.config.js`
- `frontend/tailwind.config.js`

**Validation:**
- [ ] React app runs on port 3001
- [ ] Tailwind styles work
- [ ] Routing works
- [ ] API calls can reach backend

---

### Task 3.2: Authentication UI
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **3.2.1** Create login page
  - Create `frontend/src/pages/Login.jsx`
  - Email and password inputs with validation
  - Error message display
  - Loading state during login
  - Redirect to dashboard on success

- [ ] **3.2.2** Implement auth context
  - Create `frontend/src/contexts/AuthContext.jsx`
  - Store user and tokens in state
  - Persist tokens to localStorage
  - Provide login/logout functions
  - Auto-refresh token before expiry

- [ ] **3.2.3** Create protected route wrapper
  - Create `frontend/src/components/ProtectedRoute.jsx`
  - Check if user is authenticated
  - Redirect to login if not
  - Show loading spinner during check

- [ ] **3.2.4** Add logout functionality
  - Add logout button to navbar
  - Call backend logout endpoint
  - Clear tokens from localStorage
  - Redirect to login page

**Files to Create:**
- `frontend/src/pages/Login.jsx`
- `frontend/src/contexts/AuthContext.jsx`
- `frontend/src/components/ProtectedRoute.jsx`
- `frontend/src/hooks/useAuth.js`

**Validation:**
- [ ] Can login with valid credentials
- [ ] Invalid credentials show error
- [ ] Protected routes require login
- [ ] Logout clears session
- [ ] Token refresh works automatically

---

### Task 3.3: Dashboard Overview
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **3.3.1** Create dashboard layout
  - Create `frontend/src/components/Layout.jsx`
  - Add sidebar navigation
  - Add top navbar with user info
  - Make responsive (mobile-friendly)

- [ ] **3.3.2** Create stats cards
  - Create `frontend/src/components/StatsCard.jsx`
  - Show: Total requests, Blocked requests, Active rules, Uptime
  - Add icons and colors
  - Make data auto-refresh every 30s

- [ ] **3.3.3** Create requests chart
  - Create `frontend/src/components/RequestsChart.jsx`
  - Use Recharts Line chart
  - Show allowed vs blocked over time
  - Add time range selector (1h, 6h, 24h)
  - Fetch data from new backend endpoint

- [ ] **3.3.4** Create top blocked IPs table
  - Create `frontend/src/components/TopBlockedIPs.jsx`
  - Show table of most blocked IPs
  - Include block count and last seen
  - Add "Block permanently" action

- [ ] **3.3.5** Create recent blocks feed
  - Create `frontend/src/components/RecentBlocks.jsx`
  - Real-time feed of blocked requests
  - Show timestamp, IP, endpoint, reason
  - Auto-update every 5 seconds

- [ ] **3.3.6** Add metrics backend endpoint
  - Create GET /admin/metrics
  - Return aggregated statistics
  - Return time-series data for charts
  - Cache results for 30 seconds

**Files to Create:**
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/components/Layout.jsx`
- `frontend/src/components/StatsCard.jsx`
- `frontend/src/components/RequestsChart.jsx`
- `frontend/src/components/TopBlockedIPs.jsx`
- `frontend/src/components/RecentBlocks.jsx`
- `backend/src/services/metricsService.js`

**Files to Modify:**
- `backend/src/routes/admin.js` - add metrics endpoint

**Validation:**
- [ ] Dashboard displays all metrics
- [ ] Charts render correctly
- [ ] Data auto-refreshes
- [ ] Responsive on mobile

---

### Task 3.4: Rule Management UI
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 5-6 hours

#### Subtasks:
- [ ] **3.4.1** Create rules list page
  - Create `frontend/src/pages/Rules.jsx`
  - Display table of all rules
  - Show: name, target, limit, status, actions
  - Add search/filter functionality
  - Add pagination

- [ ] **3.4.2** Create rule form component
  - Create `frontend/src/components/RuleForm.jsx`
  - Form fields: name, description, target type, pattern, limit, window
  - Dropdown for action (reject, throttle, log)
  - Enable/disable toggle
  - Validation feedback

- [ ] **3.4.3** Create rule modal
  - Create `frontend/src/components/RuleModal.jsx`
  - Modal for create/edit rule
  - Use RuleForm inside modal
  - Handle form submission
  - Show success/error messages

- [ ] **3.4.4** Add rule actions
  - Edit button opens modal with rule data
  - Delete button with confirmation dialog
  - Enable/disable toggle (immediate effect)
  - Duplicate rule button

- [ ] **3.4.5** Add rule priority reordering
  - Drag-and-drop to reorder rules
  - Visual indicator of priority
  - Save new order to backend
  - Use react-beautiful-dnd library

**Files to Create:**
- `frontend/src/pages/Rules.jsx`
- `frontend/src/components/RuleForm.jsx`
- `frontend/src/components/RuleModal.jsx`
- `frontend/src/components/RuleCard.jsx`
- `frontend/src/hooks/useRules.js`

**Validation:**
- [ ] Can create new rules
- [ ] Can edit existing rules
- [ ] Can delete rules with confirmation
- [ ] Can enable/disable rules
- [ ] Can reorder rule priority

---

### Task 3.5: IP Management UI
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **3.5.1** Create IP management page
  - Create `frontend/src/pages/IPManagement.jsx`
  - Tabs for: Blocked IPs, Whitelist
  - Search and filter functionality
  - Bulk actions support

- [ ] **3.5.2** Create block IP form
  - Input for IP address or CIDR
  - Input for reason
  - Optional expiration date picker
  - Validate IP format
  - Submit to backend

- [ ] **3.5.3** Create blocked IPs table
  - Display blocked IPs with reason and timestamp
  - Show expiration if temporary
  - Add "Unblock" action button
  - Add "Make permanent" for temp blocks

- [ ] **3.5.4** Create whitelist table
  - Display whitelisted IPs
  - Add reason/note field
  - Add "Remove from whitelist" action
  - Show when added and by whom

- [ ] **3.5.5** Add IP quick actions
  - Quick block from dashboard (top blocked IPs)
  - Quick block from logs view
  - Bulk block multiple IPs
  - Export lists to CSV

**Files to Create:**
- `frontend/src/pages/IPManagement.jsx`
- `frontend/src/components/BlockIPForm.jsx`
- `frontend/src/components/IPTable.jsx`
- `frontend/src/hooks/useIPs.js`

**Validation:**
- [ ] Can block IPs manually
- [ ] Can unblock IPs
- [ ] Can add to whitelist
- [ ] Temporary blocks show expiration
- [ ] IP format validation works

---

### Task 3.6: Logs & Audit Trail UI
**Status:** ⏳ Not Started  
**Priority:** P1  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **3.6.1** Create logs page
  - Create `frontend/src/pages/Logs.jsx`
  - Display audit log entries
  - Filter by: action type, actor, date range
  - Pagination for large datasets

- [ ] **3.6.2** Create log entry component
  - Create `frontend/src/components/LogEntry.jsx`
  - Show timestamp, actor, action, resource
  - Expandable for full details
  - Color-code by action type

- [ ] **3.6.3** Add log export
  - Export to JSON button
  - Export to CSV button
  - Date range selector for export
  - Download as file

- [ ] **3.6.4** Add audit backend endpoint
  - Create GET /admin/logs
  - Support filtering and pagination
  - Return formatted log entries
  - Add date range query params

**Files to Create:**
- `frontend/src/pages/Logs.jsx`
- `frontend/src/components/LogEntry.jsx`
- `frontend/src/components/LogFilters.jsx`
- `backend/src/services/auditService.js`

**Validation:**
- [ ] Logs display correctly
- [ ] Filtering works
- [ ] Pagination works
- [ ] Export functionality works

---

### Task 3.7: Week 3 UI Polish & Testing
**Status:** ⏳ Not Started  
**Priority:** P1  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **3.7.1** Add loading states
  - Skeleton loaders for tables
  - Spinners for actions
  - Progress indicators for async operations

- [ ] **3.7.2** Add error handling UI
  - Toast notifications for errors
  - Inline validation errors
  - Network error recovery

- [ ] **3.7.3** Improve accessibility
  - Add ARIA labels
  - Keyboard navigation
  - Focus management in modals
  - Color contrast check

- [ ] **3.7.4** Test all UI flows
  - Test full user journey
  - Test on different screen sizes
  - Test on different browsers
  - Fix UI bugs

**Week 3 Deliverables:**
- ✅ React admin dashboard
- ✅ Authentication UI
- ✅ Dashboard with metrics
- ✅ Rule management UI
- ✅ IP management UI
- ✅ Audit logs viewer

---

## 🔒 Phase 4: Security Hardening & Monitoring (Week 4)

**Goal:** Implement advanced security measures and monitoring

### Task 4.1: Security Hardening
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 6-7 hours

#### Subtasks:
- [ ] **4.1.1** Implement input sanitization
  - Add sanitization to all input validators
  - Prevent XSS attacks
  - Prevent NoSQL injection
  - Test with malicious inputs

- [ ] **4.1.2** Add CSRF protection
  - Implement double-submit cookie pattern
  - Add CSRF token to all state-changing requests
  - Validate token on backend
  - Update frontend to include token

- [ ] **4.1.3** Implement rate limiting on admin endpoints
  - Add stricter limits for admin actions
  - Separate rate limits for sensitive operations
  - Block after failed authentication attempts
  - Monitor suspicious patterns

- [ ] **4.1.4** Add security headers
  - Verify all Helmet headers are set
  - Add Content Security Policy
  - Test with security header scanner
  - Fix any issues

- [ ] **4.1.5** Implement IP allowlist for admin access
  - Create `backend/src/middleware/adminAccess.js`
  - Check client IP against allowlist
  - Support CIDR ranges
  - Add env variable for allowed IPs
  - Return 403 for unauthorized IPs

- [ ] **4.1.6** Add request signing (optional)
  - Implement HMAC request signing
  - Verify signature on sensitive endpoints
  - Prevent replay attacks with nonce
  - Document signing algorithm

**Files to Create:**
- `backend/src/middleware/adminAccess.js`
- `backend/src/middleware/csrf.js`
- `backend/src/utils/sanitize.js`

**Files to Modify:**
- All validators to include sanitization
- `backend/src/index.js` - add admin access middleware
- `frontend/src/services/api.js` - add CSRF token

**Validation:**
- [ ] XSS attacks are prevented
- [ ] CSRF protection works
- [ ] Admin access restricted by IP
- [ ] Security headers pass scan
- [ ] Rate limits protect admin endpoints

---

### Task 4.2: Monitoring & Metrics
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 5-6 hours

#### Subtasks:
- [ ] **4.2.1** Setup Prometheus metrics
  - Install prom-client package
  - Create metrics endpoint GET /metrics
  - Define counters: requests, blocked requests
  - Define histograms: latency
  - Define gauges: Redis connection status

- [ ] **4.2.2** Instrument rate limiter
  - Count total requests per endpoint
  - Count blocked requests per reason
  - Measure rate limit check latency
  - Track Redis operation times

- [ ] **4.2.3** Setup health check metrics
  - Redis connection status
  - Memory usage
  - CPU usage
  - Response time

- [ ] **4.2.4** Create Prometheus config
  - Create `monitoring/prometheus.yml`
  - Configure scrape targets
  - Set scrape interval (15s)
  - Add to docker-compose

- [ ] **4.2.5** Setup Grafana
  - Add Grafana to docker-compose
  - Create datasource for Prometheus
  - Import dashboard template
  - Configure alerts

- [ ] **4.2.6** Create custom dashboard
  - Request rate over time
  - Block rate over time
  - Top blocked IPs
  - Latency percentiles (p50, p95, p99)
  - Redis health

**Files to Create:**
- `backend/src/services/metrics.js`
- `monitoring/prometheus.yml`
- `monitoring/grafana/dashboards/rate-limiter.json`

**Files to Modify:**
- `docker-compose.yml` - add Prometheus and Grafana
- `backend/src/middleware/rateLimiter.js` - add metrics
- `backend/src/routes/admin.js` - add /metrics endpoint

**Validation:**
- [ ] /metrics endpoint returns Prometheus format
- [ ] Metrics are accurate
- [ ] Grafana dashboard displays data
- [ ] Historical data is retained

---

### Task 4.3: Alerting System
**Status:** ⏳ Not Started  
**Priority:** P1  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **4.3.1** Define alert rules
  - High block rate (>100/min for 2min)
  - Redis connection lost
  - High authentication failures (>10/min)
  - High API latency (p99 >10ms)
  - Low Redis memory

- [ ] **4.3.2** Configure Prometheus alerts
  - Create `monitoring/alerts.yml`
  - Define alert conditions
  - Set severity levels
  - Add annotations and descriptions

- [ ] **4.3.3** Setup alert manager
  - Add AlertManager to docker-compose
  - Configure notification channels (email, Slack)
  - Set up routing rules
  - Test alert delivery

- [ ] **4.3.4** Create alert webhook endpoint
  - Create POST /admin/alerts/webhook
  - Receive alerts from AlertManager
  - Store in Redis for dashboard display
  - Forward to external systems

- [ ] **4.3.5** Add alerts UI in dashboard
  - Create `frontend/src/pages/Alerts.jsx`
  - Display active alerts
  - Alert history
  - Acknowledge/resolve alerts

**Files to Create:**
- `monitoring/alerts.yml`
- `monitoring/alertmanager.yml`
- `backend/src/routes/alerts.js`
- `frontend/src/pages/Alerts.jsx`

**Validation:**
- [ ] Alerts trigger correctly
- [ ] Notifications are received
- [ ] Dashboard shows alerts
- [ ] Alerts can be acknowledged

---

### Task 4.4: Logging Enhancements
**Status:** ⏳ Not Started  
**Priority:** P1  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **4.4.1** Setup structured logging
  - Ensure all logs are JSON format
  - Add correlation IDs to requests
  - Include user context in logs
  - Add log levels correctly

- [ ] **4.4.2** Implement log aggregation
  - Add Loki to docker-compose
  - Configure log shipping
  - Create log queries
  - Test log search

- [ ] **4.4.3** Add security event logging
  - Log all authentication attempts
  - Log authorization failures
  - Log rate limit violations
  - Log admin actions

- [ ] **4.4.4** Create log viewer in UI
  - Add to dashboard (optional)
  - Filter by level, time, user
  - Search functionality
  - Export logs

**Files to Create:**
- `monitoring/loki-config.yml`
- `monitoring/promtail-config.yml`

**Files to Modify:**
- `docker-compose.yml` - add Loki and Promtail
- `backend/src/utils/logger.js` - ensure structured format

**Validation:**
- [ ] Logs appear in Loki
- [ ] Log queries work
- [ ] Correlation IDs work across services
- [ ] Security events are logged

---

### Task 4.5: Performance Testing
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **4.5.1** Setup k6 load testing
  - Install k6
  - Create test scenarios
  - Test: 100 req/s, 1000 req/s, 10000 req/s
  - Test rate limiting behavior under load

- [ ] **4.5.2** Run load tests
  - Test with Redis available
  - Test with Redis unavailable (failover)
  - Test concurrent users
  - Measure latency percentiles

- [ ] **4.5.3** Analyze results
  - Check p95/p99 latency (<10ms target)
  - Verify no errors under load
  - Check Redis memory usage
  - Identify bottlenecks

- [ ] **4.5.4** Optimize performance
  - Add Redis connection pooling if needed
  - Optimize hot code paths
  - Add caching where appropriate
  - Tune Redis configuration

**Files to Create:**
- `tests/load/k6-scenarios.js`
- `tests/load/README.md`

**Validation:**
- [ ] System handles 10k req/s
- [ ] p99 latency < 10ms
- [ ] No errors under load
- [ ] Redis stable under load

---

### Task 4.6: Week 4 Security Audit
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **4.6.1** Run OWASP ZAP scan
  - Install OWASP ZAP
  - Configure target
  - Run automated scan
  - Review findings

- [ ] **4.6.2** Manual security testing
  - Test for SQL injection
  - Test for XSS
  - Test for CSRF
  - Test authentication bypass
  - Test authorization bypass
  - Test rate limit bypass

- [ ] **4.6.3** Dependency audit
  - Run `npm audit`
  - Review vulnerable dependencies
  - Update or patch vulnerabilities
  - Document accepted risks

- [ ] **4.6.4** Review security checklist
  - Go through TRD security checklist
  - Verify all controls implemented
  - Document any exceptions
  - Create remediation plan for gaps

**Week 4 Deliverables:**
- ✅ Security hardening complete
- ✅ Monitoring and metrics
- ✅ Alerting system
- ✅ Performance tested and optimized
- ✅ Security audit completed
- ✅ Production-ready system

---

## 🚀 Phase 5: Testing, Documentation & Deployment (Week 5)

**Goal:** Comprehensive testing, documentation, and production deployment

### Task 5.1: Comprehensive Testing
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 6-7 hours

#### Subtasks:
- [ ] **5.1.1** Write comprehensive unit tests
  - Test all services
  - Test all middleware
  - Test all validators
  - Target: 80%+ coverage

- [ ] **5.1.2** Write integration tests
  - Test full API flows
  - Test authentication flows
  - Test rate limiting scenarios
  - Test error handling

- [ ] **5.1.3** Write E2E tests
  - Install Playwright or Cypress
  - Test login flow
  - Test rule creation flow
  - Test IP blocking flow
  - Test dashboard interactions

- [ ] **5.1.4** Test edge cases
  - Test Redis failure scenarios
  - Test network timeouts
  - Test malformed requests
  - Test race conditions

- [ ] **5.1.5** Test browser compatibility
  - Test on Chrome
  - Test on Firefox
  - Test on Safari
  - Test on mobile browsers

- [ ] **5.1.6** Test accessibility
  - Run Lighthouse audit
  - Test screen reader
  - Test keyboard navigation
  - Fix accessibility issues

**Files to Create:**
- `backend/src/__tests__/unit/*.test.js`
- `backend/src/__tests__/integration/*.test.js`
- `frontend/cypress/e2e/*.cy.js` or `tests/e2e/*.spec.js`

**Validation:**
- [ ] All tests pass
- [ ] Code coverage >80%
- [ ] No critical accessibility issues
- [ ] Works on all browsers

---

### Task 5.2: Documentation
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 5-6 hours

#### Subtasks:
- [ ] **5.2.1** Complete API documentation
  - Create OpenAPI/Swagger spec
  - Document all endpoints
  - Add request/response examples
  - Generate API docs with Swagger UI

- [ ] **5.2.2** Write deployment guide
  - Create `docs/DEPLOYMENT.md`
  - Docker deployment steps
  - Environment configuration
  - SSL/TLS setup
  - Backup procedures

- [ ] **5.2.3** Write operations runbook
  - Create `docs/RUNBOOK.md`
  - Common operations
  - Troubleshooting guide
  - Incident response procedures
  - Monitoring and alerting

- [ ] **5.2.4** Write user guide
  - Create `docs/USER_GUIDE.md`
  - How to create rules
  - How to block IPs
  - How to read logs
  - How to interpret metrics

- [ ] **5.2.5** Update README
  - Add architecture diagram
  - Add quick start guide
  - Add feature list
  - Add screenshots
  - Add badges (build, coverage)

- [ ] **5.2.6** Add inline code documentation
  - JSDoc for all public functions
  - Component prop documentation
  - Complex logic explanations
  - Generate API reference docs

**Files to Create:**
- `docs/API.md` or `openapi.yaml`
- `docs/DEPLOYMENT.md`
- `docs/RUNBOOK.md`
- `docs/USER_GUIDE.md`
- `docs/ARCHITECTURE.md`

**Files to Modify:**
- `README.md` - comprehensive project README

**Validation:**
- [ ] API docs are complete
- [ ] Deployment guide tested
- [ ] Runbook covers common scenarios
- [ ] User guide is clear

---

### Task 5.3: Production Configuration
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **5.3.1** Create production Docker images
  - Optimize Dockerfile (multi-stage build)
  - Minimize image size
  - Security scan with Trivy
  - Push to container registry

- [ ] **5.3.2** Create production docker-compose
  - Create `docker-compose.prod.yml`
  - Remove dev tools
  - Add restart policies
  - Configure resource limits
  - Add health checks

- [ ] **5.3.3** Setup secrets management
  - Remove hardcoded secrets
  - Use Docker secrets or env vars
  - Document secret generation
  - Create secret rotation procedure

- [ ] **5.3.4** Configure SSL/TLS
  - Generate SSL certificates (Let's Encrypt)
  - Configure TLS in docker-compose
  - Enforce HTTPS redirects
  - Test SSL configuration

- [ ] **5.3.5** Setup backup procedures
  - Create Redis backup script
  - Schedule automated backups
  - Test restore procedure
  - Document backup policy

- [ ] **5.3.6** Configure log rotation
  - Setup log rotation for all services
  - Configure retention policies
  - Test log rotation

**Files to Create:**
- `docker-compose.prod.yml`
- `scripts/backup.sh`
- `scripts/restore.sh`
- `.env.production.example`

**Validation:**
- [ ] Production images build successfully
- [ ] SSL/TLS works correctly
- [ ] Secrets not in source code
- [ ] Backups work
- [ ] Log rotation works

---

### Task 5.4: Deployment
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **5.4.1** Prepare production server
  - Provision server (cloud or on-premise)
  - Install Docker and Docker Compose
  - Configure firewall rules
  - Setup monitoring agent

- [ ] **5.4.2** Deploy application
  - Clone repository
  - Set environment variables
  - Generate secrets
  - Run docker-compose up
  - Verify all services healthy

- [ ] **5.4.3** Configure reverse proxy
  - Setup Nginx or Traefik
  - Configure SSL termination
  - Setup rate limiting at proxy level
  - Configure load balancing (if needed)

- [ ] **5.4.4** Setup domain and DNS
  - Configure DNS records
  - Point domain to server
  - Verify DNS propagation
  - Test HTTPS access

- [ ] **5.4.5** Configure monitoring
  - Connect to monitoring service
  - Setup alert destinations
  - Test alerts
  - Create runbook links

- [ ] **5.4.6** Smoke test production
  - Test all critical flows
  - Create test rate limit rule
  - Test rate limiting
  - Test admin dashboard
  - Verify metrics collection

**Validation:**
- [ ] Application accessible via HTTPS
- [ ] All services running
- [ ] Monitoring active
- [ ] Alerts working
- [ ] No errors in logs

---

### Task 5.5: CI/CD Pipeline
**Status:** ⏳ Not Started  
**Priority:** P1  
**Estimated Time:** 4-5 hours

#### Subtasks:
- [ ] **5.5.1** Setup GitHub Actions
  - Create `.github/workflows/ci.yml`
  - Run tests on pull requests
  - Run linter
  - Check code coverage

- [ ] **5.5.2** Add build workflow
  - Build Docker images
  - Tag with commit SHA
  - Push to container registry
  - Create GitHub release

- [ ] **5.5.3** Add deploy workflow
  - Deploy to staging on merge to main
  - Manual approval for production
  - Run smoke tests after deploy
  - Rollback on failure

- [ ] **5.5.4** Add security scanning
  - Run npm audit
  - Run Snyk or Trivy scan
  - Fail build on critical vulnerabilities
  - Create security report

**Files to Create:**
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/security.yml`

**Validation:**
- [ ] CI runs on PRs
- [ ] CD deploys automatically
- [ ] Security scans run
- [ ] All workflows pass

---

### Task 5.6: Final Review & Launch
**Status:** ⏳ Not Started  
**Priority:** P0  
**Estimated Time:** 3-4 hours

#### Subtasks:
- [ ] **5.6.1** Final code review
  - Review all code changes
  - Check for TODOs
  - Verify error handling
  - Check for hardcoded values

- [ ] **5.6.2** Security review
  - Review security checklist
  - Verify all secrets secure
  - Check OWASP Top 10
  - Review audit logs

- [ ] **5.6.3** Performance review
  - Check latency targets met
  - Verify scalability
  - Check resource usage
  - Optimize if needed

- [ ] **5.6.4** Documentation review
  - Verify all docs complete
  - Test all examples
  - Fix broken links
  - Update screenshots

- [ ] **5.6.5** Create launch checklist
  - Verify production ready
  - Check monitoring
  - Check backups
  - Check disaster recovery plan

- [ ] **5.6.6** Launch! 🚀
  - Announce to team
  - Monitor closely first 24h
  - Fix any issues
  - Celebrate success! 🎉

**Week 5 Deliverables:**
- ✅ Comprehensive test suite
- ✅ Complete documentation
- ✅ Production deployment
- ✅ CI/CD pipeline
- ✅ Monitoring and alerting active
- ✅ System launched and stable

---

## 📝 Appendix

### Development Best Practices

#### Git Commit Convention
```
<type>(<scope>): <subject>

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code restructuring
- test: Add tests
- chore: Maintenance
```

#### Code Review Checklist
- [ ] Code follows project style
- [ ] No console.logs
- [ ] Error handling present
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No security issues
- [ ] Performance considered

#### Testing Strategy
| Test Type | Coverage | When to Run |
|-----------|----------|-------------|
| Unit | 80%+ | On every commit |
| Integration | Critical paths | Before merge |
| E2E | User flows | Before deploy |
| Load | Performance | Weekly |
| Security | OWASP Top 10 | Before release |

### Progress Tracking

Track your progress by marking tasks complete:
- ✅ = Completed
- 🔄 = In Progress
- ⏳ = Not Started
- ⚠️ = Blocked

### Resources

- [PRD](docs/PRD.md) - Product Requirements
- [TRD](docs/TRD.md) - Technical Requirements
- [GitHub Repo](https://github.com/shiv-0101/Ratetui)

### Support

For questions or issues:
1. Check documentation
2. Review relevant PRD/TRD section
3. Search existing issues
4. Create new issue with details

---

**Remember:** Build incrementally, test continuously, document thoroughly. Good luck! 🚀
