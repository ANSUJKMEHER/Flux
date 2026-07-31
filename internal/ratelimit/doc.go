// Package ratelimit provides distributed rate limiting algorithms backed by Redis Lua scripts.
// Two algorithms are supported:
//   - Token Bucket: allows controlled bursts, good for general-purpose APIs
//   - Sliding Window Log: precise, no boundary spikes, good for strict/fairness-sensitive APIs
//
// Both algorithms run atomically in Redis via embedded Lua scripts, preventing race conditions
// under concurrent requests across multiple gateway instances.
package ratelimit
