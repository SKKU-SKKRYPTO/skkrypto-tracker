package indexer

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/rpc"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

var (
	// ErrFinalizedRange means the requested end is newer than the observed finalized head.
	ErrFinalizedRange = errors.New("requested range exceeds finalized block")
	// ErrDatasetSpecMismatch means an existing version was requested with different immutable inputs.
	ErrDatasetSpecMismatch = errors.New("existing dataset specification differs")
	// ErrDatasetRequiresNewVersion means a committed boundary hash changed and collection cannot reuse this version.
	ErrDatasetRequiresNewVersion = errors.New("dataset was invalidated; collect with a new explicit version")
	// ErrDatasetAlreadyReady means immutable published data must not be recollected in place.
	ErrDatasetAlreadyReady = errors.New("dataset version is already READY")
	// ErrDatasetAlreadyInvalidated means an invalidated version cannot be resumed.
	ErrDatasetAlreadyInvalidated = errors.New("dataset version is INVALIDATED; collect with a new explicit version")
)

// CollectorEventKind identifies a safe collection lifecycle event for an external logger.
type CollectorEventKind string

const (
	EventStart    CollectorEventKind = "start"
	EventResume   CollectorEventKind = "resume"
	EventSplit    CollectorEventKind = "split"
	EventRetry    CollectorEventKind = "retry"
	EventCommit   CollectorEventKind = "commit"
	EventTerminal CollectorEventKind = "terminal"
)

// CollectorEvent contains only bounded, non-secret values; it never carries raw dependency errors.
type CollectorEvent struct {
	Kind              CollectorEventKind
	Operation         string
	StartBlock        domain.BlockNumber
	EndBlock          domain.BlockNumber
	HasRange          bool
	NextBlock         domain.BlockNumber
	Complete          bool
	PreviousChunkSize uint64
	NewChunkSize      uint64
	Attempt           int
	Delay             time.Duration
	ErrorCategory     string
	BlockCount        int
	TransactionCount  int
	TransferCount     int
	Outcome           string
	Status            string
}

type collectionLock interface {
	Release(context.Context) error
}

type collectorStore interface {
	LockDataset(context.Context, storage.DatasetKey) (collectionLock, error)
	GetDataset(context.Context, storage.DatasetKey) (storage.Dataset, error)
	CreateDataset(context.Context, storage.DatasetSpec) error
	ResumePoint(context.Context, storage.DatasetKey) (storage.ResumePoint, error)
	RestartFailed(context.Context, storage.DatasetKey) error
	CommitChunk(context.Context, storage.Chunk) error
	CommittedBoundaries(context.Context, storage.DatasetKey) ([]storage.BoundaryHash, error)
	MarkReady(context.Context, storage.DatasetKey, *storage.BoundaryHash, time.Time) error
	MarkFailed(context.Context, storage.DatasetKey) error
	Invalidate(context.Context, storage.DatasetKey, string) error
}

type postgresCollectorStore struct{ store *storage.Postgres }

func (s postgresCollectorStore) LockDataset(ctx context.Context, key storage.DatasetKey) (collectionLock, error) {
	return s.store.TryLockDataset(ctx, key)
}
func (s postgresCollectorStore) GetDataset(ctx context.Context, key storage.DatasetKey) (storage.Dataset, error) {
	return s.store.GetDataset(ctx, key)
}
func (s postgresCollectorStore) CreateDataset(ctx context.Context, spec storage.DatasetSpec) error {
	return s.store.CreateDataset(ctx, spec)
}
func (s postgresCollectorStore) ResumePoint(ctx context.Context, key storage.DatasetKey) (storage.ResumePoint, error) {
	return s.store.ResumePoint(ctx, key)
}
func (s postgresCollectorStore) RestartFailed(ctx context.Context, key storage.DatasetKey) error {
	return s.store.RestartFailed(ctx, key)
}
func (s postgresCollectorStore) CommitChunk(ctx context.Context, chunk storage.Chunk) error {
	return s.store.CommitChunk(ctx, chunk)
}
func (s postgresCollectorStore) CommittedBoundaries(ctx context.Context, key storage.DatasetKey) ([]storage.BoundaryHash, error) {
	return s.store.CommittedBoundaries(ctx, key)
}
func (s postgresCollectorStore) MarkReady(ctx context.Context, key storage.DatasetKey, boundary *storage.BoundaryHash, at time.Time) error {
	return s.store.MarkReady(ctx, key, boundary, at)
}
func (s postgresCollectorStore) MarkFailed(ctx context.Context, key storage.DatasetKey) error {
	return s.store.MarkFailed(ctx, key)
}
func (s postgresCollectorStore) Invalidate(ctx context.Context, key storage.DatasetKey, reason string) error {
	return s.store.Invalidate(ctx, key, reason)
}

