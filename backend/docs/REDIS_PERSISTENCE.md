# Redis Persistence Configuration

## Overview

Redis persistence is configured to ensure rate limit data survives container restarts and system failures. This document explains the persistence mechanisms in place.

## Persistence Methods

### 1. AOF (Append Only File)

**Status:** ✅ Enabled

AOF logs every write operation to a file, allowing complete reconstruction of the dataset.

**Configuration:**
```properties
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
```

**Benefits:**
- Most durable persistence option
- Minimal data loss (max 1 second of data)
- Automatic AOF rewriting to optimize file size
- Good performance with `everysec` fsync policy

**Trade-offs:**
- Slightly larger file size than RDB
- Slower restart times with very large datasets

### 2. RDB (Snapshot)

**Status:** ✅ Enabled (Backup)

RDB creates point-in-time snapshots of the dataset.

**Configuration:**
```properties
# Auto-save triggers:
save 900 1      # After 15 min if ≥1 key changed
save 300 10     # After 5 min if ≥10 keys changed
save 60 10000   # After 1 min if ≥10000 keys changed

dbfilename dump.rdb
rdbcompression yes
stop-writes-on-bgsave-error yes
```

**Benefits:**
- Compact file size
- Fast restart times
- Good for backups and disaster recovery

**Trade-offs:**
- Can lose data between snapshots
- CPU spike during BGSAVE

## Data Durability Guarantees

| Scenario | Data Loss | Recovery |
|----------|-----------|----------|
| Graceful shutdown | None | Instant |
| Container restart | ≤1 second | ~1-2 seconds |
| System crash | ≤1 second | ~1-2 seconds |
| Redis crash | ≤1 second | Automatic |
| Volume corruption | Last RDB snapshot | Manual restore |

## Memory Management

### Eviction Policy

**Policy:** `allkeys-lru` (Least Recently Used)

When memory limit is reached, Redis removes the least recently used keys regardless of expiration.

**Configuration:**
```properties
maxmemory 256mb
maxmemory-policy allkeys-lru
maxmemory-samples 5
```

**Why allkeys-lru:**
- Perfect for rate limiting (ephemeral data)
- Automatic cleanup of old counters
- Prevents memory exhaustion
- No manual intervention needed

### Memory Optimization

Rate limiter counters are optimized using:
- Hash table compression for small sets
- Sorted set compression (used by rate-limiter-flexible)
- Automatic key expiration (TTL)

## Volume Configuration

### Docker Compose Volume

```yaml
volumes:
  redis-data:
    driver: local
```

The `redis-data` volume is mounted to `/data` in the Redis container, persisting:
- `appendonly.aof` (AOF file)
- `dump.rdb` (RDB snapshot)
- Any other Redis data files

### Volume Location

**Linux:** `/var/lib/docker/volumes/ratetui_redis-data/_data`  
**Windows:** `\\wsl$\docker-desktop-data\data\docker\volumes\ratetui_redis-data\_data`  
**macOS:** `~/Library/Containers/com.docker.docker/Data/vms/0/data/docker/volumes/ratetui_redis-data/_data`

## Testing Persistence

### Automated Test

Run the persistence test script:

```bash
cd backend
npm run test:persistence
```

This script:
1. ✅ Checks AOF/RDB configuration
2. ✅ Writes test data
3. ✅ Restarts Redis container
4. ✅ Verifies data survived restart
5. ✅ Measures recovery time

### Manual Test

```bash
# 1. Write test data
docker exec ratetui-redis redis-cli SET test:persistence "hello"

# 2. Restart container
docker compose restart redis

# 3. Wait for Redis to start
sleep 5

# 4. Verify data persists
docker exec ratetui-redis redis-cli GET test:persistence
# Should output: "hello"

# 5. Clean up
docker exec ratetui-redis redis-cli DEL test:persistence
```

## Monitoring Persistence

### Check Persistence Status

