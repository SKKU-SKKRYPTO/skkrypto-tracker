package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	tracker "github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/rpc"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

type fakeCollectRuntime struct {
	request          tracker.CollectRequest
	dataset          storage.Dataset
	boundaries       []storage.BoundaryHash
	observer         func(tracker.CollectorEvent)
	err              error
	errCategory      string
	collects         int
	gets             int
	reads            int
	closed           bool
	suppressTerminal bool
}

// Collect emits the complete lifecycle sequence used to validate CLI event projection.
func (f *fakeCollectRuntime) Collect(_ context.Context, request tracker.CollectRequest) (storage.Dataset, error) {
	f.collects++
	f.request = request
	if f.observer != nil {
		f.observer(tracker.CollectorEvent{Kind: tracker.EventStart, StartBlock: request.StartBlock, EndBlock: request.EndBlock})
		f.observer(tracker.CollectorEvent{Kind: tracker.EventResume, NextBlock: request.StartBlock, Complete: false})
		f.observer(tracker.CollectorEvent{Kind: tracker.EventSplit, StartBlock: request.StartBlock, EndBlock: request.EndBlock, PreviousChunkSize: 20, NewChunkSize: 10, ErrorCategory: "range_limit"})
		f.observer(tracker.CollectorEvent{Kind: tracker.EventRetry, Operation: "transferLogs", StartBlock: request.StartBlock, EndBlock: request.EndBlock, HasRange: true, Attempt: 1, Delay: time.Second, ErrorCategory: "temporary"})
		f.observer(tracker.CollectorEvent{Kind: tracker.EventCommit, StartBlock: request.StartBlock, EndBlock: request.EndBlock, BlockCount: 2, TransactionCount: 3, TransferCount: 4})
	}
	if f.err != nil {
		if f.observer != nil && !f.suppressTerminal {
			category := f.errCategory
			if category == "" {
				category = "fatal"
			}
			f.observer(tracker.CollectorEvent{Kind: tracker.EventTerminal, Outcome: "failure", Status: domain.StatusFailed, ErrorCategory: category})
		}
		return storage.Dataset{}, f.err
	}
	f.dataset.Spec.Key = request.Key()
	f.dataset.Spec.SourceNamespace = request.Namespace
	f.dataset.Spec.Asset = request.Asset
	f.dataset.Spec.Coverage.StartBlock = request.StartBlock
	f.dataset.Spec.Coverage.EndBlock = request.EndBlock
	if f.observer != nil {
		f.observer(tracker.CollectorEvent{Kind: tracker.EventTerminal, Outcome: "success", Status: domain.StatusReady})
	}
	return f.dataset, nil
}

// TestActionableDatasetErrorCategories verifies the CLI fallback emits only a
// fixed category when a runtime returns before producing its terminal event.
func TestActionableDatasetErrorCategories(t *testing.T) {
	tests := []struct {
		name, category string
		err            error
	}{
		{name: "finalized range", category: "finalized_range", err: tracker.ErrFinalizedRange},
		{name: "already ready", category: "already_ready", err: tracker.ErrDatasetAlreadyReady},
		{name: "already invalidated", category: "already_invalidated", err: tracker.ErrDatasetAlreadyInvalidated},
		{name: "spec mismatch", category: "dataset_spec_mismatch", err: tracker.ErrDatasetSpecMismatch},
		{name: "boundary hash changed", category: "boundary_hash_changed", err: tracker.ErrDatasetRequiresNewVersion},
		{name: "temporary", category: "temporary", err: rpc.ErrTemporary},
		{name: "canceled", category: "canceled", err: context.Canceled},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runtime := &fakeCollectRuntime{err: errors.Join(test.err, context.DeadlineExceeded, errors.New("provider secret")), suppressTerminal: true}
			var stdout, stderr bytes.Buffer
			app := application{stdout: &stdout, stderr: &stderr, getenv: envValues(map[string]string{"RPC_URL": "https://rpc", "DATABASE_URL": "postgres://db"}), deps: dependencies{
				openCollect: func(_ context.Context, _, _ string, _ tracker.CollectorSettings, observer func(tracker.CollectorEvent)) (collectRuntime, error) {
					runtime.observer = observer
					return runtime, nil
				},
				openManifest: func(context.Context, string) (manifestRuntime, error) { return nil, errors.New("unused") },
				runID:        func() (string, error) { return "run", nil },
			}}
			if code := app.run(context.Background(), collectArgs(writeTokens(t))); code == 0 {
				t.Fatal("actionable failure succeeded")
			}
			if stdout.Len() != 0 || !strings.Contains(stderr.String(), `"errorCategory":"`+test.category+`"`) || strings.Contains(stderr.String(), "provider secret") {
				t.Fatalf("stdout=%q stderr=%s", stdout.String(), stderr.String())
			}
		})
	}
}