type collectorHooks struct {
	now      func() time.Time
	sleep    func(context.Context, time.Duration) error
	observer func(CollectorEvent)
}

// Collector coordinates one explicitly versioned Snapshot collection against RPC and PostgreSQL.
type Collector struct {
	rpc      rpc.Client
	store    collectorStore
	settings CollectorSettings
	hooks    collectorHooks
}

// NewCollector builds a production collector around the concrete PostgreSQL storage implementation.
func NewCollector(client rpc.Client, store *storage.Postgres, settings CollectorSettings, observer func(CollectorEvent)) (*Collector, error) {
	if store == nil {
		return nil, errors.New("PostgreSQL storage is required")
	}
	return newCollector(client, postgresCollectorStore{store: store}, settings, collectorHooks{observer: observer})
}

// newCollector injects clock and sleep seams used by deterministic unit tests.
func newCollector(client rpc.Client, store collectorStore, settings CollectorSettings, hooks collectorHooks) (*Collector, error) {
	if client == nil || store == nil {
		return nil, errors.New("RPC client and collection storage are required")
	}
	if err := settings.Validate(); err != nil {
		return nil, fmt.Errorf("invalid collector settings: %w", err)
	}
	if hooks.now == nil {
		hooks.now = time.Now
	}
	if hooks.sleep == nil {
		hooks.sleep = sleepContext
	}
	return &Collector{rpc: client, store: store, settings: settings, hooks: hooks}, nil
}

