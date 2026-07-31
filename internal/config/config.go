package config

import (
	"fmt"
	"os"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// GatewayConfig is the top-level configuration for the API gateway.
type GatewayConfig struct {
	Server   ServerConfig              `yaml:"server"`
	Admin    AdminConfig               `yaml:"admin"`
	Redis    RedisConfig               `yaml:"redis"`
	Auth     AuthConfig                `yaml:"auth"`
	Routes   []RouteConfig             `yaml:"routes"`
	Pools    map[string]UpstreamPool   `yaml:"pools"`
	RateLimits map[string]RateLimitTier `yaml:"rate_limits"`
	Breaker  BreakerConfig             `yaml:"breaker"`
	Health   HealthConfig              `yaml:"health"`
}

// ServerConfig holds the main listener settings.
type ServerConfig struct {
	ListenAddr     string        `yaml:"listen_addr"`
	ReadTimeout    time.Duration `yaml:"read_timeout"`
	WriteTimeout   time.Duration `yaml:"write_timeout"`
	DrainTimeout   time.Duration `yaml:"drain_timeout"`
}

// AdminConfig holds the admin API listener settings.
type AdminConfig struct {
	ListenAddr string `yaml:"listen_addr"`
	Enabled    bool   `yaml:"enabled"`
}

// RedisConfig holds the Redis connection settings.
type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
	PoolSize int    `yaml:"pool_size"`
}

// AuthConfig holds authentication settings.
type AuthConfig struct {
	Mode    string            `yaml:"mode"` // "api_key" or "jwt"
	APIKeys map[string]string `yaml:"api_keys"` // key -> tier name
	JWT     JWTConfig         `yaml:"jwt"`
}

// JWTConfig holds JWT-specific settings.
type JWTConfig struct {
	Secret       string `yaml:"secret"`
	TierClaim    string `yaml:"tier_claim"`    // JWT claim field for tier
	Issuer       string `yaml:"issuer"`
}

// RouteConfig defines a single routing rule.
type RouteConfig struct {
	PathPrefix   string `yaml:"path_prefix"`
	Host         string `yaml:"host,omitempty"`
	StripPrefix  bool   `yaml:"strip_prefix"`
	Pool         string `yaml:"pool"`             // upstream pool name
	RateLimitTier string `yaml:"rate_limit_tier"` // overrides auth-derived tier if set
	Algorithm    string `yaml:"algorithm,omitempty"` // "token_bucket" or "sliding_window"
}

// UpstreamPool defines a named group of upstream service instances.
type UpstreamPool struct {
	Strategy  string           `yaml:"strategy"` // "round_robin", "least_conn", "weighted", "power_of_two"
	Upstreams []UpstreamConfig `yaml:"upstreams"`
}

// UpstreamConfig defines a single upstream instance.
type UpstreamConfig struct {
	ID     string `yaml:"id"`
	URL    string `yaml:"url"`
	Weight int    `yaml:"weight"`
}

// RateLimitTier defines rate limit parameters for a named tier.
type RateLimitTier struct {
	Algorithm  string `yaml:"algorithm"` // "token_bucket" or "sliding_window"
	Rate       int    `yaml:"rate"`       // tokens per second (token bucket) or max requests (sliding window)
	Burst      int    `yaml:"burst"`      // max bucket size (token bucket only)
	Window     time.Duration `yaml:"window"` // window size (sliding window only)
}

// BreakerConfig holds circuit breaker settings (applied per upstream).
type BreakerConfig struct {
	FailureThreshold int           `yaml:"failure_threshold"` // consecutive failures to trip
	SuccessThreshold int           `yaml:"success_threshold"` // successes in half-open to close
	OpenTimeout      time.Duration `yaml:"open_timeout"`      // duration before transitioning to half-open
}

// HealthConfig holds health checker settings.
type HealthConfig struct {
	Interval    time.Duration `yaml:"interval"`     // how often to check
	Timeout     time.Duration `yaml:"timeout"`      // per-check timeout
	Path        string        `yaml:"path"`         // HTTP path to check
	Threshold   int           `yaml:"threshold"`    // consecutive failures to mark unhealthy
}

