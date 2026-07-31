-- Token Bucket Rate Limiter (Lua script for Redis)
-- KEYS[1] = rate limit key (hash)
-- ARGV[1] = rate (tokens per second)
-- ARGV[2] = burst (max bucket size)
-- ARGV[3] = now (current time in microseconds)
--
-- Returns: {allowed (0/1), tokens_remaining, retry_after_ms}

local key = KEYS[1]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Read current state
local tokens = tonumber(redis.call("HGET", key, "tokens"))
local last_refill = tonumber(redis.call("HGET", key, "last_refill"))

-- Initialize on first request
if tokens == nil then
    tokens = burst
    last_refill = now
end

-- Calculate token refill based on elapsed time
local elapsed = now - last_refill  -- microseconds
local refill = (elapsed / 1000000.0) * rate  -- tokens to add
tokens = math.min(burst, tokens + refill)
last_refill = now

-- Attempt to consume one token
if tokens >= 1 then
    tokens = tokens - 1
    redis.call("HSET", key, "tokens", tokens, "last_refill", last_refill)
    redis.call("EXPIRE", key, math.ceil(burst / rate) + 1)
    return {1, math.floor(tokens), 0}
else
    -- Denied: compute retry-after in milliseconds
    local deficit = 1 - tokens
    local retry_after_ms = math.ceil((deficit / rate) * 1000)
    redis.call("HSET", key, "tokens", tokens, "last_refill", last_refill)
    redis.call("EXPIRE", key, math.ceil(burst / rate) + 1)
    return {0, 0, retry_after_ms}
end