```bash
# Via health endpoint
curl http://localhost:3000/health/redis

# Direct Redis query
docker exec ratetui-redis redis-cli INFO persistence
```

### Key Metrics

| Metric | Description | Good Value |
|--------|-------------|------------|
| `aof_enabled` | AOF status | 1 |
| `aof_current_size` | AOF file size | < 100MB |
| `aof_last_write_status` | Last write status | ok |
| `rdb_last_save_time` | Last snapshot time | Recent |
| `rdb_last_bgsave_status` | Last save status | ok |

## Backup & Recovery

### Creating Backups

```bash
# Trigger manual snapshot
docker exec ratetui-redis redis-cli BGSAVE

# Copy RDB file
docker cp ratetui-redis:/data/dump.rdb ./backups/dump-$(date +%Y%m%d).rdb

# Copy AOF file
docker cp ratetui-redis:/data/appendonly.aof ./backups/appendonly-$(date +%Y%m%d).aof
```

### Restoring from Backup

```bash
# 1. Stop Redis
docker compose stop redis

# 2. Replace data files
docker cp ./backups/dump.rdb ratetui-redis:/data/dump.rdb
docker cp ./backups/appendonly.aof ratetui-redis:/data/appendonly.aof

# 3. Start Redis
docker compose start redis
```

## Troubleshooting

### AOF Write Errors

**Symptom:** Redis stops accepting writes

**Check:**
```bash
docker exec ratetui-redis redis-cli INFO persistence | grep aof_last_write_status
```

**Fix:**
```bash
# Check disk space
docker exec ratetui-redis df -h /data

# Check AOF file
docker exec ratetui-redis redis-cli BGREWRITEAOF
```

### Slow Startup

**Cause:** Large AOF file being replayed

**Check:**
```bash
docker logs ratetui-redis
```

**Fix:**
```bash
# Compact AOF when Redis is running
docker exec ratetui-redis redis-cli BGREWRITEAOF

# Wait for rewrite to complete
docker exec ratetui-redis redis-cli INFO persistence | grep aof_rewrite_in_progress
```

### Data Loss After Restart

**Possible Causes:**
1. AOF disabled
2. Volume not mounted
3. File permissions
4. Disk full

**Diagnosis:**
```bash
# Check AOF status
docker exec ratetui-redis redis-cli CONFIG GET appendonly

# Check volume mount
docker inspect ratetui-redis | grep Mounts -A 10

# Check file permissions
docker exec ratetui-redis ls -la /data

# Check disk space
docker exec ratetui-redis df -h
```

## Production Recommendations

### High Availability Setup

For production, consider:

1. **Redis Sentinel** (automatic failover)
2. **Redis Cluster** (horizontal scaling)
3. **Regular backups** (daily RDB snapshots)
4. **Monitoring alerts** (AOF write failures)
5. **Separate volumes** (for each Redis instance)

### Performance Tuning

```properties
# For high-throughput scenarios
appendfsync no           # Maximum performance (risk of data loss)

# For balanced performance
appendfsync everysec     # Recommended (default)

# For maximum durability
appendfsync always       # Slowest (no data loss)
```

### Backup Schedule

```bash
# Daily backup cron job
0 2 * * * docker exec ratetui-redis redis-cli BGSAVE && \
          docker cp ratetui-redis:/data/dump.rdb /backups/redis/dump-$(date +%Y%m%d).rdb
```

## References

- [Redis Persistence Documentation](https://redis.io/docs/management/persistence/)
- [AOF vs RDB](https://redis.io/docs/management/persistence/#aof-vs-rdb)
- [Redis Backup Guide](https://redis.io/docs/management/persistence/#backing-up-redis-data)

## Summary

✅ AOF enabled with `everysec` fsync  
✅ RDB snapshots for backup  
✅ LRU eviction for automatic memory management  
✅ Persistent volume for data durability  
✅ Automated testing available  
✅ Health monitoring integrated  

**Result:** Rate limit data persists across restarts with minimal data loss risk.