// Collect creates or resumes one Dataset version and publishes it only after fresh boundary verification.
func (c *Collector) Collect(ctx context.Context, request CollectRequest) (result storage.Dataset, resultErr error) {
	if err := request.Validate(); err != nil {
		return storage.Dataset{}, fmt.Errorf("invalid collection request: %w", err)
	}
	key := request.Key()
	status := ""
	c.emit(CollectorEvent{Kind: EventStart, StartBlock: request.StartBlock, EndBlock: request.EndBlock})
	defer func() {
		outcome := "success"
		category := ""
		if resultErr != nil {
			outcome = "failure"
			category = safeErrorCategory(resultErr)
		}
		c.emit(CollectorEvent{Kind: EventTerminal, Outcome: outcome, Status: status, ErrorCategory: category})
	}()

	chainID, err := retryValue(c, ctx, "chainID", func(callCtx context.Context) (uint64, error) {
		return c.rpc.ChainID(callCtx)
	})
	if err != nil {
		return storage.Dataset{}, err
	}
	if chainID != domain.ChainID {
		return storage.Dataset{}, fmt.Errorf("unexpected chain ID %d", chainID)
	}

	lock, err := c.store.LockDataset(ctx, key)
	if err != nil {
		return storage.Dataset{}, err
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.settings.CleanupTimeout)
		defer cancel()
		if releaseErr := lock.Release(cleanupCtx); releaseErr != nil {
			wrapped := fmt.Errorf("release collection lock: %w", releaseErr)
			if resultErr == nil {
				resultErr = wrapped
			} else {
				resultErr = errors.Join(resultErr, wrapped)
			}
		}
	}()

	dataset, err := c.store.GetDataset(ctx, key)
	created := false
	if errors.Is(err, storage.ErrNotFound) {
		dataset, err = c.initializeDataset(ctx, request)
		if err != nil {
			return storage.Dataset{}, err
		}
		created = true
		status = domain.StatusCollecting
	} else if err != nil {
		return storage.Dataset{}, err
	} else {
		status = dataset.Status
		if err := validateExistingDataset(dataset, request); err != nil {
			return storage.Dataset{}, err
		}
		if dataset.Status == domain.StatusReady {
			return storage.Dataset{}, ErrDatasetAlreadyReady
		}
		if dataset.Status == domain.StatusInvalidated {
			return storage.Dataset{}, ErrDatasetAlreadyInvalidated
		}
	}

	point, err := c.store.ResumePoint(ctx, key)
	if err != nil {
		return storage.Dataset{}, c.failCollecting(ctx, key, created || dataset.Status == domain.StatusCollecting, err, &status)
	}
	c.emit(CollectorEvent{Kind: EventResume, NextBlock: point.NextBlock, Complete: point.Complete})
	if point.Boundary != nil {
		if err := c.verifyBoundary(ctx, *point.Boundary); err != nil {
			if errors.Is(err, ErrDatasetRequiresNewVersion) {
				if invalidationErr := cleanupCall(ctx, c.settings.CleanupTimeout, func(cleanupCtx context.Context) error {
					return c.store.Invalidate(cleanupCtx, key, "committed boundary hash changed")
				}); invalidationErr != nil {
					return storage.Dataset{}, errors.Join(err, fmt.Errorf("invalidate changed boundary: %w", invalidationErr))
				}
				status = domain.StatusInvalidated
				return storage.Dataset{}, err
			}
			return storage.Dataset{}, c.failCollecting(ctx, key, created || dataset.Status == domain.StatusCollecting, err, &status)
		}
	}
	if !created {
		if err := c.verifyCoverageTimes(ctx, dataset.Spec); err != nil {
			return storage.Dataset{}, c.failCollecting(ctx, key, dataset.Status == domain.StatusCollecting, err, &status)
		}
	}
	if dataset.Status == domain.StatusFailed {
		if err := c.store.RestartFailed(ctx, key); err != nil {
			return storage.Dataset{}, err
		}
		status = domain.StatusCollecting
	}

	if !point.Complete {
		if err := c.collectChunks(ctx, dataset.Spec, point.NextBlock); err != nil {
			return storage.Dataset{}, c.failCollecting(ctx, key, !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded), err, &status)
		}
	}
	if err := c.publish(ctx, dataset.Spec); err != nil {
		if errors.Is(err, ErrDatasetRequiresNewVersion) {
			if invalidationErr := cleanupCall(ctx, c.settings.CleanupTimeout, func(cleanupCtx context.Context) error {
				return c.store.Invalidate(cleanupCtx, key, "committed boundary hash changed")
			}); invalidationErr != nil {
				return storage.Dataset{}, errors.Join(err, fmt.Errorf("invalidate changed boundary: %w", invalidationErr))
			}
			status = domain.StatusInvalidated
			return storage.Dataset{}, err
		}
		return storage.Dataset{}, c.failCollecting(ctx, key, !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded), err, &status)
	}
	status = domain.StatusReady
	result, err = c.store.GetDataset(ctx, key)
	if err != nil {
		return storage.Dataset{}, err
	}
	return result, nil
}

// initializeDataset fixes finality and Coverage endpoint times before the first database mutation.
func (c *Collector) initializeDataset(ctx context.Context, request CollectRequest) (storage.Dataset, error) {
	finalized, err := retryValue(c, ctx, "finalizedBlock", func(callCtx context.Context) (rpc.Block, error) {
		return c.rpc.FinalizedBlock(callCtx)
	})
	if err != nil {
		return storage.Dataset{}, err
	}
	finalized.Hash = strings.ToLower(finalized.Hash)
	finalized.Time = finalized.Time.UTC()
	if uint64(finalized.Number) > math.MaxInt64 || !domain.ValidHash(finalized.Hash) || finalized.Time.IsZero() {
		return storage.Dataset{}, errors.New("RPC returned an invalid finalized block")
	}
	if finalized.Number < request.EndBlock {
		return storage.Dataset{}, fmt.Errorf("%w: current finalized block is %s", ErrFinalizedRange, finalized.Number)
	}
	start, err := c.block(ctx, request.StartBlock)
	if err != nil {
		return storage.Dataset{}, err
	}
	end := start
	if request.EndBlock != request.StartBlock {
		end, err = c.block(ctx, request.EndBlock)
		if err != nil {
			return storage.Dataset{}, err
		}
	}
	spec := storage.DatasetSpec{
		Key:             request.Key(),
		SourceNamespace: request.Namespace,
		Asset:           request.Asset,
		Coverage: domain.Coverage{
			StartBlock: request.StartBlock, EndBlock: request.EndBlock,
			StartTime: start.Time.UTC(), EndTime: end.Time.UTC(),
		},
		FinalizedBlock: finalized.Number,
	}
	if err := c.store.CreateDataset(ctx, spec); err != nil {
		return storage.Dataset{}, err
	}
	return storage.Dataset{Spec: spec, Status: domain.StatusCollecting}, nil
}

