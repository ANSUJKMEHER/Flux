-- Token Bucket Rate Limiter (Lua script for Redis)
-- KEYS[1] = rate limit key (hash)
-- ARGV[1] = rate (tokens per second)
-- ARGV[2] = burst (max bucket size)
-- ARGV[3] = optional client now (fallback if TIME unavailable)
--
-- Returns: {allowed (0/1), tokens_remaining, retry_after_ms}

local key = KEYS[1]
local rate = tonumber(ARGV[1]) or 0
local burst = tonumber(ARGV[2]) or 0

-- Obtain monotonic server time directly from Redis to eliminate host clock skew
local redis_time = redis.call("TIME")
local now = tonumber(redis_time[1]) * 1000000 + tonumber(redis_time[2])

-- Read current state
local tokens = tonumber(redis.call("HGET", key, "tokens"))
local last_refill = tonumber(redis.call("HGET", key, "last_refill"))

-- Initialize on first request
if tokens == nil then
    tokens = burst
    last_refill = now
end

-- Calculate token refill based on elapsed time, clamped against backward clock adjustments
local elapsed = now - last_refill
if elapsed < 0 then
    elapsed = 0
end

if rate > 0 then
    local refill = (elapsed / 1000000.0) * rate
    tokens = math.min(burst, tokens + refill)
    last_refill = now
end

-- Compute TTL safely avoiding division by zero
local expire_ttl = 3600
if rate > 0 then
    expire_ttl = math.max(60, math.ceil(burst / rate) + 1)
end

-- Attempt to consume one token
if tokens >= 1 then
    tokens = tokens - 1
    redis.call("HSET", key, "tokens", tokens, "last_refill", last_refill)
    redis.call("EXPIRE", key, expire_ttl)
    return {1, math.floor(tokens), 0}
else
    -- Denied: compute retry-after in milliseconds
    local retry_after_ms = 1000
    if rate > 0 then
        local deficit = 1 - tokens
        retry_after_ms = math.max(1, math.ceil((deficit / rate) * 1000))
    else
        retry_after_ms = 60000
    end
    redis.call("HSET", key, "tokens", tokens, "last_refill", last_refill)
    redis.call("EXPIRE", key, expire_ttl)
    return {0, 0, retry_after_ms}
end
