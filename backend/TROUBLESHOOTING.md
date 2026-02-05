# Troubleshooting Guide

## Common Issues and Solutions

---

## Server Won't Start

### Issue: Port Already in Use

**Error:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:**

**Option 1: Kill the process using the port**
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

**Option 2: Use a different port**
```env
# .env
PORT=3001
```

---

### Issue: Module Not Found

**Error:**
```
Error: Cannot find module 'express'
```

**Solution:**
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

---

## Redis Connection Issues

### Issue: Redis Connection Refused

**Error:**
```
Redis: Connection error ECONNREFUSED
```

**Solution:**

**Check if Redis is running:**
```bash
docker ps
```

**Start Redis:**
```bash
docker compose up redis -d
```

**Verify Redis connection:**
```bash
docker exec -it ratetui-redis redis-cli ping
# Should return: PONG
```

**Check Redis logs:**
```bash
docker logs ratetui-redis
```

---

### Issue: Redis Authentication Failed

**Error:**
```
Redis: NOAUTH Authentication required
```

**Solution:**

**Update `.env` with Redis password:**
```env
REDIS_PASSWORD=your-redis-password
```

**Or remove password from Redis:**
```bash
# docker-compose.yml
redis:
  image: redis:7-alpine
  # Remove: command: redis-server --requirepass yourpassword
```

---

### Issue: System Works But Redis Shows Unhealthy

**Symptom:** API works, but `/health/detailed` shows Redis unhealthy

**Explanation:** This is expected behavior in **open failure mode**

**What's Happening:**
- Redis is unavailable
- Failure mode is set to "open" (default)
- System allows all requests (no rate limiting)
- Health status shows "degraded"

**To Fix (if you want strict rate limiting):**
```env
# .env
REDIS_FAILURE_MODE=closed
```

**In closed mode:**
- Redis unavailable = All requests blocked (503 error)
- More secure, but less available

---

## Rate Limiting Issues

### Issue: Rate Limit Headers Not Appearing

**Symptom:** No `X-RateLimit-*` headers in response

**Possible Causes:**

**1. Redis is down (open failure mode):**
```bash
# Check Redis
docker ps
curl http://localhost:3000/health/detailed
```

**Solution:** Start Redis
```bash
docker compose up redis -d
```

**2. Health check endpoint (no rate limiting):**
- `/health` endpoints are NOT rate limited
- Use `/api/*` endpoints to test rate limiting

---

### Issue: Rate Limit Not Enforcing

**Symptom:** Can make unlimited requests without 429 error

**Possible Causes:**

**1. Redis unavailable in open mode:**
```bash
# Check Redis status
curl http://localhost:3000/health/detailed
```

**2. Rate limit is too high:**
- Default is 200 req/min
- Make 201+ requests quickly to hit limit

**Solution:** Use stricter endpoint
```bash
# Expensive endpoint: 10 req/min
for i in {1..15}; do curl http://localhost:3000/api/expensive; done
# Should see 429 after 10 requests
```

---

### Issue: IP Address Not Detected Correctly

**Symptom:** All requests show same IP or wrong IP

**Solution:**

**Configure trust proxy:**
```env
# .env
TRUST_PROXY=loopback
```

**Behind proxy/load balancer:**
```env
TRUST_PROXY=linklocal,uniquelocal
# Or specific IPs
TRUST_PROXY=10.0.0.1,10.0.0.2
```

**Check IP extraction:**
```bash
curl http://localhost:3000/api/status
# Check clientInfo.ip in response
```

---

## Testing Issues

### Issue: Tests Fail with ECONNREFUSED

**Error:**
```
Redis: Connection error {"code":"ECONNREFUSED"}
```

**Explanation:** Tests run without Redis (expected behavior)

**What Happens:**
- Redis connection fails
- System operates in "open" failure mode
- Tests pass because API still works
- This validates graceful degradation