// collectChunks applies adaptive inclusive ranges and advances only after an atomic commit succeeds.
func (c *Collector) collectChunks(ctx context.Context, spec storage.DatasetSpec, next domain.BlockNumber) error {
	chunkSize := c.settings.InitialChunkSize
	consecutiveSuccesses := 0
	for next <= spec.Coverage.EndBlock {
		end := inclusiveEnd(next, spec.Coverage.EndBlock, chunkSize)
		retried := false
		chunkClient := &retryingRPCClient{
			collector: c,
			base:      c.rpc,
			start:     next,
			end:       end,
			onRetry:   func() { retried = true },
		}
		chunk, err := assembleChunk(ctx, chunkClient, spec, next, end)
		if retried {
			consecutiveSuccesses = 0
		}
		if errors.Is(err, rpc.ErrRangeLimit) || errors.Is(err, rpc.ErrResultLimit) {
			actual := uint64(end-next) + 1
			if actual <= c.settings.MinimumChunkSize {
				return err
			}
			shrunk := actual / 2
			if shrunk < c.settings.MinimumChunkSize {
				shrunk = c.settings.MinimumChunkSize
			}
			c.emit(CollectorEvent{Kind: EventSplit, StartBlock: next, EndBlock: end, PreviousChunkSize: actual, NewChunkSize: shrunk, ErrorCategory: safeErrorCategory(err)})
			chunkSize = shrunk
			consecutiveSuccesses = 0
			continue
		}
		if err != nil {
			return err
		}
		if err := c.store.CommitChunk(ctx, chunk); err != nil {
			if errors.Is(err, storage.ErrChunkAlreadyCommitted) {
				point, resumeErr := c.store.ResumePoint(ctx, spec.Key)
				if resumeErr == nil && (point.Complete || point.NextBlock > end) {
					if point.Complete {
						return nil
					}
					next = point.NextBlock
					consecutiveSuccesses = 0
					continue
				}
			}
			return err
		}
		c.emit(CollectorEvent{Kind: EventCommit, StartBlock: chunk.StartBlock, EndBlock: chunk.EndBlock, BlockCount: len(chunk.Blocks), TransactionCount: len(chunk.Transactions), TransferCount: len(chunk.Transfers)})
		consecutiveSuccesses++
		if consecutiveSuccesses == c.settings.GrowthThreshold {
			if chunkSize < c.settings.MaximumChunkSize {
				if chunkSize > c.settings.MaximumChunkSize/2 {
					chunkSize = c.settings.MaximumChunkSize
				} else {
					chunkSize *= 2
				}
			}
			consecutiveSuccesses = 0
		}
		if end == spec.Coverage.EndBlock {
			return nil
		}
		next = end + 1
	}
	return nil
}

// retryingRPCClient applies the Collector retry policy to one exact RPC
// operation without restarting successful work already completed in the chunk.
type retryingRPCClient struct {
	collector *Collector
	base      rpc.Client
	start     domain.BlockNumber
	end       domain.BlockNumber
	onRetry   func()
}

// decorate marks the adaptive success streak as interrupted and adds the attempted range.
func (c *retryingRPCClient) decorate(event *CollectorEvent) {
	if c.onRetry != nil {
		c.onRetry()
	}
	event.StartBlock = c.start
	event.EndBlock = c.end
	event.HasRange = true
}

// ChainID retries only the exact chain identity request.
func (c *retryingRPCClient) ChainID(ctx context.Context) (uint64, error) {
	return retryValue(c.collector, ctx, "chainID", c.base.ChainID, c.decorate)
}

