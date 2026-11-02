package indexer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/rpc"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

type collectorRPCStub struct {
	mu             sync.Mutex
	chainID        uint64
	chainErr       error
	finalized      domain.BlockNumber
	logErr         func(domain.BlockNumber, domain.BlockNumber, int) error
	blockHash      func(domain.BlockNumber) string
	blockTime      func(domain.BlockNumber) time.Time
	chainCalls     int
	finalizedCalls int
	logCalls       [][2]domain.BlockNumber
	blockCalls     []domain.BlockNumber
}

func newCollectorRPCStub(finalized domain.BlockNumber) *collectorRPCStub {
	return &collectorRPCStub{
		chainID: domain.ChainID, finalized: finalized,
		blockHash: func(number domain.BlockNumber) string { return testHash(byte(number%251 + 1)) },
		blockTime: func(number domain.BlockNumber) time.Time { return time.Unix(1_700_000_000+int64(number), 0).UTC() },
	}
}

// ChainID returns the configured test chain and records the precondition call.
func (s *collectorRPCStub) ChainID(ctx context.Context) (uint64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.chainCalls++
	return s.chainID, s.chainErr
}

// FinalizedBlock returns a deterministic finalized header for the requested test range.
func (s *collectorRPCStub) FinalizedBlock(ctx context.Context) (rpc.Block, error) {
	if err := ctx.Err(); err != nil {
		return rpc.Block{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finalizedCalls++
	return rpc.Block{Number: s.finalized, Hash: s.blockHash(s.finalized), Time: s.blockTime(s.finalized)}, nil
}

// TransferLogs records inclusive attempts and applies the scenario-specific error script.
func (s *collectorRPCStub) TransferLogs(ctx context.Context, _ string, start, end domain.BlockNumber) ([]rpc.Log, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logCalls = append(s.logCalls, [2]domain.BlockNumber{start, end})
	if s.logErr != nil {
		if err := s.logErr(start, end, len(s.logCalls)); err != nil {
			return nil, err
		}
	}
	return nil, nil
}

// BlockByNumber returns deterministic hashes and timestamps while recording fresh reads.
func (s *collectorRPCStub) BlockByNumber(ctx context.Context, number domain.BlockNumber) (rpc.Block, error) {
	if err := ctx.Err(); err != nil {
		return rpc.Block{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blockCalls = append(s.blockCalls, number)
	return rpc.Block{Number: number, Hash: s.blockHash(number), Time: s.blockTime(number)}, nil
}

// Receipt fails because empty-log collector scenarios must never request one.
func (*collectorRPCStub) Receipt(context.Context, string) (rpc.Receipt, error) {
	return rpc.Receipt{}, errors.New("unexpected Receipt call")
}

type collectorTestLock struct {
	released   bool
	deadline   bool
	releaseErr error
}

// Release records bounded cleanup behavior for the collection lock.
func (l *collectorTestLock) Release(ctx context.Context) error {
	_, l.deadline = ctx.Deadline()
	l.released = true
	return l.releaseErr
}

type collectorStoreStub struct {
	mu             sync.Mutex
	dataset        *storage.Dataset
	chunks         []storage.Chunk
	lock           collectorTestLock
	calls          []string
	commitHook     func(storage.Chunk, int) error
	boundariesErr  error
	markReadyErr   error
	markFailedErr  error
	invalidateErr  error
	resumeErr      error
	getErr         error
	resumeOverride *storage.ResumePoint
	commitCalls    int
}

func (s *collectorStoreStub) record(call string) { s.calls = append(s.calls, call) }

// LockDataset records acquisition order and returns the stateful test lock.
func (s *collectorStoreStub) LockDataset(context.Context, storage.DatasetKey) (collectionLock, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("lock")
	return &s.lock, nil
}

// GetDataset returns the current persisted state or the injected lookup outcome.
func (s *collectorStoreStub) GetDataset(context.Context, storage.DatasetKey) (storage.Dataset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("get")
	if s.getErr != nil {
		return storage.Dataset{}, s.getErr
	}
	if s.dataset == nil {
		return storage.Dataset{}, storage.ErrNotFound
	}
	return *s.dataset, nil
}

// CreateDataset persists the immutable specification in COLLECTING state.
func (s *collectorStoreStub) CreateDataset(_ context.Context, spec storage.DatasetSpec) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("create")
	dataset := storage.Dataset{Spec: spec, Status: domain.StatusCollecting}
	s.dataset = &dataset
	return nil
}

// ResumePoint derives continuity from committed chunks unless a scenario overrides it.
func (s *collectorStoreStub) ResumePoint(context.Context, storage.DatasetKey) (storage.ResumePoint, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("resume")
	if s.resumeErr != nil {
		return storage.ResumePoint{}, s.resumeErr
	}
	if s.resumeOverride != nil {
		return *s.resumeOverride, nil
	}
	return s.resumePoint(), nil
}

// resumePoint computes the same contiguous-prefix contract used by PostgreSQL storage.
func (s *collectorStoreStub) resumePoint() storage.ResumePoint {
	spec := s.dataset.Spec
	next := spec.Coverage.StartBlock
	var boundary *storage.BoundaryHash
	for _, chunk := range s.chunks {
		if chunk.StartBlock != next {
			break
		}
		hash := ""
		for _, block := range chunk.Blocks {
			if block.Number == chunk.EndBlock {
				hash = block.Hash
			}
		}
		value := storage.BoundaryHash{BlockNumber: chunk.EndBlock, BlockHash: hash}
		boundary = &value
		if chunk.EndBlock == spec.Coverage.EndBlock {
			return storage.ResumePoint{NextBlock: chunk.EndBlock, Boundary: boundary, Complete: true}
		}
		next = chunk.EndBlock + 1
	}
	return storage.ResumePoint{NextBlock: next, Boundary: boundary}
}

// RestartFailed preserves chunks and moves only FAILED state back to COLLECTING.
func (s *collectorStoreStub) RestartFailed(context.Context, storage.DatasetKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("restart")
	if s.dataset.Status != domain.StatusFailed {
		return storage.ErrInvalidStatusTransition
	}
	s.dataset.Status = domain.StatusCollecting
	return nil
}

// CommitChunk applies an optional ambiguous/duplicate outcome before durable append.
func (s *collectorStoreStub) CommitChunk(_ context.Context, chunk storage.Chunk) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("commit")
	s.commitCalls++
	if s.commitHook != nil {
		if err := s.commitHook(chunk, s.commitCalls); err != nil {
			return err
		}
	}
	s.chunks = append(s.chunks, chunk)
	return nil
}

// CommittedBoundaries returns ordered chunk-end hashes or an injected continuity error.
func (s *collectorStoreStub) CommittedBoundaries(context.Context, storage.DatasetKey) ([]storage.BoundaryHash, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("boundaries")
	if s.boundariesErr != nil {
		return nil, s.boundariesErr
	}
	result := make([]storage.BoundaryHash, 0, len(s.chunks))
	for _, chunk := range s.chunks {
		for _, block := range chunk.Blocks {
			if block.Number == chunk.EndBlock {
				result = append(result, storage.BoundaryHash{BlockNumber: block.Number, BlockHash: block.Hash})
				break
			}
		}
	}
	return result, nil
}

// MarkReady persists UTC publication metadata unless the scenario injects a failure.
func (s *collectorStoreStub) MarkReady(_ context.Context, _ storage.DatasetKey, _ *storage.BoundaryHash, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("ready")
	if s.markReadyErr != nil {
		return s.markReadyErr
	}
	s.dataset.Status = domain.StatusReady
	value := at.UTC()
	s.dataset.CollectedAt = &value
	return nil
}

// MarkFailed observes the cleanup context and records the ordinary failure transition.
func (s *collectorStoreStub) MarkFailed(ctx context.Context, _ storage.DatasetKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("failed")
	if s.markFailedErr != nil {
		return s.markFailedErr
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	s.dataset.Status = domain.StatusFailed
	return nil
}

// Invalidate records the terminal hash-change transition and its public-safe reason.
func (s *collectorStoreStub) Invalidate(ctx context.Context, _ storage.DatasetKey, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record("invalidate")
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if s.invalidateErr != nil {
		return s.invalidateErr
	}
	s.dataset.Status = domain.StatusInvalidated
	s.dataset.InvalidationReason = &reason
	return nil
}

// testCollector constructs a deterministic collector without real sleeps or wall-clock reads.
func testCollector(t *testing.T, client rpc.Client, store collectorStore, settings CollectorSettings, events *[]CollectorEvent) *Collector {
	t.Helper()
	collector, err := newCollector(client, store, settings, collectorHooks{
		now:   func() time.Time { return time.Date(2026, 11, 1, 1, 2, 3, 0, time.FixedZone("KST", 9*60*60)) },
		sleep: func(ctx context.Context, _ time.Duration) error { return ctx.Err() },
		observer: func(event CollectorEvent) {
			if events != nil {
				*events = append(*events, event)
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return collector
}

func smallCollectorSettings() CollectorSettings {
	settings := DefaultCollectorSettings()
	settings.InitialChunkSize = 4
	settings.MaximumChunkSize = 8
	settings.GrowthThreshold = 2
	return settings
}

func datasetForRequest(request CollectRequest, client *collectorRPCStub, status string) storage.Dataset {
	return storage.Dataset{Spec: storage.DatasetSpec{
		Key: request.Key(), SourceNamespace: request.Namespace, Asset: request.Asset,
		Coverage:       domain.Coverage{StartBlock: request.StartBlock, EndBlock: request.EndBlock, StartTime: client.blockTime(request.StartBlock), EndTime: client.blockTime(request.EndBlock)},
		FinalizedBlock: client.finalized,
	}, Status: status}
}

// TestCollectorCreatesCollectsAndPublishes verifies lock ordering, immutable spec creation,
// contiguous chunks, fresh publication checks, UTC collection time and lifecycle events.
func TestCollectorCreatesCollectsAndPublishes(t *testing.T) {
	request := validCollectRequest()
	client := newCollectorRPCStub(30)
	store := &collectorStoreStub{}
	events := []CollectorEvent{}
	collector := testCollector(t, client, store, smallCollectorSettings(), &events)
	got, err := collector.Collect(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusReady || got.CollectedAt == nil || got.CollectedAt.Location() != time.UTC {
		t.Fatalf("dataset = %+v", got)
	}
	if client.chainCalls != 1 || client.finalizedCalls != 1 || len(client.logCalls) != 3 {
		t.Fatalf("RPC calls: chain=%d finalized=%d logs=%v", client.chainCalls, client.finalizedCalls, client.logCalls)
	}
	wantRanges := [][2]domain.BlockNumber{{10, 13}, {14, 17}, {18, 20}}
	for i := range wantRanges {
		if client.logCalls[i] != wantRanges[i] {
			t.Fatalf("ranges = %v", client.logCalls)
		}
	}
	if len(store.calls) < 3 || store.calls[0] != "lock" || store.calls[1] != "get" || store.calls[2] != "create" || !store.lock.released || !store.lock.deadline {
		t.Fatalf("store lifecycle = %v, lock=%+v", store.calls, store.lock)
	}
	if store.dataset.Spec.Coverage.StartTime.Location() != time.UTC || store.dataset.Spec.FinalizedBlock != 30 {
		t.Fatalf("spec = %+v", store.dataset.Spec)
	}
	if events[0].Kind != EventStart || events[len(events)-1].Kind != EventTerminal || events[len(events)-1].Outcome != "success" {
		t.Fatalf("events = %+v", events)
	}
}

// TestCollectorChainPreconditionPreventsEveryMutation covers new and persisted lifecycle states.
func TestCollectorChainPreconditionPreventsEveryMutation(t *testing.T) {
	request := validCollectRequest()
	for _, status := range []string{"missing", domain.StatusCollecting, domain.StatusFailed, domain.StatusReady} {
		t.Run(status, func(t *testing.T) {
			client := newCollectorRPCStub(30)
			client.chainID = 1
			store := &collectorStoreStub{}
			if status != "missing" {
				dataset := datasetForRequest(request, client, status)
				store.dataset = &dataset
			}
			collector := testCollector(t, client, store, smallCollectorSettings(), nil)
			if _, err := collector.Collect(context.Background(), request); err == nil {
				t.Fatal("wrong chain was accepted")
			}
			if len(store.calls) != 0 || len(client.logCalls) != 0 {
				t.Fatalf("calls = %v, logs=%v", store.calls, client.logCalls)
			}
		})
	}
}

// TestCollectorRejectsUnfinalizedRangeBeforeCreation preserves the observed finalized value in the error path.
func TestCollectorRejectsUnfinalizedRangeBeforeCreation(t *testing.T) {
	request := validCollectRequest()
	client := newCollectorRPCStub(19)
	store := &collectorStoreStub{}
	events := []CollectorEvent{}
	collector := testCollector(t, client, store, smallCollectorSettings(), &events)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, ErrFinalizedRange) || !strings.Contains(err.Error(), "19") {
		t.Fatalf("error = %v", err)
	}
	if store.dataset != nil || len(client.logCalls) != 0 || !store.lock.released {
		t.Fatalf("dataset/logs mutated: %+v %v", store.dataset, client.logCalls)
	}
	terminal := events[len(events)-1]
	if terminal.Kind != EventTerminal || terminal.ErrorCategory != "finalized_range" {
		t.Fatalf("terminal=%+v", terminal)
	}
}

// TestCollectorInvalidInputStopsBeforeRPCAndLock proves validation is a true outer precondition.
func TestCollectorInvalidInputStopsBeforeRPCAndLock(t *testing.T) {
	request := validCollectRequest()
	request.DatasetID = ""
	client := newCollectorRPCStub(30)
	store := &collectorStoreStub{}
	collector := testCollector(t, client, store, smallCollectorSettings(), nil)
	if _, err := collector.Collect(context.Background(), request); err == nil {
		t.Fatal("invalid request was accepted")
	}
	if client.chainCalls != 0 || len(store.calls) != 0 {
		t.Fatalf("dependencies were used: chain=%d store=%v", client.chainCalls, store.calls)
	}
}

// TestCollectorAdaptiveSplitGrowthAndTail verifies same-start halving, committed-only advance,
// growth after the configured streak, and an inclusive short tail.
func TestCollectorAdaptiveSplitGrowthAndTail(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 1, 13
	client := newCollectorRPCStub(20)
	client.logErr = func(start, end domain.BlockNumber, _ int) error {
		if uint64(end-start)+1 > 3 {
			return rpc.ErrRangeLimit
		}
		return nil
	}
	store := &collectorStoreStub{}
	events := []CollectorEvent{}
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 5
	collector := testCollector(t, client, store, settings, &events)
	if _, err := collector.Collect(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if len(client.logCalls) < 3 || client.logCalls[0] != [2]domain.BlockNumber{1, 5} || client.logCalls[1] != [2]domain.BlockNumber{1, 2} {
		t.Fatalf("split calls = %v", client.logCalls)
	}
	next := request.StartBlock
	for _, chunk := range store.chunks {
		if chunk.StartBlock != next {
			t.Fatalf("gap at chunks %+v", store.chunks)
		}
		next = chunk.EndBlock + 1
	}
	if store.chunks[len(store.chunks)-1].EndBlock != request.EndBlock {
		t.Fatalf("tail = %+v", store.chunks)
	}
	foundSplit := false
	for _, event := range events {
		if event.Kind == EventSplit && event.StartBlock == 1 && event.EndBlock == 5 && event.PreviousChunkSize == 5 && event.NewChunkSize == 2 {
			foundSplit = true
		}
	}
	if !foundSplit {
		t.Fatalf("split event missing: %+v", events)
	}
}

// TestCollectorOneBlockLimitFailureIsBounded verifies no split loop and FAILED state.
func TestCollectorOneBlockLimitFailureIsBounded(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 10
	client := newCollectorRPCStub(20)
	client.logErr = func(_, _ domain.BlockNumber, _ int) error { return rpc.ErrResultLimit }
	store := &collectorStoreStub{}
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 1
	collector := testCollector(t, client, store, settings, nil)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, rpc.ErrResultLimit) || len(client.logCalls) != 1 || store.dataset.Status != domain.StatusFailed {
		t.Fatalf("err=%v calls=%v status=%s", err, client.logCalls, store.dataset.Status)
	}
}

// TestCollectorTemporaryRetryBoundAndCancellation verifies exact attempt counts and context-aware waiting.
func TestCollectorTemporaryRetryBoundAndCancellation(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 10
	t.Run("success", func(t *testing.T) {
		client := newCollectorRPCStub(20)
		client.logErr = func(_, _ domain.BlockNumber, call int) error {
			if call < 3 {
				return rpc.ErrTemporary
			}
			return nil
		}
		store := &collectorStoreStub{}
		settings := smallCollectorSettings()
		settings.MaximumRetries = 2
		settings.InitialChunkSize = 1
		sleeps := 0
		events := []CollectorEvent{}
		collector, err := newCollector(client, store, settings, collectorHooks{now: time.Now, sleep: func(context.Context, time.Duration) error { sleeps++; return nil }, observer: func(event CollectorEvent) { events = append(events, event) }})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := collector.Collect(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		if len(client.logCalls) != 3 || sleeps != 2 {
			t.Fatalf("calls=%v sleeps=%d", client.logCalls, sleeps)
		}
		retries := 0
		for _, event := range events {
			if event.Kind == EventRetry {
				retries++
				if event.Operation != "transferLogs" || !event.HasRange || event.StartBlock != 10 || event.EndBlock != 10 || event.ErrorCategory != "temporary" {
					t.Fatalf("retry event=%+v", event)
				}
			}
		}
		if retries != 2 {
			t.Fatalf("events=%+v", events)
		}
	})
	t.Run("exhaustion", func(t *testing.T) {
		client := newCollectorRPCStub(20)
		client.logErr = func(_, _ domain.BlockNumber, _ int) error { return rpc.ErrTemporary }
		store := &collectorStoreStub{}
		settings := smallCollectorSettings()
		settings.MaximumRetries = 2
		settings.InitialChunkSize = 1
		collector, err := newCollector(client, store, settings, collectorHooks{now: time.Now, sleep: func(context.Context, time.Duration) error { return nil }})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := collector.Collect(context.Background(), request); !errors.Is(err, rpc.ErrTemporary) {
			t.Fatalf("error=%v", err)
		}
		if len(client.logCalls) != 3 || store.dataset.Status != domain.StatusFailed {
			t.Fatalf("calls=%v status=%s", client.logCalls, store.dataset.Status)
		}
	})
	t.Run("canceled wait", func(t *testing.T) {
		client := newCollectorRPCStub(20)
		client.logErr = func(_, _ domain.BlockNumber, _ int) error { return rpc.ErrTemporary }
		store := &collectorStoreStub{}
		settings := smallCollectorSettings()
		settings.InitialChunkSize = 1
		ctx, cancel := context.WithCancel(context.Background())
		collector, err := newCollector(client, store, settings, collectorHooks{now: time.Now, sleep: func(context.Context, time.Duration) error { cancel(); return context.Canceled }})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := collector.Collect(ctx, request); !errors.Is(err, context.Canceled) {
			t.Fatalf("error=%v", err)
		}
		if store.dataset.Status != domain.StatusCollecting || !store.lock.released {
			t.Fatalf("status=%s lock=%+v", store.dataset.Status, store.lock)
		}
	})
}

// TestCollectorCancellationAtStorageBoundaries releases the lock and never marks
// a canceled collection FAILED during lookup or commit.
func TestCollectorCancellationAtStorageBoundaries(t *testing.T) {
	request := validCollectRequest()
	t.Run("lookup", func(t *testing.T) {
		client := newCollectorRPCStub(30)
		store := &collectorStoreStub{getErr: context.Canceled}
		collector := testCollector(t, client, store, smallCollectorSettings(), nil)
		if _, err := collector.Collect(context.Background(), request); !errors.Is(err, context.Canceled) {
			t.Fatalf("error=%v", err)
		}
		if !store.lock.released {
			t.Fatalf("lock=%+v", store.lock)
		}
	})
	t.Run("commit", func(t *testing.T) {
		request := request
		request.StartBlock, request.EndBlock = 10, 10
		client := newCollectorRPCStub(30)
		store := &collectorStoreStub{commitHook: func(storage.Chunk, int) error { return context.Canceled }}
		settings := smallCollectorSettings()
		settings.InitialChunkSize = 1
		collector := testCollector(t, client, store, settings, nil)
		if _, err := collector.Collect(context.Background(), request); !errors.Is(err, context.Canceled) {
			t.Fatalf("error=%v", err)
		}
		if store.dataset.Status != domain.StatusCollecting || !store.lock.released {
			t.Fatalf("status=%s lock=%+v", store.dataset.Status, store.lock)
		}
	})
}

// TestCollectorJoinsMarkFailedError preserves the collection failure while
// retaining a failed status-transition diagnostic and the actual persisted state.
func TestCollectorJoinsMarkFailedError(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 10
	primary := fmt.Errorf("%w: provider unavailable", rpc.ErrTemporary)
	transitionErr := context.DeadlineExceeded
	client := newCollectorRPCStub(20)
	client.logErr = func(_, _ domain.BlockNumber, _ int) error { return primary }
	store := &collectorStoreStub{markFailedErr: transitionErr}
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 1
	settings.MaximumRetries = 0
	events := []CollectorEvent{}
	collector := testCollector(t, client, store, settings, &events)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, primary) || !errors.Is(err, transitionErr) {
		t.Fatalf("joined error=%v", err)
	}
	if store.dataset.Status != domain.StatusCollecting || !store.lock.released {
		t.Fatalf("status=%s lock=%+v", store.dataset.Status, store.lock)
	}
	terminal := events[len(events)-1]
	if terminal.Kind != EventTerminal || terminal.ErrorCategory != "temporary" {
		t.Fatalf("terminal=%+v", terminal)
	}
}

// TestCollectorJoinsReleaseErrorWithCanceledPrimary keeps cancellation as the
// safe terminal category while retaining the bounded lock cleanup failure.
func TestCollectorJoinsReleaseErrorWithCanceledPrimary(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 10
	releaseErr := context.DeadlineExceeded
	client := newCollectorRPCStub(20)
	client.logErr = func(_, _ domain.BlockNumber, _ int) error { return context.Canceled }
	store := &collectorStoreStub{}
	store.lock.releaseErr = releaseErr
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 1
	events := []CollectorEvent{}
	collector := testCollector(t, client, store, settings, &events)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, context.Canceled) || !errors.Is(err, releaseErr) {
		t.Fatalf("joined error=%v", err)
	}
	if store.dataset.Status != domain.StatusCollecting || !store.lock.released || !store.lock.deadline {
		t.Fatalf("status=%s lock=%+v", store.dataset.Status, store.lock)
	}
	terminal := events[len(events)-1]
	if terminal.Kind != EventTerminal || terminal.ErrorCategory != "canceled" {
		t.Fatalf("terminal=%+v", terminal)
	}
}

// TestSafeErrorCategoryPrioritizesOperationalErrors verifies cleanup deadlines
// cannot hide the primary fixed category while cancellation still beats deadline.
func TestSafeErrorCategoryPrioritizesOperationalErrors(t *testing.T) {
	tests := []struct {
		name, want string
		primary    error
	}{
		{name: "already ready", primary: ErrDatasetAlreadyReady, want: "already_ready"},
		{name: "boundary hash changed", primary: ErrDatasetRequiresNewVersion, want: "boundary_hash_changed"},
		{name: "temporary", primary: rpc.ErrTemporary, want: "temporary"},
		{name: "canceled", primary: context.Canceled, want: "canceled"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := errors.Join(test.primary, context.DeadlineExceeded)
			if got := safeErrorCategory(err); got != test.want {
				t.Fatalf("category=%q want=%q", got, test.want)
			}
		})
	}
}

// TestCollectorReturnsReleaseErrorAfterSuccessfulPublication verifies cleanup
// failure changes the call result without undoing the already-persisted READY state.
func TestCollectorReturnsReleaseErrorAfterSuccessfulPublication(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 10
	releaseErr := errors.New("lock release failed")
	client := newCollectorRPCStub(20)
	store := &collectorStoreStub{}
	store.lock.releaseErr = releaseErr
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 1
	events := []CollectorEvent{}
	collector := testCollector(t, client, store, settings, &events)
	got, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, releaseErr) {
		t.Fatalf("release error=%v", err)
	}
	if got.Status != domain.StatusReady || store.dataset.Status != domain.StatusReady || !store.lock.deadline {
		t.Fatalf("result=%+v persisted=%+v lock=%+v", got, store.dataset, store.lock)
	}
	terminal := events[len(events)-1]
	if terminal.Kind != EventTerminal || terminal.Outcome != "failure" || terminal.ErrorCategory != "fatal" {
		t.Fatalf("terminal=%+v", terminal)
	}
}

// TestCollectorResumeFailedAndCompletePublication verifies boundary-before-restart and no recollection of complete coverage.
func TestCollectorResumeFailedAndCompletePublication(t *testing.T) {
	request := validCollectRequest()
	client := newCollectorRPCStub(30)
	dataset := datasetForRequest(request, client, domain.StatusFailed)
	store := &collectorStoreStub{dataset: &dataset}
	store.chunks = []storage.Chunk{{Key: request.Key(), StartBlock: 10, EndBlock: 20, Blocks: []storage.Block{{Number: 20, Hash: client.blockHash(20), Time: client.blockTime(20)}}}}
	collector := testCollector(t, client, store, smallCollectorSettings(), nil)
	got, err := collector.Collect(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusReady || len(client.logCalls) != 0 {
		t.Fatalf("dataset=%+v logs=%v", got, client.logCalls)
	}
	restart := -1
	boundaryRead := -1
	for i, call := range store.calls {
		if call == "restart" {
			restart = i
		}
		if call == "resume" && boundaryRead < 0 {
			boundaryRead = i
		}
	}
	if restart < 0 || boundaryRead < 0 || restart < boundaryRead {
		t.Fatalf("calls = %v", store.calls)
	}
}

// TestCollectorCoverageTimeMismatchNeverRepairsSpec marks COLLECTING failed while
// preserving FAILED and the original immutable Coverage in both cases.
func TestCollectorCoverageTimeMismatchNeverRepairsSpec(t *testing.T) {
	request := validCollectRequest()
	for _, status := range []string{domain.StatusCollecting, domain.StatusFailed} {
		t.Run(status, func(t *testing.T) {
			client := newCollectorRPCStub(30)
			dataset := datasetForRequest(request, client, status)
			original := dataset.Spec.Coverage.StartTime
			client.blockTime = func(number domain.BlockNumber) time.Time {
				return time.Unix(1_800_000_000+int64(number), 0).UTC()
			}
			store := &collectorStoreStub{dataset: &dataset}
			collector := testCollector(t, client, store, smallCollectorSettings(), nil)
			if _, err := collector.Collect(context.Background(), request); err == nil {
				t.Fatal("changed Coverage time was accepted")
			}
			if !store.dataset.Spec.Coverage.StartTime.Equal(original) {
				t.Fatalf("Coverage was repaired: %+v", store.dataset.Spec.Coverage)
			}
			if store.dataset.Status != domain.StatusFailed || len(client.logCalls) != 0 {
				t.Fatalf("status=%s logs=%v calls=%v", store.dataset.Status, client.logCalls, store.calls)
			}
		})
	}
}

// TestCollectorInvalidatesChangedBoundary covers COLLECTING and FAILED without deferred FAILED overwrite.
func TestCollectorInvalidatesChangedBoundary(t *testing.T) {
	request := validCollectRequest()
	for _, status := range []string{domain.StatusCollecting, domain.StatusFailed} {
		t.Run(status, func(t *testing.T) {
			client := newCollectorRPCStub(30)
			dataset := datasetForRequest(request, client, status)
			store := &collectorStoreStub{dataset: &dataset}
			store.lock.releaseErr = context.DeadlineExceeded
			store.chunks = []storage.Chunk{{Key: request.Key(), StartBlock: 10, EndBlock: 15, Blocks: []storage.Block{{Number: 15, Hash: testHash(0xee), Time: client.blockTime(15)}}}}
			events := []CollectorEvent{}
			collector := testCollector(t, client, store, smallCollectorSettings(), &events)
			_, err := collector.Collect(context.Background(), request)
			if !errors.Is(err, ErrDatasetRequiresNewVersion) || !errors.Is(err, context.DeadlineExceeded) || store.dataset.Status != domain.StatusInvalidated || len(client.logCalls) != 0 {
				t.Fatalf("err=%v status=%s logs=%v calls=%v", err, store.dataset.Status, client.logCalls, store.calls)
			}
			terminal := events[len(events)-1]
			if terminal.Kind != EventTerminal || terminal.ErrorCategory != "boundary_hash_changed" {
				t.Fatalf("terminal=%+v", terminal)
			}
		})
	}
}

// TestCollectorResumeBoundaryPreservesPrimaryWhenInvalidationFails verifies a
// cleanup failure cannot replace the detected reorg or claim a state change.
func TestCollectorResumeBoundaryPreservesPrimaryWhenInvalidationFails(t *testing.T) {
	request := validCollectRequest()
	client := newCollectorRPCStub(30)
	dataset := datasetForRequest(request, client, domain.StatusCollecting)
	store := &collectorStoreStub{dataset: &dataset, invalidateErr: context.DeadlineExceeded}
	store.chunks = []storage.Chunk{{Key: request.Key(), StartBlock: 10, EndBlock: 15, Blocks: []storage.Block{{Number: 15, Hash: testHash(0xee), Time: client.blockTime(15)}}}}
	events := []CollectorEvent{}
	collector := testCollector(t, client, store, smallCollectorSettings(), &events)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, ErrDatasetRequiresNewVersion) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error=%v", err)
	}
	if store.dataset.Status != domain.StatusCollecting {
		t.Fatalf("status=%s calls=%v", store.dataset.Status, store.calls)
	}
	terminal := events[len(events)-1]
	encoded, marshalErr := json.Marshal(terminal)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if terminal.Kind != EventTerminal || terminal.ErrorCategory != "boundary_hash_changed" || strings.Contains(string(encoded), "deadline") {
		t.Fatalf("terminal=%s", encoded)
	}
}

// TestCollectorHashChangeWinsOverCoverageTimeChange verifies resume ordering:
// a reorg invalidates before a simultaneous endpoint-time inconsistency can be
// treated as an ordinary source failure.
func TestCollectorHashChangeWinsOverCoverageTimeChange(t *testing.T) {
	request := validCollectRequest()
	for _, status := range []string{domain.StatusCollecting, domain.StatusFailed} {
		t.Run(status, func(t *testing.T) {
			client := newCollectorRPCStub(30)
			dataset := datasetForRequest(request, client, status)
			storedBoundaryHash := client.blockHash(15)
			store := &collectorStoreStub{dataset: &dataset}
			store.chunks = []storage.Chunk{{
				Key: request.Key(), StartBlock: 10, EndBlock: 15,
				Blocks: []storage.Block{{Number: 15, Hash: storedBoundaryHash, Time: client.blockTime(15)}},
			}}
			originalHash := client.blockHash
			originalTime := client.blockTime
			client.blockHash = func(number domain.BlockNumber) string {
				if number == 15 {
					return testHash(0xef)
				}
				return originalHash(number)
			}
			client.blockTime = func(number domain.BlockNumber) time.Time {
				if number == request.StartBlock || number == request.EndBlock {
					return originalTime(number).Add(time.Second)
				}
				return originalTime(number)
			}

			collector := testCollector(t, client, store, smallCollectorSettings(), nil)
			_, err := collector.Collect(context.Background(), request)
			if !errors.Is(err, ErrDatasetRequiresNewVersion) || store.dataset.Status != domain.StatusInvalidated {
				t.Fatalf("err=%v status=%s calls=%v", err, store.dataset.Status, store.calls)
			}
			for _, call := range store.calls {
				if call == "restart" || call == "commit" || call == "failed" {
					t.Fatalf("unexpected mutation after changed boundary: %v", store.calls)
				}
			}
			if len(client.logCalls) != 0 {
				t.Fatalf("logs=%v", client.logCalls)
			}
		})
	}
}

// TestCollectorRetriesEachReceiptWithoutRestartingChunk proves temporary
// failures have independent budgets and preserve prior successful chunk work.
func TestCollectorRetriesEachReceiptWithoutRestartingChunk(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 10
	at := time.Unix(1_700_000_010, 0).UTC()
	block := rpc.Block{Number: 10, Hash: testHash(10), Time: at}
	client := rpc.NewStub(block)
	client.AddBlock(block)

	for i := uint32(0); i < 4; i++ {
		log := testRPCTransferLog(10, i, i, big.NewInt(int64(i+1)))
		client.AddLog(log)
		client.AddReceipt(rpc.Receipt{
			TxHash: log.TxHash, BlockNumber: log.BlockNumber, BlockHash: log.BlockHash,
			TransactionIndex: log.TransactionIndex, Status: 1, Logs: []rpc.Log{log},
		})
		client.QueueReceipt(log.TxHash, rpc.Receipt{}, rpc.ErrTemporary)
	}

	store := &collectorStoreStub{}
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 1
	events := []CollectorEvent{}
	collector := testCollector(t, client, store, settings, &events)
	got, err := collector.Collect(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusReady || len(store.chunks) != 1 || len(store.chunks[0].Transfers) != 4 {
		t.Fatalf("dataset=%+v chunks=%+v", got, store.chunks)
	}
	counts := map[rpc.Method]int{}
	for _, call := range client.Calls() {
		counts[call.Method]++
	}
	if counts[rpc.MethodTransferLogs] != 1 || counts[rpc.MethodReceipt] != 8 {
		t.Fatalf("RPC calls=%+v", client.Calls())
	}
	// Initialization, assembly, boundary publication and endpoint publication
	// each require one fresh header; Receipt retries must not restart them.
	if counts[rpc.MethodBlockByNumber] != 4 {
		t.Fatalf("successful headers were repeated: %+v", client.Calls())
	}
	retries := 0
	for _, event := range events {
		if event.Kind == EventRetry && event.Operation == "receipt" {
			if !event.HasRange || event.StartBlock != 10 || event.EndBlock != 10 {
				t.Fatalf("receipt retry range=%+v", event)
			}
			retries++
		}
	}
	if retries != 4 {
		t.Fatalf("retry events=%+v", events)
	}
}

// TestCollectorReceiptRetryExhaustionIsPerOperation verifies one exhausted
// Receipt stops without repeating getLogs or successful headers.
func TestCollectorReceiptRetryExhaustionIsPerOperation(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 10
	at := time.Unix(1_700_000_010, 0).UTC()
	block := rpc.Block{Number: 10, Hash: testHash(10), Time: at}
	client := rpc.NewStub(block)
	client.AddBlock(block)
	log := testRPCTransferLog(10, 0, 0, big.NewInt(1))
	client.AddLog(log)
	for i := 0; i < 3; i++ {
		client.QueueReceipt(log.TxHash, rpc.Receipt{}, rpc.ErrTemporary)
	}
	store := &collectorStoreStub{}
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 1
	settings.MaximumRetries = 2
	collector := testCollector(t, client, store, settings, nil)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, rpc.ErrTemporary) || store.dataset.Status != domain.StatusFailed {
		t.Fatalf("err=%v status=%s", err, store.dataset.Status)
	}
	counts := map[rpc.Method]int{}
	for _, call := range client.Calls() {
		counts[call.Method]++
	}
	if counts[rpc.MethodTransferLogs] != 1 || counts[rpc.MethodBlockByNumber] != 2 || counts[rpc.MethodReceipt] != 3 {
		t.Fatalf("RPC calls=%+v", client.Calls())
	}
}

// TestCollectorPublicationChecksEveryBoundary catches an earlier changed boundary
// even when the latest resume boundary is still canonical.
func TestCollectorPublicationChecksEveryBoundary(t *testing.T) {
	request := validCollectRequest()
	client := newCollectorRPCStub(30)
	dataset := datasetForRequest(request, client, domain.StatusCollecting)
	store := &collectorStoreStub{dataset: &dataset}
	store.chunks = []storage.Chunk{
		{Key: request.Key(), StartBlock: 10, EndBlock: 15, Blocks: []storage.Block{{Number: 15, Hash: testHash(0xee), Time: client.blockTime(15)}}},
		{Key: request.Key(), StartBlock: 16, EndBlock: 20, Blocks: []storage.Block{{Number: 20, Hash: client.blockHash(20), Time: client.blockTime(20)}}},
	}
	collector := testCollector(t, client, store, smallCollectorSettings(), nil)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, ErrDatasetRequiresNewVersion) || store.dataset.Status != domain.StatusInvalidated || len(client.logCalls) != 0 {
		t.Fatalf("err=%v status=%s logs=%v calls=%v", err, store.dataset.Status, client.logCalls, store.calls)
	}
	for _, call := range store.calls {
		if call == "ready" {
			t.Fatalf("READY was reached: %v", store.calls)
		}
	}
}

// TestCollectorPublishBoundaryPreservesPrimaryWhenInvalidationFails verifies
// publication retains the reorg category without falsely changing state.
func TestCollectorPublishBoundaryPreservesPrimaryWhenInvalidationFails(t *testing.T) {
	request := validCollectRequest()
	client := newCollectorRPCStub(30)
	dataset := datasetForRequest(request, client, domain.StatusCollecting)
	cleanupErr := errors.New("secret invalidation detail")
	store := &collectorStoreStub{dataset: &dataset, invalidateErr: cleanupErr}
	store.chunks = []storage.Chunk{
		{Key: request.Key(), StartBlock: 10, EndBlock: 15, Blocks: []storage.Block{{Number: 15, Hash: testHash(0xee), Time: client.blockTime(15)}}},
		{Key: request.Key(), StartBlock: 16, EndBlock: 20, Blocks: []storage.Block{{Number: 20, Hash: client.blockHash(20), Time: client.blockTime(20)}}},
	}
	events := []CollectorEvent{}
	collector := testCollector(t, client, store, smallCollectorSettings(), &events)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, ErrDatasetRequiresNewVersion) || !errors.Is(err, cleanupErr) {
		t.Fatalf("error=%v", err)
	}
	if store.dataset.Status != domain.StatusCollecting {
		t.Fatalf("status=%s calls=%v", store.dataset.Status, store.calls)
	}
	terminal := events[len(events)-1]
	encoded, marshalErr := json.Marshal(terminal)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if terminal.Kind != EventTerminal || terminal.ErrorCategory != "boundary_hash_changed" || strings.Contains(string(encoded), "secret invalidation detail") {
		t.Fatalf("terminal=%s", encoded)
	}
}

// TestCollectorIncompleteCoverageCannotPublish prevents READY even if a corrupt
// persistence seam claims resume is complete without any committed boundary.
func TestCollectorIncompleteCoverageCannotPublish(t *testing.T) {
	request := validCollectRequest()
	client := newCollectorRPCStub(30)
	dataset := datasetForRequest(request, client, domain.StatusCollecting)
	complete := storage.ResumePoint{NextBlock: request.EndBlock, Complete: true}
	store := &collectorStoreStub{dataset: &dataset, resumeOverride: &complete}
	collector := testCollector(t, client, store, smallCollectorSettings(), nil)
	_, err := collector.Collect(context.Background(), request)
	if !errors.Is(err, storage.ErrIncompleteCoverage) || store.dataset.Status != domain.StatusFailed {
		t.Fatalf("err=%v status=%s calls=%v", err, store.dataset.Status, store.calls)
	}
}

// TestCollectorExistingSpecAndTerminalStatesNeverMutate verifies immutable version protection.
func TestCollectorExistingSpecAndTerminalStatesNeverMutate(t *testing.T) {
	request := validCollectRequest()
	client := newCollectorRPCStub(30)
	tests := []struct {
		name, status string
		mutate       func(*CollectRequest)
		want         error
		wantCategory string
	}{
		{name: "mismatch", status: domain.StatusCollecting, mutate: func(r *CollectRequest) { r.Namespace = "other" }, want: ErrDatasetSpecMismatch, wantCategory: "dataset_spec_mismatch"},
		{name: "ready", status: domain.StatusReady, mutate: func(*CollectRequest) {}, want: ErrDatasetAlreadyReady, wantCategory: "already_ready"},
		{name: "invalidated", status: domain.StatusInvalidated, mutate: func(*CollectRequest) {}, want: ErrDatasetAlreadyInvalidated, wantCategory: "already_invalidated"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			requested := request
			test.mutate(&requested)
			dataset := datasetForRequest(request, client, test.status)
			store := &collectorStoreStub{dataset: &dataset}
			cleanupErr := context.DeadlineExceeded
			store.lock.releaseErr = cleanupErr
			events := []CollectorEvent{}
			collector := testCollector(t, client, store, smallCollectorSettings(), &events)
			_, err := collector.Collect(context.Background(), requested)
			if !errors.Is(err, test.want) || !errors.Is(err, cleanupErr) {
				t.Fatalf("error=%v", err)
			}
			terminal := events[len(events)-1]
			if terminal.Kind != EventTerminal || terminal.ErrorCategory != test.wantCategory {
				t.Fatalf("terminal=%+v", terminal)
			}
			for _, call := range store.calls {
				if call == "commit" || call == "ready" || call == "failed" || call == "invalidate" || call == "restart" {
					t.Fatalf("mutating calls=%v", store.calls)
				}
			}
		})
	}
}

