package indexer

import (
	"math"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

func validCollectRequest() CollectRequest {
	return CollectRequest{
		DatasetID: "snapshot", DatasetVersion: "v1", Namespace: "base-sepolia",
		Asset:      domain.Asset{ChainID: domain.ChainID, TokenAddress: testTokenAddress, Symbol: "TKN", Decimals: 18},
		StartBlock: 10, EndBlock: 20,
	}
}

// TestCollectRequestValidation rejects malformed immutable inputs before any dependency is used.
func TestCollectRequestValidation(t *testing.T) {
	tests := map[string]func(*CollectRequest){
		"missing ID":        func(r *CollectRequest) { r.DatasetID = "" },
		"missing version":   func(r *CollectRequest) { r.DatasetVersion = "" },
		"missing namespace": func(r *CollectRequest) { r.Namespace = "" },
		"reversed range":    func(r *CollectRequest) { r.StartBlock, r.EndBlock = 20, 10 },
		"block overflow":    func(r *CollectRequest) { r.EndBlock = domain.BlockNumber(uint64(math.MaxInt64) + 1) },
		"wrong chain":       func(r *CollectRequest) { r.Asset.ChainID = 1 },
		"uppercase token":   func(r *CollectRequest) { r.Asset.TokenAddress = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
		"zero token":        func(r *CollectRequest) { r.Asset.TokenAddress = domain.ZeroAddress },
		"blank symbol":      func(r *CollectRequest) { r.Asset.Symbol = " " },
		"bad decimals":      func(r *CollectRequest) { r.Asset.Decimals = 256 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			request := validCollectRequest()
			mutate(&request)
			if err := request.Validate(); err == nil {
				t.Fatal("invalid request was accepted")
			}
		})
	}
	request := validCollectRequest()
	request.StartBlock = math.MaxInt64
	request.EndBlock = math.MaxInt64
	if err := request.Validate(); err != nil {
		t.Fatalf("maximum PostgreSQL block was rejected: %v", err)
	}
}

// TestCollectorSettingsValidation freezes bounded adaptive and retry configuration.
func TestCollectorSettingsValidation(t *testing.T) {
	valid := DefaultCollectorSettings()
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	tests := map[string]func(*CollectorSettings){
		"zero minimum":       func(s *CollectorSettings) { s.MinimumChunkSize = 0 },
		"small initial":      func(s *CollectorSettings) { s.MinimumChunkSize = s.InitialChunkSize + 1 },
		"small maximum":      func(s *CollectorSettings) { s.MaximumChunkSize = s.InitialChunkSize - 1 },
		"zero growth":        func(s *CollectorSettings) { s.GrowthThreshold = 0 },
		"negative retries":   func(s *CollectorSettings) { s.MaximumRetries = -1 },
		"zero backoff":       func(s *CollectorSettings) { s.InitialBackoff = 0 },
		"reversed backoff":   func(s *CollectorSettings) { s.MaximumBackoff = s.InitialBackoff - time.Nanosecond },
		"zero cleanup limit": func(s *CollectorSettings) { s.CleanupTimeout = 0 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			settings := valid
			mutate(&settings)
			if err := settings.Validate(); err == nil {
				t.Fatal("invalid settings were accepted")
			}
		})
	}
}