// Load reads and parses a YAML config file.
func Load(path string) (*GatewayConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read file %s: %w", path, err)
	}

	cfg := &GatewayConfig{}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("config: parse %s: %w", path, err)
	}

	setDefaults(cfg)

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config: validate: %w", err)
	}

	return cfg, nil
}

// setDefaults fills in zero-value fields with sensible defaults.
func setDefaults(cfg *GatewayConfig) {
	if cfg.Server.ListenAddr == "" {
		cfg.Server.ListenAddr = ":8080"
	}
	if cfg.Server.ReadTimeout == 0 {
		cfg.Server.ReadTimeout = 15 * time.Second
	}
	if cfg.Server.WriteTimeout == 0 {
		cfg.Server.WriteTimeout = 15 * time.Second
	}
	if cfg.Server.DrainTimeout == 0 {
		cfg.Server.DrainTimeout = 30 * time.Second
	}
	if cfg.Admin.ListenAddr == "" {
		cfg.Admin.ListenAddr = ":9091"
	}
	if cfg.Redis.Addr == "" {
		cfg.Redis.Addr = "localhost:6379"
	}
	if cfg.Redis.PoolSize == 0 {
		cfg.Redis.PoolSize = 10
	}
	if cfg.Auth.Mode == "" {
		cfg.Auth.Mode = "api_key"
	}
	if cfg.Breaker.FailureThreshold == 0 {
		cfg.Breaker.FailureThreshold = 5
	}
	if cfg.Breaker.SuccessThreshold == 0 {
		cfg.Breaker.SuccessThreshold = 3
	}
	if cfg.Breaker.OpenTimeout == 0 {
		cfg.Breaker.OpenTimeout = 30 * time.Second
	}
	if cfg.Health.Interval == 0 {
		cfg.Health.Interval = 10 * time.Second
	}
	if cfg.Health.Timeout == 0 {
		cfg.Health.Timeout = 2 * time.Second
	}
	if cfg.Health.Path == "" {
		cfg.Health.Path = "/health"
	}
	if cfg.Health.Threshold == 0 {
		cfg.Health.Threshold = 3
	}

	// Default pool strategy
	for name, pool := range cfg.Pools {
		if pool.Strategy == "" {
			pool.Strategy = "round_robin"
			cfg.Pools[name] = pool
		}
	}
}

// Validate checks the config for structural errors.
func (c *GatewayConfig) Validate() error {
	if len(c.Routes) == 0 {
		return fmt.Errorf("at least one route is required")
	}
	for i, r := range c.Routes {
		if r.PathPrefix == "" {
			return fmt.Errorf("route[%d]: path_prefix is required", i)
		}
		if r.Pool == "" {
			return fmt.Errorf("route[%d] (%s): pool is required", i, r.PathPrefix)
		}
		if _, ok := c.Pools[r.Pool]; !ok {
			return fmt.Errorf("route[%d] (%s): pool %q not found in pools", i, r.PathPrefix, r.Pool)
		}
	}
	for name, pool := range c.Pools {
		if len(pool.Upstreams) == 0 {
			return fmt.Errorf("pool %q: at least one upstream is required", name)
		}
		validStrategies := map[string]bool{
			"round_robin":    true,
			"least_conn":     true,
			"weighted":       true,
			"power_of_two":   true,
		}
		if !validStrategies[pool.Strategy] {
			return fmt.Errorf("pool %q: unknown strategy %q", name, pool.Strategy)
		}
	}
	validAuthModes := map[string]bool{"api_key": true, "jwt": true}
	if !validAuthModes[c.Auth.Mode] {
		return fmt.Errorf("auth: unknown mode %q (must be api_key or jwt)", c.Auth.Mode)
	}

	return nil
}

// ConfigHolder provides thread-safe access to a hot-reloadable config.
type ConfigHolder struct {
	mu  sync.RWMutex
	cfg *GatewayConfig
}

// NewConfigHolder wraps an initial config for concurrent access.
func NewConfigHolder(cfg *GatewayConfig) *ConfigHolder {
	return &ConfigHolder{cfg: cfg}
}

// Get returns the current config (read-locked).
func (h *ConfigHolder) Get() *GatewayConfig {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.cfg
}

// Swap atomically replaces the config (write-locked).
func (h *ConfigHolder) Swap(cfg *GatewayConfig) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.cfg = cfg
}