// TestSafeCategoryPrioritizesOperationalErrors verifies joined cleanup
// deadlines do not replace the primary CLI fallback category.
func TestSafeCategoryPrioritizesOperationalErrors(t *testing.T) {
	tests := []struct {
		name, want string
		primary    error
	}{
		{name: "already ready", primary: tracker.ErrDatasetAlreadyReady, want: "already_ready"},
		{name: "boundary hash changed", primary: tracker.ErrDatasetRequiresNewVersion, want: "boundary_hash_changed"},
		{name: "temporary", primary: rpc.ErrTemporary, want: "temporary"},
		{name: "canceled", primary: context.Canceled, want: "canceled"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := errors.Join(test.primary, context.DeadlineExceeded)
			if got := safeCategory(err); got != test.want {
				t.Fatalf("category=%q want=%q", got, test.want)
			}
		})
	}
}

func (f *fakeCollectRuntime) GetDataset(context.Context, storage.DatasetKey) (storage.Dataset, error) {
	f.gets++
	return f.dataset, nil
}
func (f *fakeCollectRuntime) CommittedBoundaries(context.Context, storage.DatasetKey) ([]storage.BoundaryHash, error) {
	f.reads++
	return f.boundaries, nil
}
func (f *fakeCollectRuntime) Close() { f.closed = true }

type fakeManifestRuntime struct {
	dataset    storage.Dataset
	boundaries []storage.BoundaryHash
	gets       int
	reads      int
	closed     bool
}

func (f *fakeManifestRuntime) GetDataset(context.Context, storage.DatasetKey) (storage.Dataset, error) {
	f.gets++
	return f.dataset, nil
}
func (f *fakeManifestRuntime) CommittedBoundaries(context.Context, storage.DatasetKey) ([]storage.BoundaryHash, error) {
	f.reads++
	return f.boundaries, nil
}
func (f *fakeManifestRuntime) Close() { f.closed = true }

type failWriter struct{ err error }

func (w failWriter) Write([]byte) (int, error) { return 0, w.err }

func testDataset() storage.Dataset {
	now := time.Date(2026, 11, 1, 1, 2, 3, 0, time.UTC)
	return storage.Dataset{
		Spec: storage.DatasetSpec{
			Key: storage.DatasetKey{ID: "data", Version: "v1"}, SourceNamespace: "base-sepolia",
			Asset:    domain.Asset{ChainID: domain.ChainID, TokenAddress: "0x1111111111111111111111111111111111111111", Symbol: "TKN", Decimals: 18},
			Coverage: domain.Coverage{StartBlock: 10, EndBlock: 20, StartTime: now.Add(-time.Hour), EndTime: now.Add(-time.Minute)}, FinalizedBlock: 25,
		},
		Status: domain.StatusReady, CollectedAt: &now,
	}
}