**Not an Issue:** This is intentional - tests verify the system works even when Redis is unavailable

---

### Issue: Jest Doesn't Exit

**Warning:**
```
Jest did not exit one second after the test run has completed.
```

**Solution:**

**Add to Jest config:**
```json
// package.json
{
  "jest": {
    "testEnvironment": "node",
    "forceExit": true,
    "detectOpenHandles": true
  }
}
```

**Or run with flag:**
```bash
npm test -- --forceExit
```

---

### Issue: Test Timeout Errors

**Error:**
```
Exceeded timeout of 5000 ms for a test
```

**Solution:**

**Increase timeout for slow tests:**
```javascript
test('slow operation', async () => {
  // Your test
}, 10000); // 10 second timeout
```

**Or globally:**
```json
// package.json jest config
{
  "testTimeout": 10000
}
```

---

## Docker Issues

### Issue: Docker Compose Not Found

**Error:**
```
docker compose: command not found
```

**Solution:**

**Use older syntax:**
```bash
docker-compose up -d
```

**Or update Docker:**
```bash
# Docker Desktop includes docker compose
# Download from docker.com
```

---

### Issue: Permission Denied (Linux)

**Error:**
```
permission denied while trying to connect to Docker daemon
```

**Solution:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Logout and login again
# Or run with sudo
sudo docker compose up -d
```

---

## Environment Issues

### Issue: Environment Variables Not Loading

**Symptom:** Server uses default values, ignores `.env`

**Solution:**

**1. Verify `.env` exists:**
```bash
ls -la backend/.env
```

**2. Check `.env` format:**
```env
# Correct
PORT=3000
NODE_ENV=development

# Wrong (no spaces around =)
PORT = 3000
NODE_ENV = development
```

**3. Restart server after changing `.env`**

---

### Issue: JWT Secret Not Set

**Error:**
```
JWT_SECRET must be defined
```

**Solution:**

**Generate secure secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Add to `.env`:**
```env
JWT_SECRET=<generated-secret-from-above>
```

---

## Performance Issues

### Issue: Slow Response Times

**Symptom:** API responses take > 1 second

**Check:**

**1. Redis latency:**
```bash
curl http://localhost:3000/health/detailed
# Check components.redis.latency
```

**2. Network:**
```bash
# Test Redis directly
docker exec -it ratetui-redis redis-cli ping
```

**3. Server load:**
```bash
# Check health endpoint
curl http://localhost:3000/health/detailed
# Check memory usage
```

**Solutions:**
- Increase Redis memory: Edit `docker-compose.yml` → `maxmemory 512mb`
- Enable Redis persistence: Already configured with AOF
- Scale horizontally: Add more server instances

---

### Issue: Memory Usage High

**Symptom:** Memory usage grows continuously

**Check:**
```bash
curl http://localhost:3000/health/detailed
# Check memory.heapUsed and memory.rss
```

**Solutions:**

**1. Restart server periodically**
```bash
# Use process manager like PM2
npm install -g pm2
pm2 start src/index.js --name ratetui
pm2 restart ratetui
```

**2. Limit Redis memory:**
```yaml
# docker-compose.yml
redis:
  command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

---

## Security Issues

### Issue: CORS Errors

**Error (Browser):**
```
Access to fetch at 'http://localhost:3000/api/data' from origin 
'http://localhost:5173' has been blocked by CORS policy
```

**Solution:**

**Add origin to `.env`:**
```env
CORS_ORIGINS=http://localhost:5173,http://localhost:3001
```

**For development (allow all):**
```env
# .env
NODE_ENV=development
# CORS allows all origins in development
```

---

### Issue: X-Forwarded-For Validation Fails

**Error:**
```
Invalid IP in X-Forwarded-For header
```

**Solution:**

**Behind proxy:**
```env
TRUST_PROXY=loopback,linklocal
```

