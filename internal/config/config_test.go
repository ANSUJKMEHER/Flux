package config

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestParseYAML_Valid(t *testing.T) {
	yamlData := []byte(`
server:
  listen_addr: ":8080"
redis:
  addr: "localhost:6379"
auth:
  mode: "api_key"
  api_keys:
    "key-1": "pro"
routes:
  - path_prefix: "/api/v1"
    pool: "default"
pools:
  default:
    strategy: "round_robin"
    upstreams:
      - id: "up-1"
        url: "http://localhost:9001"
`)

	cfg, err := ParseYAML(yamlData)
	if err != nil {
		t.Fatalf("unexpected error parsing valid yaml: %v", err)
	}

	if cfg.Server.ListenAddr != ":8080" {
		t.Errorf("got listen_addr %q, want :8080", cfg.Server.ListenAddr)
	}
	if cfg.Redis.PoolSize != 200 {
		t.Errorf("got default pool size %d, want 200", cfg.Redis.PoolSize)
	}
	if cfg.Breaker.FailureThreshold != 5 {
		t.Errorf("got failure threshold %d, want 5", cfg.Breaker.FailureThreshold)
	}
}

func TestParseYAML_InvalidValidation(t *testing.T) {
	tests := []struct {
		name string
		yaml string
	}{
		{
			name: "no routes",
			yaml: `
server:
  listen_addr: ":8080"
pools:
  default:
    upstreams: [{id: "u1", url: "http://u1"}]
`,
		},
		{
			name: "route missing pool",
			yaml: `
routes:
  - path_prefix: "/api"
pools:
  default:
    upstreams: [{id: "u1", url: "http://u1"}]
`,
		},
		{
			name: "invalid pool strategy",
			yaml: `
routes:
  - path_prefix: "/api"
    pool: "default"
pools:
  default:
    strategy: "magical_random"
    upstreams: [{id: "u1", url: "http://u1"}]
`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseYAML([]byte(tt.yaml))
			if err == nil {
				t.Errorf("expected error for %s, got nil", tt.name)
			}
		})
	}
}

func TestLoad_File(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "gateway.yaml")
	content := `
routes:
  - path_prefix: "/test"
    pool: "p1"
pools:
  p1:
    strategy: "round_robin"
    upstreams:
      - id: "u1"
        url: "http://localhost:8000"
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write temp config: %v", err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("failed to load config file: %v", err)
	}
	if len(cfg.Routes) != 1 || cfg.Routes[0].PathPrefix != "/test" {
		t.Errorf("unexpected loaded routes: %+v", cfg.Routes)
	}
}

func TestConfigHolder_ConcurrentAccess(t *testing.T) {
	cfg1 := &GatewayConfig{
		Server: ServerConfig{ListenAddr: ":8080"},
		Auth:   AuthConfig{Mode: "api_key", APIKeys: map[string]string{"k1": "tier1"}},
	}
	cfg2 := &GatewayConfig{
		Server: ServerConfig{ListenAddr: ":9090"},
		Auth:   AuthConfig{Mode: "api_key", APIKeys: map[string]string{"k2": "tier2"}},
	}

	holder := NewConfigHolder(cfg1)

	var wg sync.WaitGroup
	// 50 readers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 500; j++ {
				c := holder.Get()
				_ = c.Server.ListenAddr
				_ = c.Auth.APIKeys["k1"]
			}
		}()
	}

	// 10 writers swapping config
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				if (idx+j)%2 == 0 {
					holder.Swap(cfg1)
				} else {
					holder.Swap(cfg2)
				}
				time.Sleep(10 * time.Microsecond)
			}
		}(i)
	}

	wg.Wait()
}
