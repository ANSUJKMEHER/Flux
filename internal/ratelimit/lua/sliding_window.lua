-- Sliding Window Log Rate Limiter (Lua script for Redis)
-- KEYS[1] = rate limit key (sorted set)
-- ARGV[1] = max_requests (max allowed in window)
-- ARGV[2] = window_us (window size in microseconds)
-- ARGV[3] = optional client now
-- ARGV[4] = request_id (unique identifier for this request)
--
-- Returns: {allowed (0/1), current_count, retry_after_ms}

local key = KEYS[1]
local max_requests = tonumber(ARGV[1]) or 0
local window_us = tonumber(ARGV[2]) or 0
local request_id = ARGV[4]

-- Obtain monotonic server time directly from Redis
local redis_time = redis.call("TIME")
local now = tonumber(redis_time[1]) * 1000000 + tonumber(redis_time[2])

-- Remove entries older than the window
local window_start = now - window_us
redis.call("ZREMRANGEBYSCORE", key, "-inf", window_start)

-- Count current entries in window
local current_count = redis.call("ZCARD", key)

if current_count < max_requests then
    -- Allowed: add this request's timestamp
    redis.call("ZADD", key, now, request_id)
    redis.call("PEXPIRE", key, math.ceil(window_us / 1000))
    return {1, current_count + 1, 0}
else
    -- Denied: compute retry-after from oldest entry
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    local retry_after_ms = 0
    if #oldest >= 2 then
        local oldest_ts = tonumber(oldest[2])
        local expire_at = oldest_ts + window_us
        retry_after_ms = math.ceil((expire_at - now) / 1000)
        if retry_after_ms < 0 then
            retry_after_ms = 0
        end
    end
    -- Do NOT refresh PEXPIRE on denied requests to prevent permanent key retention memory leak
    return {0, current_count, retry_after_ms}
end