**Check IP extraction:**
```bash
curl http://localhost:3000/api/status
# Check clientInfo.ip
```

---

## Logging Issues

### Issue: No Logs Appearing

**Symptom:** Server runs but no console output

**Check:**

**1. Log level:**
```env
# .env
LOG_LEVEL=debug
```

**2. Test mode:**
```bash
# Logs are disabled in test mode
NODE_ENV=development npm run dev
```

**3. Verify logger:**
```bash
curl http://localhost:3000/api/data
# Should see request logs
```

---

### Issue: Request ID Not in Logs

**Symptom:** Logs don't show `X-Request-ID`

**Solution:**

**Check response headers:**
```bash
curl -I http://localhost:3000/api/data
# Should see: X-Request-ID: <uuid>
```

**If missing:**
- Request logging middleware may not be loaded
- Check `src/index.js` includes `addRequestId` middleware

---

## Database Issues (Week 2+)

*Coming soon when authentication system is added*

---

## Development Tips

### Useful Commands

```bash
# Watch logs in real-time
docker logs -f ratetui-redis

# Check Redis keys
docker exec -it ratetui-redis redis-cli
> KEYS *
> GET ratelimit:ip:127.0.0.1

# Monitor Redis in real-time
docker exec -it ratetui-redis redis-cli MONITOR

# Check server memory
curl http://localhost:3000/health/detailed | jq '.memory'

# Test rate limiting
for i in {1..15}; do curl -w "\nStatus: %{http_code}\n" http://localhost:3000/api/expensive; done
```

### Debug Mode

**Enable verbose logging:**
```env
LOG_LEVEL=debug
NODE_ENV=development
```

**Check detailed health:**
```bash
watch -n 2 'curl -s http://localhost:3000/health/detailed | jq'
```

---

## Getting Help

1. **Check logs:** Server logs usually contain the error details
2. **Test health endpoint:** `curl http://localhost:3000/health/detailed`
3. **Verify environment:** Check `.env` file has all required variables
4. **Check Redis:** Ensure Redis is running and accessible
5. **Review documentation:** [API.md](API.md) for endpoint details

**Still stuck?**
- Open an issue on GitHub
- Check existing issues for similar problems

---

## System Requirements

**Minimum:**
- 2 CPU cores
- 2GB RAM
- 1GB free disk space

**Recommended:**
- 4 CPU cores
- 4GB RAM
- 5GB free disk space (for logs and Redis persistence)

**Production:**
- 8 CPU cores
- 16GB RAM
- 50GB SSD
- Redis cluster for high availability

---

## Healthcheck Reference

| Endpoint | Purpose | Expected Response | Kubernetes Use |
|----------|---------|-------------------|----------------|
| `/health` | Basic check | Always 200 | Not recommended |
| `/health/live` | Process alive | Always 200 | Liveness probe |
| `/health/ready` | Ready to serve | 200 if Redis up | Readiness probe |
| `/health/detailed` | Full diagnostics | 200/503 degraded | Monitoring only |

**Kubernetes Example:**
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

---

## Rate Limit Troubleshooting

### Testing Rate Limits

**Quick test (should get 429):**
```bash
# Expensive endpoint: 10 req/min
for i in {1..12}; do 
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" http://localhost:3000/api/expensive
done
```

**Expected output:**
```
Request 1: 200
Request 2: 200
...
Request 10: 200
Request 11: 429  ← Rate limit exceeded
Request 12: 429
```

**Check remaining requests:**
```bash
curl -I http://localhost:3000/api/data | grep -i ratelimit
```

---

## Need More Help?

- **API Documentation:** See [API.md](API.md)
- **Setup Guide:** See [SETUP.md](SETUP.md)
- **Development Roadmap:** See [../ROADMAP.md](../ROADMAP.md)
- **PRD:** See [../docs/PRD.md](../docs/PRD.md)
- **TRD:** See [../docs/TRD.md](../docs/TRD.md)
