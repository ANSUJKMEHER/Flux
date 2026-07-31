package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type Result struct {
	StatusCode int
	Duration   time.Duration
	Tier       string
	Route      string
	Err        error
}

func main() {
	targetURL := flag.String("url", "http://127.0.0.1:8085", "Target gateway URL")
	flag.Parse()

	fmt.Println("==========================================================")
	fmt.Println("🚀 RUNNING EMPIRICAL LOAD TEST (10 → 500 CONCURRENT VUs)")
	fmt.Println("==========================================================")

	// Start 3 mock services and 1 gateway sub-process
	mock1 := startService("users-1", "9001")
	mock2 := startService("users-2", "9002")
	mock3 := startService("orders-3", "9003")
	gwCmd := exec.Command("d:\\rate\\bin\\gateway.exe", "-config", "configs/gateway.yaml")
	gwCmd.Stdout = nil
	gwCmd.Stderr = nil
	if err := gwCmd.Start(); err != nil {
		fmt.Printf("Failed to start gateway: %v\n", err)
		return
	}
	defer func() {
		if mock1 != nil && mock1.Process != nil { mock1.Process.Kill() }
		if mock2 != nil && mock2.Process != nil { mock2.Process.Kill() }
		if mock3 != nil && mock3.Process != nil { mock3.Process.Kill() }
		if gwCmd != nil && gwCmd.Process != nil { gwCmd.Process.Kill() }
	}()

	time.Sleep(2 * time.Second)

	// High-performance HTTP client with connection pooling
	client := &http.Client{
		Transport: &http.Transport{
			MaxIdleConns:        1000,
			MaxIdleConnsPerHost: 500,
			IdleConnTimeout:     90 * time.Second,
		},
		Timeout: 5 * time.Second,
	}

	apiKeys := []struct {
		key  string
		tier string
	}{
		{"free-key-001", "free"},
		{"free-key-002", "free"},
		{"pro-key-001", "pro"},
		{"pro-key-002", "pro"},
		{"enterprise-key-001", "enterprise"},
	}

	routes := []string{
		"/api/v1/users",
		"/api/v1/users/123",
		"/api/v1/orders",
		"/api/v1/orders/456",
		"/api/v1/products",
	}

	stages := []struct {
		name     string
		duration time.Duration
		vus      int
	}{
		{"Ramp-up (10 -> 50 VUs)", 10 * time.Second, 50},
		{"Sustained Load (200 VUs)", 20 * time.Second, 200},
		{"Peak Load (500 VUs)", 30 * time.Second, 500},
		{"Ramp-down (50 VUs)", 10 * time.Second, 50},
	}

	var allResults []Result
	var resultsMu sync.Mutex

	var totalReqs atomic.Int64
	var totalErrs atomic.Int64

	startTime := time.Now()

	for _, stage := range stages {
		fmt.Printf("\n▶ Executing Stage: %s with %d concurrent VUs for %s...\n",
			stage.name, stage.vus, stage.duration)

		ctx, cancel := context.WithTimeout(context.Background(), stage.duration)
		var wg sync.WaitGroup

		stageResults := make([]Result, 0, stage.vus*100)
		var stageMu sync.Mutex

		for i := 0; i < stage.vus; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				rng := rand.New(rand.NewSource(time.Now().UnixNano()))

				for {
					select {
					case <-ctx.Done():
						return
					default:
						entry := apiKeys[rng.Intn(len(apiKeys))]
						route := routes[rng.Intn(len(routes))]

						req, err := http.NewRequestWithContext(ctx, "GET", *targetURL+route, nil)
						if err != nil {
							return
						}
						req.Header.Set("X-API-Key", entry.key)

						t0 := time.Now()
						resp, err := client.Do(req)
						dur := time.Since(t0)

						res := Result{
							Duration: dur,
							Tier:     entry.tier,
							Route:    route,
							Err:      err,
						}

						if err != nil {
							totalErrs.Add(1)
						} else {
							res.StatusCode = resp.StatusCode
							io.Copy(io.Discard, resp.Body)
							resp.Body.Close()
						}

						totalReqs.Add(1)

						stageMu.Lock()
						stageResults = append(stageResults, res)
						stageMu.Unlock()

						time.Sleep(time.Duration(rng.Intn(2)+1) * time.Millisecond)
					}
				}
			}()
		}

		wg.Wait()
		cancel()

		resultsMu.Lock()
		allResults = append(allResults, stageResults...)
		resultsMu.Unlock()
	}

	elapsed := time.Since(startTime)

	// Analyze results
	var validDurations []float64
	tierTotal := make(map[string]int)
	tier429 := make(map[string]int)
	statusCounts := make(map[int]int)

	for _, r := range allResults {
		if r.Err == nil {
			validDurations = append(validDurations, float64(r.Duration.Milliseconds()))
			statusCounts[r.StatusCode]++
			tierTotal[r.Tier]++
			if r.StatusCode == 429 {
				tier429[r.Tier]++
			}
		}
	}

	sort.Float64s(validDurations)

	p50 := 0.0
	p95 := 0.0
	p99 := 0.0
	if len(validDurations) > 0 {
		p50 = validDurations[int(float64(len(validDurations))*0.50)]
		p95 = validDurations[int(float64(len(validDurations))*0.95)]
		p99 = validDurations[int(float64(len(validDurations))*0.99)]
	}

	totalCount := totalReqs.Load()
	errCount := totalErrs.Load()
	rps := float64(totalCount) / elapsed.Seconds()

	fmt.Println("\n==========================================================")
	fmt.Println("📊 EMPIRICAL LOAD TEST RESULTS (EMPIRICAL VERIFIED DATA)")
	fmt.Println("==========================================================")
	fmt.Printf("Total Elapsed Time:      %.2f seconds\n", elapsed.Seconds())
	fmt.Printf("Total Requests Sent:     %d\n", totalCount)
	fmt.Printf("Sustained Throughput:    %.2f req/s\n", rps)
	fmt.Printf("Network/Transport Errors:%d (%.2f%%)\n", errCount, float64(errCount)/float64(totalCount)*100)
	fmt.Println("\n--- Latency Distribution ---")
	fmt.Printf("p50 Latency:             %.2f ms\n", p50)
	fmt.Printf("p95 Latency:             %.2f ms\n", p95)
	fmt.Printf("p99 Latency:             %.2f ms\n", p99)

	fmt.Println("\n--- HTTP Response Code Breakdown ---")
	for status, count := range statusCounts {
		fmt.Printf("HTTP %d: %d (%.2f%%)\n", status, count, float64(count)/float64(totalCount)*100)
	}

	fmt.Println("\n--- 429 Rate by Rate-Limit Tier ---")
	for _, tier := range []string{"free", "pro", "enterprise"} {
		tTot := tierTotal[tier]
		t429 := tier429[tier]
		rate := 0.0
		if tTot > 0 {
			rate = float64(t429) / float64(tTot) * 100
		}
		fmt.Printf("Tier %-10s: Total Reqs = %-6d | 429 Denied = %-6d | 429 Rate = %.2f%%\n",
			tier, tTot, t429, rate)
	}
	fmt.Println("==========================================================")
}

func startService(name, port string) *exec.Cmd {
	cmd := exec.Command("d:\\rate\\bin\\mockservice.exe")
	cmd.Env = append(os.Environ(), "MOCK_SERVICE_NAME="+name, "MOCK_PORT="+port)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		fmt.Printf("Failed to start mock %s: %v\n", name, err)
		return nil
	}
	return cmd
}