// TestCollectorAmbiguousCommitDoesNotAdvance verifies a non-classified commit error is never assumed successful.
func TestCollectorAmbiguousCommitDoesNotAdvance(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 10
	client := newCollectorRPCStub(20)
	store := &collectorStoreStub{}
	store.commitHook = func(chunk storage.Chunk, _ int) error {
		store.chunks = append(store.chunks, chunk)
		return errors.New("ambiguous commit")
	}
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 1
	collector := testCollector(t, client, store, settings, nil)
	_, err := collector.Collect(context.Background(), request)
	if err == nil || len(store.chunks) != 1 || store.dataset.Status != domain.StatusFailed || len(client.logCalls) != 1 {
		t.Fatalf("err=%v chunks=%d status=%s logs=%v", err, len(store.chunks), store.dataset.Status, client.logCalls)
	}
}

// TestCollectorDuplicateCommitReconcilesPersistedResume reloads durable state
// instead of blindly treating the duplicate report itself as success.
func TestCollectorDuplicateCommitReconcilesPersistedResume(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock, request.EndBlock = 10, 13
	client := newCollectorRPCStub(20)
	store := &collectorStoreStub{}
	store.commitHook = func(chunk storage.Chunk, call int) error {
		if call == 1 {
			store.chunks = append(store.chunks, chunk)
			return storage.ErrChunkAlreadyCommitted
		}
		return nil
	}
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 2
	collector := testCollector(t, client, store, settings, nil)
	got, err := collector.Collect(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusReady || len(store.chunks) != 2 || store.chunks[0].StartBlock != 10 || store.chunks[1].StartBlock != 12 {
		t.Fatalf("dataset=%+v chunks=%+v calls=%v", got, store.chunks, store.calls)
	}
}

// TestCollectorMaximumBlockArithmetic verifies an inclusive one-block range at MaxInt64 cannot wrap.
func TestCollectorMaximumBlockArithmetic(t *testing.T) {
	request := validCollectRequest()
	request.StartBlock = domain.BlockNumber(^uint64(0) >> 1)
	request.EndBlock = request.StartBlock
	client := newCollectorRPCStub(request.EndBlock)
	store := &collectorStoreStub{}
	settings := smallCollectorSettings()
	settings.InitialChunkSize = 8
	collector := testCollector(t, client, store, settings, nil)
	if _, err := collector.Collect(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if len(client.logCalls) != 1 || client.logCalls[0] != [2]domain.BlockNumber{request.StartBlock, request.EndBlock} {
		t.Fatalf("logs=%v", client.logCalls)
	}
}

// TestCollectorFixtureIDsStayStableAcrossVersions runs the shared RPC Fixture
// through two explicit Dataset versions and compares persisted Snapshot IDs.
func TestCollectorFixtureIDsStayStableAcrossVersions(t *testing.T) {
	data, err := os.ReadFile("../api-server/testdata/fixtures/flow-demo-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Dataset   domain.Dataset    `json:"dataset"`
		Transfers []domain.Transfer `json:"transfers"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	settings := DefaultCollectorSettings()
	span := uint64(fixture.Dataset.EndBlock-fixture.Dataset.StartBlock) + 1
	settings.InitialChunkSize = span
	settings.MaximumChunkSize = span
	var idsByVersion [][]string
	for _, version := range []string{"snapshot-v1", "snapshot-v2"} {
		client, err := rpc.NewFixtureStub(fixture.Dataset, fixture.Transfers)
		if err != nil {
			t.Fatal(err)
		}
		store := &collectorStoreStub{}
		collector := testCollector(t, client, store, settings, nil)
		request := CollectRequest{
			DatasetID: "fixture-source", DatasetVersion: version, Namespace: "base-sepolia",
			Asset: fixture.Dataset.Asset, StartBlock: fixture.Dataset.StartBlock, EndBlock: fixture.Dataset.EndBlock,
		}
		if _, err := collector.Collect(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		ids := make([]string, 0, len(store.chunks[0].Transfers))
		for _, transfer := range store.chunks[0].Transfers {
			ids = append(ids, transfer.ID)
		}
		idsByVersion = append(idsByVersion, ids)
	}
	if fmt.Sprint(idsByVersion[0]) != fmt.Sprint(idsByVersion[1]) || len(idsByVersion[0]) != len(fixture.Transfers) {
		t.Fatalf("IDs changed across versions: %v", idsByVersion)
	}
}

var _ rpc.Client = (*collectorRPCStub)(nil)
var _ collectorStore = (*collectorStoreStub)(nil)