// FinalizedBlock retries only the exact finalized header request.
func (c *retryingRPCClient) FinalizedBlock(ctx context.Context) (rpc.Block, error) {
	return retryValue(c.collector, ctx, "finalizedBlock", c.base.FinalizedBlock, c.decorate)
}

// TransferLogs retries the same filter request while preserving limit errors for adaptive splitting.
func (c *retryingRPCClient) TransferLogs(ctx context.Context, tokenAddress string, start, end domain.BlockNumber) ([]rpc.Log, error) {
	return retryValue(c.collector, ctx, "transferLogs", func(callCtx context.Context) ([]rpc.Log, error) {
		return c.base.TransferLogs(callCtx, tokenAddress, start, end)
	}, c.decorate)
}

// BlockByNumber retries only the requested header without discarding earlier chunk results.
func (c *retryingRPCClient) BlockByNumber(ctx context.Context, number domain.BlockNumber) (rpc.Block, error) {
	return retryValue(c.collector, ctx, "blockByNumber", func(callCtx context.Context) (rpc.Block, error) {
		return c.base.BlockByNumber(callCtx, number)
	}, c.decorate)
}

// Receipt retries only the requested transaction Receipt without restarting the chunk.
func (c *retryingRPCClient) Receipt(ctx context.Context, txHash string) (rpc.Receipt, error) {
	return retryValue(c.collector, ctx, "receipt", func(callCtx context.Context) (rpc.Receipt, error) {
		return c.base.Receipt(callCtx, txHash)
	}, c.decorate)
}

// publish freshly verifies every committed boundary and Coverage endpoint before READY.
func (c *Collector) publish(ctx context.Context, spec storage.DatasetSpec) error {
	boundaries, err := c.store.CommittedBoundaries(ctx, spec.Key)
	if err != nil {
		return err
	}
	if len(boundaries) == 0 {
		return storage.ErrIncompleteCoverage
	}
	for _, boundary := range boundaries {
		if err := c.verifyBoundary(ctx, boundary); err != nil {
			return err
		}
	}
	if err := c.verifyCoverageTimes(ctx, spec); err != nil {
		return err
	}
	last := boundaries[len(boundaries)-1]
	return c.store.MarkReady(ctx, spec.Key, &last, c.hooks.now().UTC())
}

// verifyBoundary bypasses chunk caches and compares one persisted boundary with a fresh header.
func (c *Collector) verifyBoundary(ctx context.Context, boundary storage.BoundaryHash) error {
	block, err := c.block(ctx, boundary.BlockNumber)
	if err != nil {
		return err
	}
	if !strings.EqualFold(block.Hash, boundary.BlockHash) {
		return ErrDatasetRequiresNewVersion
	}
	return nil
}

// verifyCoverageTimes ensures the fixed endpoint instants still match fresh headers.
func (c *Collector) verifyCoverageTimes(ctx context.Context, spec storage.DatasetSpec) error {
	start, err := c.block(ctx, spec.Coverage.StartBlock)
	if err != nil {
		return err
	}
	end := start
	if spec.Coverage.EndBlock != spec.Coverage.StartBlock {
		end, err = c.block(ctx, spec.Coverage.EndBlock)
		if err != nil {
			return err
		}
	}
	if !start.Time.Equal(spec.Coverage.StartTime) || !end.Time.Equal(spec.Coverage.EndTime) {
		return errors.New("fresh Coverage endpoint time differs from immutable Dataset specification")
	}
	return nil
}

// block performs a bounded source retry and validates the requested header identity.
func (c *Collector) block(ctx context.Context, number domain.BlockNumber) (rpc.Block, error) {
	block, err := retryValue(c, ctx, "blockByNumber", func(callCtx context.Context) (rpc.Block, error) {
		return c.rpc.BlockByNumber(callCtx, number)
	})
	if err != nil {
		return rpc.Block{}, err
	}
	block.Hash = strings.ToLower(block.Hash)
	block.Time = block.Time.UTC()
	if block.Number != number || !domain.ValidHash(block.Hash) || block.Time.IsZero() {
		return rpc.Block{}, fmt.Errorf("invalid block response for %s", number)
	}
	return block, nil
}