func writeTokens(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tokens.json")
	contents := `[{"chainId":84532,"tokenAddress":"0x1111111111111111111111111111111111111111","symbol":"TKN","decimals":18}]`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func collectArgs(tokens string) []string {
	return []string{"collect", "--dataset-id", "data", "--dataset-version", "v1", "--namespace", "base-sepolia", "--token", "0x1111111111111111111111111111111111111111", "--start-block", "10", "--end-block", "20", "--tokens", tokens, "--chunk-size", "7"}
}

func envValues(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

// TestHelpNeverConnects verifies all three help surfaces are dependency-free.
func TestHelpNeverConnects(t *testing.T) {
	for _, args := range [][]string{{"--help"}, {"collect", "--help"}, {"manifest", "--help"}} {
		var stdout, stderr bytes.Buffer
		opens := 0
		app := application{stdout: &stdout, stderr: &stderr, getenv: envValues(nil), deps: dependencies{
			openCollect: func(context.Context, string, string, tracker.CollectorSettings, func(tracker.CollectorEvent)) (collectRuntime, error) {
				opens++
				return nil, errors.New("unexpected")
			},
			openManifest: func(context.Context, string) (manifestRuntime, error) { opens++; return nil, errors.New("unexpected") },
			runID:        func() (string, error) { return "run", nil },
		}}
		if code := app.run(context.Background(), args); code != 0 || opens != 0 || stdout.Len() == 0 || stderr.Len() != 0 {
			t.Fatalf("args=%v code=%d opens=%d stdout=%q stderr=%q", args, code, opens, stdout.String(), stderr.String())
		}
	}
}

// TestCLIConnectionEnvironmentContract freezes required variables without PG fallback or implicit env loading.
func TestCLIConnectionEnvironmentContract(t *testing.T) {
	tokens := writeTokens(t)
	tests := []struct {
		name string
		args []string
		env  map[string]string
	}{
		{name: "collect missing rpc", args: collectArgs(tokens), env: map[string]string{"DATABASE_URL": "postgres://db"}},
		{name: "collect PG variables do not count", args: collectArgs(tokens), env: map[string]string{"RPC_URL": "https://rpc", "PGHOST": "postgres"}},
		{name: "manifest missing database", args: []string{"manifest", "--dataset-id", "data", "--dataset-version", "v1"}, env: map[string]string{"RPC_URL": "https://unused"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			opens := 0
			app := application{stdout: io.Discard, stderr: io.Discard, getenv: envValues(test.env), deps: dependencies{
				openCollect: func(context.Context, string, string, tracker.CollectorSettings, func(tracker.CollectorEvent)) (collectRuntime, error) {
					opens++
					return nil, nil
				},
				openManifest: func(context.Context, string) (manifestRuntime, error) { opens++; return nil, nil },
				runID:        func() (string, error) { return "run", nil },
			}}
			if code := app.run(context.Background(), test.args); code == 0 || opens != 0 {
				t.Fatalf("code=%d opens=%d", code, opens)
			}
		})
	}
}

// TestCollectWritesManifestAndStructuredEvents verifies flag precedence, event fields, output separation and cleanup.
func TestCollectWritesManifestAndStructuredEvents(t *testing.T) {
	dataset := testDataset()
	runtime := &fakeCollectRuntime{dataset: dataset, boundaries: []storage.BoundaryHash{{BlockNumber: 20, BlockHash: "0x" + strings.Repeat("a", 64)}}}
	var settings tracker.CollectorSettings
	var stdout, stderr bytes.Buffer
	app := application{stdout: &stdout, stderr: &stderr, getenv: envValues(map[string]string{"RPC_URL": "https://secret.example/?key=hidden", "DATABASE_URL": "postgres://user:password@db/name"}), deps: dependencies{
		openCollect: func(_ context.Context, _, _ string, got tracker.CollectorSettings, observer func(tracker.CollectorEvent)) (collectRuntime, error) {
			settings = got
			runtime.observer = observer
			return runtime, nil
		},
		openManifest: func(context.Context, string) (manifestRuntime, error) { return nil, errors.New("unused") },
		runID:        func() (string, error) { return "fixed-run", nil },
	}}
	if code := app.run(context.Background(), collectArgs(writeTokens(t))); code != 0 {
		t.Fatalf("code=%d stderr=%s", code, stderr.String())
	}
	if settings.InitialChunkSize != 7 || runtime.collects != 1 || runtime.gets != 1 || runtime.reads != 1 || !runtime.closed {
		t.Fatalf("settings/runtime = %+v %+v", settings, runtime)
	}
	if !strings.Contains(stdout.String(), `"datasetId": "data"`) || strings.Contains(stdout.String(), "password") || strings.Contains(stdout.String(), "secret.example") {
		t.Fatalf("stdout=%s", stdout.String())
	}
	lines := strings.Split(strings.TrimSpace(stderr.String()), "\n")
	if len(lines) != 6 {
		t.Fatalf("events=%d: %s", len(lines), stderr.String())
	}
	wantEvents := []string{"start", "resume", "split", "retry", "commit", "terminal"}
	for i, line := range lines {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatal(err)
		}
		if event["event"] != wantEvents[i] || event["runId"] != "fixed-run" || event["datasetId"] != "data" || event["datasetVersion"] != "v1" {
			t.Fatalf("event %d = %+v", i, event)
		}
		if event["event"] == "retry" && (event["operation"] != "transferLogs" || event["startBlock"] != "10" || event["endBlock"] != "20") {
			t.Fatalf("retry event=%+v", event)
		}
	}
	for _, secret := range []string{"password", "hidden", "secret.example"} {
		if strings.Contains(stderr.String(), secret) {
			t.Fatalf("stderr leaked %q: %s", secret, stderr.String())
		}
	}
}

// TestNonAllowlistedTokenStopsBeforeConnections proves allowlist rejection precedes DB/RPC construction.
func TestNonAllowlistedTokenStopsBeforeConnections(t *testing.T) {
	args := collectArgs(writeTokens(t))
	for i := range args {
		if args[i] == "--token" {
			args[i+1] = "0x2222222222222222222222222222222222222222"
		}
	}
	opens := 0
	app := application{stdout: io.Discard, stderr: io.Discard, getenv: envValues(map[string]string{"RPC_URL": "https://rpc", "DATABASE_URL": "postgres://db"}), deps: dependencies{
		openCollect: func(context.Context, string, string, tracker.CollectorSettings, func(tracker.CollectorEvent)) (collectRuntime, error) {
			opens++
			return nil, nil
		},
		openManifest: func(context.Context, string) (manifestRuntime, error) { return nil, nil },
		runID:        func() (string, error) { return "run", nil },
	}}
	if code := app.run(context.Background(), args); code == 0 || opens != 0 {
		t.Fatalf("code=%d opens=%d", code, opens)
	}
}

// TestManifestExportRecoversAfterCollectOutputFailure verifies READY survives stdout failure and DB-only export succeeds later.
func TestManifestExportRecoversAfterCollectOutputFailure(t *testing.T) {
	dataset := testDataset()
	boundaries := []storage.BoundaryHash{{BlockNumber: 20, BlockHash: "0x" + strings.Repeat("b", 64)}}
	collectState := &fakeCollectRuntime{dataset: dataset, boundaries: boundaries}
	var collectLogs bytes.Buffer
	app := application{stdout: failWriter{err: errors.New("disk secret")}, stderr: &collectLogs, getenv: envValues(map[string]string{"RPC_URL": "https://rpc", "DATABASE_URL": "postgres://db"}), deps: dependencies{
		openCollect: func(_ context.Context, _, _ string, _ tracker.CollectorSettings, observer func(tracker.CollectorEvent)) (collectRuntime, error) {
			collectState.observer = observer
			return collectState, nil
		},
		openManifest: func(context.Context, string) (manifestRuntime, error) { return nil, errors.New("unused") },
		runID:        func() (string, error) { return "run", nil },
	}}
	if code := app.run(context.Background(), collectArgs(writeTokens(t))); code == 0 || collectState.collects != 1 || !collectState.closed || !strings.Contains(collectLogs.String(), `"status":"READY"`) || !strings.Contains(collectLogs.String(), `"errorCategory":"output"`) || strings.Contains(collectLogs.String(), "disk secret") {
		t.Fatalf("code=%d runtime=%+v logs=%s", code, collectState, collectLogs.String())
	}
	manifestState := &fakeManifestRuntime{dataset: dataset, boundaries: boundaries}
	var stdout, stderr bytes.Buffer
	collectOpens := 0
	app = application{stdout: &stdout, stderr: &stderr, getenv: envValues(map[string]string{"DATABASE_URL": "postgres://db"}), deps: dependencies{
		openCollect: func(context.Context, string, string, tracker.CollectorSettings, func(tracker.CollectorEvent)) (collectRuntime, error) {
			collectOpens++
			return nil, nil
		},
		openManifest: func(context.Context, string) (manifestRuntime, error) { return manifestState, nil },
		runID:        func() (string, error) { return "unused", nil },
	}}
	if code := app.run(context.Background(), []string{"manifest", "--dataset-id", "data", "--dataset-version", "v1"}); code != 0 || collectOpens != 0 || manifestState.gets != 1 || manifestState.reads != 1 || !manifestState.closed || stdout.Len() == 0 || stderr.Len() != 0 {
		t.Fatalf("code=%d collectOpens=%d runtime=%+v stdout=%s stderr=%s", code, collectOpens, manifestState, stdout.String(), stderr.String())
	}
}

// TestStructuredLogsRedactRawConnectionErrors ensures dependency errors never reach operator output.
func TestStructuredLogsRedactRawConnectionErrors(t *testing.T) {
	secret := "https://user:password@example.invalid/?apiKey=hidden"
	var stderr bytes.Buffer
	app := application{stdout: io.Discard, stderr: &stderr, getenv: envValues(map[string]string{"RPC_URL": secret, "DATABASE_URL": "postgres://user:db-secret@db/name"}), deps: dependencies{
		openCollect: func(context.Context, string, string, tracker.CollectorSettings, func(tracker.CollectorEvent)) (collectRuntime, error) {
			return nil, errors.New(secret + " bearer-token provider-body")
		},
		openManifest: func(context.Context, string) (manifestRuntime, error) { return nil, errors.New("unused") },
		runID:        func() (string, error) { return "run", nil },
	}}
	if code := app.run(context.Background(), collectArgs(writeTokens(t))); code == 0 {
		t.Fatal("connection failure succeeded")
	}
	for _, forbidden := range []string{"password", "hidden", "db-secret", "bearer-token", "provider-body", "example.invalid"} {
		if strings.Contains(stderr.String(), forbidden) {
			t.Fatalf("stderr leaked %q: %s", forbidden, stderr.String())
		}
	}
}

// TestRetryLogRangePresence distinguishes an explicit block-zero range from a non-range retry.
func TestRetryLogRangePresence(t *testing.T) {
	var output bytes.Buffer
	logger := newEventLogger(&output, "run", "data", "v1")
	logger.log(tracker.CollectorEvent{
		Kind: tracker.EventRetry, Operation: "blockByNumber", HasRange: true,
		StartBlock: 0, EndBlock: 0, Attempt: 1, Delay: time.Second, ErrorCategory: "temporary",
	})
	logger.log(tracker.CollectorEvent{
		Kind: tracker.EventRetry, Operation: "finalizedBlock",
		Attempt: 1, Delay: time.Second, ErrorCategory: "temporary",
	})
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("lines=%q", lines)
	}
	var ranged, global map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &ranged); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(lines[1]), &global); err != nil {
		t.Fatal(err)
	}
	if ranged["startBlock"] != "0" || ranged["endBlock"] != "0" {
		t.Fatalf("ranged retry=%+v", ranged)
	}
	if _, exists := global["startBlock"]; exists {
		t.Fatalf("non-range retry has startBlock: %+v", global)
	}
	if _, exists := global["endBlock"]; exists {
		t.Fatalf("non-range retry has endBlock: %+v", global)
	}
}

// TestCanceledCollectReturnsFailureAndClosesResources verifies signal-style cancellation handling.
func TestCanceledCollectReturnsFailureAndClosesResources(t *testing.T) {
	runtime := &fakeCollectRuntime{err: context.Canceled, errCategory: "canceled"}
	var stderr bytes.Buffer
	app := application{stdout: io.Discard, stderr: &stderr, getenv: envValues(map[string]string{"RPC_URL": "https://rpc", "DATABASE_URL": "postgres://db"}), deps: dependencies{
		openCollect: func(_ context.Context, _, _ string, _ tracker.CollectorSettings, observer func(tracker.CollectorEvent)) (collectRuntime, error) {
			runtime.observer = observer
			return runtime, nil
		},
		openManifest: func(context.Context, string) (manifestRuntime, error) { return nil, errors.New("unused") },
		runID:        func() (string, error) { return "run", nil },
	}}
	if code := app.run(context.Background(), collectArgs(writeTokens(t))); code == 0 || !runtime.closed || !strings.Contains(stderr.String(), `"errorCategory":"canceled"`) {
		t.Fatalf("code=%d closed=%v stderr=%s", code, runtime.closed, stderr.String())
	}
}
