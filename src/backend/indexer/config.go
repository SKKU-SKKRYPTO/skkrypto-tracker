package indexer

import (
	"errors"
	"math"
	"strings"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

const (
	defaultInitialChunkSize = uint64(2_000)
	defaultMaximumChunkSize = uint64(10_000)
	defaultGrowthThreshold  = 5
	defaultMaximumRetries   = 3
)

// CollectRequest fixes the immutable Dataset identity, asset and inclusive block range.
type CollectRequest struct {
	DatasetID      string
	DatasetVersion string
	Namespace      string
	Asset          domain.Asset
	StartBlock     domain.BlockNumber
	EndBlock       domain.BlockNumber
}

// Key returns the Dataset version addressed by this collection request.
func (r CollectRequest) Key() storage.DatasetKey {
	return storage.DatasetKey{ID: r.DatasetID, Version: r.DatasetVersion}
}

// CollectorSettings controls adaptive chunking and bounded temporary-error retries.
type CollectorSettings struct {
	InitialChunkSize uint64
	MinimumChunkSize uint64
	MaximumChunkSize uint64
	GrowthThreshold  int
	MaximumRetries   int
	InitialBackoff   time.Duration
	MaximumBackoff   time.Duration
	CleanupTimeout   time.Duration
}

// DefaultCollectorSettings returns the production collection defaults from the project plan.
func DefaultCollectorSettings() CollectorSettings {
	return CollectorSettings{
		InitialChunkSize: defaultInitialChunkSize,
		MinimumChunkSize: 1,
		MaximumChunkSize: defaultMaximumChunkSize,
		GrowthThreshold:  defaultGrowthThreshold,
		MaximumRetries:   defaultMaximumRetries,
		InitialBackoff:   250 * time.Millisecond,
		MaximumBackoff:   2 * time.Second,
		CleanupTimeout:   5 * time.Second,
	}
}

// Validate rejects requests that cannot be represented by the persisted Snapshot schema.
func (r CollectRequest) Validate() error {
	switch {
	case strings.TrimSpace(r.DatasetID) == "" || r.DatasetID != strings.TrimSpace(r.DatasetID):
		return errors.New("dataset ID is required without surrounding whitespace")
	case strings.TrimSpace(r.DatasetVersion) == "" || r.DatasetVersion != strings.TrimSpace(r.DatasetVersion):
		return errors.New("dataset version is required without surrounding whitespace")
	case strings.TrimSpace(r.Namespace) == "" || r.Namespace != strings.TrimSpace(r.Namespace):
		return errors.New("source namespace is required without surrounding whitespace")
	case r.EndBlock < r.StartBlock:
		return errors.New("end block must not precede start block")
	case uint64(r.EndBlock) > math.MaxInt64:
		return errors.New("end block exceeds PostgreSQL BIGINT")
	}
	if err := validateToken(r.Asset); err != nil {
		return err
	}
	return nil
}

// Validate rejects settings that could cause an unbounded retry or invalid chunk transition.
func (s CollectorSettings) Validate() error {
	switch {
	case s.MinimumChunkSize == 0:
		return errors.New("minimum chunk size must be positive")
	case s.InitialChunkSize < s.MinimumChunkSize:
		return errors.New("initial chunk size must not be smaller than minimum")
	case s.MaximumChunkSize < s.InitialChunkSize:
		return errors.New("maximum chunk size must not be smaller than initial")
	case s.GrowthThreshold <= 0:
		return errors.New("growth threshold must be positive")
	case s.MaximumRetries < 0:
		return errors.New("maximum retries must not be negative")
	case s.InitialBackoff <= 0 || s.MaximumBackoff <= 0:
		return errors.New("retry backoff must be positive")
	case s.MaximumBackoff < s.InitialBackoff:
		return errors.New("maximum backoff must not be smaller than initial backoff")
	case s.CleanupTimeout <= 0:
		return errors.New("cleanup timeout must be positive")
	}
	return nil
}