// failCollecting records an ordinary failure without masking the primary error or changing canceled runs.
func (c *Collector) failCollecting(ctx context.Context, key storage.DatasetKey, shouldMark bool, primary error, status *string) error {
	if !shouldMark || errors.Is(primary, context.Canceled) || errors.Is(primary, context.DeadlineExceeded) {
		return primary
	}
	if err := cleanupCall(ctx, c.settings.CleanupTimeout, func(cleanupCtx context.Context) error {
		return c.store.MarkFailed(cleanupCtx, key)
	}); err != nil {
		return errors.Join(primary, fmt.Errorf("mark dataset FAILED: %w", err))
	}
	*status = domain.StatusFailed
	return primary
}

// validateExistingDataset prevents a caller from changing immutable inputs under an existing version.
func validateExistingDataset(dataset storage.Dataset, request CollectRequest) error {
	if dataset.Spec.Key != request.Key() || dataset.Spec.SourceNamespace != request.Namespace ||
		!dataset.Spec.Asset.Same(request.Asset) || dataset.Spec.Asset.Symbol != request.Asset.Symbol ||
		dataset.Spec.Asset.Decimals != request.Asset.Decimals || dataset.Spec.Coverage.StartBlock != request.StartBlock ||
		dataset.Spec.Coverage.EndBlock != request.EndBlock {
		return ErrDatasetSpecMismatch
	}
	return nil
}

// retryValue retries only explicitly classified temporary failures and lets callers decorate retry events.
func retryValue[T any](c *Collector, ctx context.Context, operation string, call func(context.Context) (T, error), onRetry ...func(*CollectorEvent)) (T, error) {
	var zero T
	delay := c.settings.InitialBackoff
	for attempt := 0; ; attempt++ {
		value, err := call(ctx)
		if err == nil {
			return value, nil
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return zero, ctxErr
		}
		if !errors.Is(err, rpc.ErrTemporary) || attempt >= c.settings.MaximumRetries {
			return zero, err
		}
		event := CollectorEvent{Kind: EventRetry, Operation: operation, Attempt: attempt + 1, Delay: delay, ErrorCategory: safeErrorCategory(err)}
		for _, decorate := range onRetry {
			if decorate != nil {
				decorate(&event)
			}
		}
		c.emit(event)
		if err := c.hooks.sleep(ctx, delay); err != nil {
			return zero, err
		}
		if delay < c.settings.MaximumBackoff {
			if delay > c.settings.MaximumBackoff/2 {
				delay = c.settings.MaximumBackoff
			} else {
				delay *= 2
			}
		}
	}
}

// inclusiveEnd caps a positive requested span without overflowing BlockNumber arithmetic.
func inclusiveEnd(start, coverageEnd domain.BlockNumber, size uint64) domain.BlockNumber {
	remaining := uint64(coverageEnd - start)
	if size-1 > remaining {
		return coverageEnd
	}
	return start + domain.BlockNumber(size-1)
}

// cleanupCall gives status cleanup a bounded context independent of caller cancellation.
func cleanupCall(ctx context.Context, timeout time.Duration, call func(context.Context) error) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()
	return call(cleanup)
}

// sleepContext waits for retry backoff while remaining promptly cancelable.
func sleepContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// safeErrorCategory maps dependency failures to a fixed vocabulary without exposing raw details.
func safeErrorCategory(err error) string {
	switch {
	case errors.Is(err, rpc.ErrRangeLimit):
		return "range_limit"
	case errors.Is(err, rpc.ErrResultLimit):
		return "result_limit"
	case errors.Is(err, rpc.ErrTemporary):
		return "temporary"
	case errors.Is(err, ErrFinalizedRange):
		return "finalized_range"
	case errors.Is(err, ErrDatasetAlreadyReady):
		return "already_ready"
	case errors.Is(err, ErrDatasetAlreadyInvalidated):
		return "already_invalidated"
	case errors.Is(err, ErrDatasetSpecMismatch):
		return "dataset_spec_mismatch"
	case errors.Is(err, ErrDatasetRequiresNewVersion):
		return "boundary_hash_changed"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline"
	default:
		return "fatal"
	}
}

// emit forwards a lifecycle event when an observer was configured.
func (c *Collector) emit(event CollectorEvent) {
	if c.hooks.observer != nil {
		c.hooks.observer(event)
	}
}
