package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"strings"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	tracker "github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/rpc"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultTokensPath = "indexer/tokens.json"
	connectTimeout    = 15 * time.Second
)

type collectRuntime interface {
	Collect(context.Context, tracker.CollectRequest) (storage.Dataset, error)
	tracker.ManifestReader
	Close()
}

type manifestRuntime interface {
	tracker.ManifestReader
	Close()
}

type dependencies struct {
	openCollect  func(context.Context, string, string, tracker.CollectorSettings, func(tracker.CollectorEvent)) (collectRuntime, error)
	openManifest func(context.Context, string) (manifestRuntime, error)
	runID        func() (string, error)
}

type application struct {
	stdout io.Writer
	stderr io.Writer
	getenv func(string) string
	deps   dependencies
}

// run dispatches one CLI subcommand without constructing dependencies for help or invalid input.
func (a application) run(ctx context.Context, args []string) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		a.writeRootHelp()
		return 0
	}
	switch args[0] {
	case "collect":
		return a.runCollect(ctx, args[1:])
	case "manifest":
		return a.runManifest(ctx, args[1:])
	default:
		fmt.Fprintf(a.stderr, "unknown command %q; use --help\n", args[0])
		return 2
	}
}

func (a application) writeRootHelp() {
	fmt.Fprintln(a.stdout, "Usage: indexer <command> [options]")
	fmt.Fprintln(a.stdout, "Commands:")
	fmt.Fprintln(a.stdout, "  collect   collect or resume one Base Sepolia Snapshot")
	fmt.Fprintln(a.stdout, "  manifest  export one READY Dataset without RPC or mutation")
}

type collectFlags struct {
	datasetID, version, namespace, token, tokenFile string
	startBlock, endBlock                            string
	settings                                        tracker.CollectorSettings
}

// parseCollectFlags validates syntax and constructs immutable inputs before any connection is opened.
func (a application) parseCollectFlags(args []string) (collectFlags, bool, error) {
	values := collectFlags{settings: tracker.DefaultCollectorSettings()}
	set := flag.NewFlagSet("collect", flag.ContinueOnError)
	set.SetOutput(io.Discard)
	set.StringVar(&values.datasetID, "dataset-id", "", "explicit Dataset ID")
	set.StringVar(&values.version, "dataset-version", "", "explicit Dataset version")
	set.StringVar(&values.namespace, "namespace", "", "source namespace")
	set.StringVar(&values.token, "token", "", "allowlisted token contract address")
	set.StringVar(&values.startBlock, "start-block", "", "inclusive decimal start block")
	set.StringVar(&values.endBlock, "end-block", "", "inclusive decimal end block")
	set.StringVar(&values.tokenFile, "tokens", defaultTokensPath, "token allowlist JSON path")
	set.Uint64Var(&values.settings.InitialChunkSize, "chunk-size", values.settings.InitialChunkSize, "initial chunk size")
	set.Uint64Var(&values.settings.MaximumChunkSize, "max-chunk-size", values.settings.MaximumChunkSize, "maximum adaptive chunk size")
	set.IntVar(&values.settings.GrowthThreshold, "growth-threshold", values.settings.GrowthThreshold, "successes before chunk growth")
	set.IntVar(&values.settings.MaximumRetries, "max-retries", values.settings.MaximumRetries, "temporary retries after the first attempt")
	set.DurationVar(&values.settings.InitialBackoff, "initial-backoff", values.settings.InitialBackoff, "initial retry backoff")
	set.DurationVar(&values.settings.MaximumBackoff, "max-backoff", values.settings.MaximumBackoff, "maximum retry backoff")
	set.Usage = func() {
		fmt.Fprintln(a.stdout, "Usage: indexer collect --dataset-id ID --dataset-version VERSION --namespace NS --token ADDRESS --start-block N --end-block N [options]")
		set.SetOutput(a.stdout)
		set.PrintDefaults()
	}
	if err := set.Parse(args); errors.Is(err, flag.ErrHelp) {
		return collectFlags{}, true, nil
	} else if err != nil || set.NArg() != 0 {
		return collectFlags{}, false, errors.New("invalid collect flags")
	}
	return values, false, nil
}

// runCollect validates configuration, owns all resources, exports one Manifest and delays terminal logging until export completes.
func (a application) runCollect(ctx context.Context, args []string) int {
	flags, help, err := a.parseCollectFlags(args)
	if help {
		return 0
	}
	runID, runIDErr := a.deps.runID()
	if runIDErr != nil {
		fmt.Fprintln(a.stderr, `{"event":"terminal","outcome":"failure","errorCategory":"internal"}`)
		return 1
	}
	logger := newEventLogger(a.stderr, runID, flags.datasetID, flags.version)
	fail := func(category, status string) int {
		logger.log(tracker.CollectorEvent{Kind: tracker.EventTerminal, Outcome: "failure", Status: status, ErrorCategory: category})
		return 1
	}
	if err != nil {
		return fail("input", "")
	}
	start, err := trackerBlock(flags.startBlock)
	if err != nil {
		return fail("input", "")
	}
	end, err := trackerBlock(flags.endBlock)
	if err != nil {
		return fail("input", "")
	}
	asset, err := tracker.LoadToken(flags.tokenFile, flags.token)
	if err != nil {
		return fail("input", "")
	}
	request := tracker.CollectRequest{DatasetID: flags.datasetID, DatasetVersion: flags.version, Namespace: flags.namespace, Asset: asset, StartBlock: start, EndBlock: end}
	if err := request.Validate(); err != nil {
		return fail("input", "")
	}
	if err := flags.settings.Validate(); err != nil {
		return fail("input", "")
	}
	rpcURL, databaseURL, ok := requiredConnections(a.getenv, true)
	if !ok {
		return fail("configuration", "")
	}
	var terminal *tracker.CollectorEvent
	observer := func(event tracker.CollectorEvent) {
		if event.Kind == tracker.EventTerminal {
			copy := event
			terminal = &copy
			return
		}
		logger.log(event)
	}
	runtime, err := a.deps.openCollect(ctx, databaseURL, rpcURL, flags.settings, observer)
	if err != nil {
		return fail("connection", "")
	}
	defer runtime.Close()
	dataset, err := runtime.Collect(ctx, request)
	if err != nil {
		if terminal != nil {
			logger.log(*terminal)
			return 1
		}
		return fail(safeCategory(err), "")
	}
	manifest, err := tracker.LoadManifest(ctx, runtime, request.Key())
	if err != nil {
		return fail("export", dataset.Status)
	}
	if err := tracker.WriteManifest(a.stdout, manifest); err != nil {
		return fail("output", dataset.Status)
	}
	if terminal != nil {
		logger.log(*terminal)
	} else {
		logger.log(tracker.CollectorEvent{Kind: tracker.EventTerminal, Outcome: "success", Status: dataset.Status})
	}
	return 0
}

type manifestFlags struct{ datasetID, version string }

// parseManifestFlags parses the read-only export key without opening PostgreSQL.
func (a application) parseManifestFlags(args []string) (manifestFlags, bool, error) {
	var values manifestFlags
	set := flag.NewFlagSet("manifest", flag.ContinueOnError)
	set.SetOutput(io.Discard)
	set.StringVar(&values.datasetID, "dataset-id", "", "Dataset ID")
	set.StringVar(&values.version, "dataset-version", "", "Dataset version")
	set.Usage = func() {
		fmt.Fprintln(a.stdout, "Usage: indexer manifest --dataset-id ID --dataset-version VERSION")
		set.SetOutput(a.stdout)
		set.PrintDefaults()
	}
	if err := set.Parse(args); errors.Is(err, flag.ErrHelp) {
		return manifestFlags{}, true, nil
	} else if err != nil || set.NArg() != 0 {
		return manifestFlags{}, false, errors.New("invalid manifest flags")
	}
	if strings.TrimSpace(values.datasetID) == "" || strings.TrimSpace(values.version) == "" || values.datasetID != strings.TrimSpace(values.datasetID) || values.version != strings.TrimSpace(values.version) {
		return manifestFlags{}, false, errors.New("dataset ID and version are required")
	}
	return values, false, nil
}

// runManifest performs a DB-only read and never constructs RPC or a collection lock.
func (a application) runManifest(ctx context.Context, args []string) int {
	flags, help, err := a.parseManifestFlags(args)
	if help {
		return 0
	}
	if err != nil {
		fmt.Fprintln(a.stderr, `{"event":"terminal","outcome":"failure","errorCategory":"input"}`)
		return 2
	}
	_, databaseURL, ok := requiredConnections(a.getenv, false)
	if !ok {
		fmt.Fprintln(a.stderr, `{"event":"terminal","outcome":"failure","errorCategory":"configuration"}`)
		return 1
	}
	runtime, err := a.deps.openManifest(ctx, databaseURL)
	if err != nil {
		fmt.Fprintln(a.stderr, `{"event":"terminal","outcome":"failure","errorCategory":"connection"}`)
		return 1
	}
	defer runtime.Close()
	manifest, err := tracker.LoadManifest(ctx, runtime, storage.DatasetKey{ID: flags.datasetID, Version: flags.version})
	if err != nil {
		fmt.Fprintln(a.stderr, `{"event":"terminal","outcome":"failure","errorCategory":"export"}`)
		return 1
	}
	if err := tracker.WriteManifest(a.stdout, manifest); err != nil {
		fmt.Fprintln(a.stderr, `{"event":"terminal","outcome":"failure","errorCategory":"output"}`)
		return 1
	}
	return 0
}

func trackerBlock(value string) (domain.BlockNumber, error) {
	block, err := domain.ParseBlockNumber(value)
	if err != nil || uint64(block) > math.MaxInt64 {
		return 0, errors.New("invalid block number")
	}
	return block, nil
}

// requiredConnections enforces the command-specific environment contract without PG fallbacks.
func requiredConnections(getenv func(string) string, requireRPC bool) (string, string, bool) {
	databaseURL := getenv("DATABASE_URL")
	rpcURL := getenv("RPC_URL")
	if strings.TrimSpace(databaseURL) == "" || databaseURL != strings.TrimSpace(databaseURL) {
		return "", "", false
	}
	if requireRPC && (strings.TrimSpace(rpcURL) == "" || rpcURL != strings.TrimSpace(rpcURL)) {
		return "", "", false
	}
	return rpcURL, databaseURL, true
}

type eventLogger struct {
	logger                    *slog.Logger
	runID, datasetID, version string
}

func newEventLogger(writer io.Writer, runID, datasetID, version string) eventLogger {
	return eventLogger{logger: slog.New(slog.NewJSONHandler(writer, &slog.HandlerOptions{Level: slog.LevelInfo})), runID: runID, datasetID: datasetID, version: version}
}

// log emits the exact safe fields for one lifecycle event and never accepts a raw error.
func (l eventLogger) log(event tracker.CollectorEvent) {
	attrs := []any{"event", string(event.Kind), "runId", l.runID, "datasetId", l.datasetID, "datasetVersion", l.version}
	switch event.Kind {
	case tracker.EventStart:
		attrs = append(attrs, "startBlock", event.StartBlock.String(), "endBlock", event.EndBlock.String())
	case tracker.EventResume:
		attrs = append(attrs, "nextBlock", event.NextBlock.String(), "complete", event.Complete)
	case tracker.EventSplit:
		attrs = append(attrs, "startBlock", event.StartBlock.String(), "endBlock", event.EndBlock.String(), "previousChunkSize", event.PreviousChunkSize, "newChunkSize", event.NewChunkSize, "errorCategory", event.ErrorCategory)
	case tracker.EventRetry:
		attrs = append(attrs, "operation", event.Operation, "attempt", event.Attempt, "delay", event.Delay.String(), "errorCategory", event.ErrorCategory)
		if event.HasRange {
			attrs = append(attrs, "startBlock", event.StartBlock.String(), "endBlock", event.EndBlock.String())
		}
	case tracker.EventCommit:
		attrs = append(attrs, "startBlock", event.StartBlock.String(), "endBlock", event.EndBlock.String(), "blockCount", event.BlockCount, "transactionCount", event.TransactionCount, "transferCount", event.TransferCount)
	case tracker.EventTerminal:
		attrs = append(attrs, "outcome", event.Outcome, "status", event.Status)
		if event.ErrorCategory != "" {
			attrs = append(attrs, "errorCategory", event.ErrorCategory)
		}
	}
	l.logger.Info("indexer", attrs...)
}

// safeCategory reduces operator-visible failures to a fixed vocabulary.
func safeCategory(err error) string {
	switch {
	case errors.Is(err, rpc.ErrRangeLimit):
		return "range_limit"
	case errors.Is(err, rpc.ErrResultLimit):
		return "result_limit"
	case errors.Is(err, rpc.ErrTemporary):
		return "temporary"
	case errors.Is(err, tracker.ErrFinalizedRange):
		return "finalized_range"
	case errors.Is(err, tracker.ErrDatasetAlreadyReady):
		return "already_ready"
	case errors.Is(err, tracker.ErrDatasetAlreadyInvalidated):
		return "already_invalidated"
	case errors.Is(err, tracker.ErrDatasetSpecMismatch):
		return "dataset_spec_mismatch"
	case errors.Is(err, tracker.ErrDatasetRequiresNewVersion):
		return "boundary_hash_changed"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline"
	default:
		return "fatal"
	}
}

// randomRunID creates a non-secret per-invocation correlation identifier.
func randomRunID() (string, error) {
	data := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

type liveCollectRuntime struct {
	collector *tracker.Collector
	store     *storage.Postgres
	pool      *pgxpool.Pool
	client    *rpc.EthereumClient
}

func (r *liveCollectRuntime) Collect(ctx context.Context, request tracker.CollectRequest) (storage.Dataset, error) {
	return r.collector.Collect(ctx, request)
}
func (r *liveCollectRuntime) GetDataset(ctx context.Context, key storage.DatasetKey) (storage.Dataset, error) {
	return r.store.GetDataset(ctx, key)
}
func (r *liveCollectRuntime) CommittedBoundaries(ctx context.Context, key storage.DatasetKey) ([]storage.BoundaryHash, error) {
	return r.store.CommittedBoundaries(ctx, key)
}
func (r *liveCollectRuntime) Close() { r.client.Close(); r.pool.Close() }

type liveManifestRuntime struct {
	store *storage.Postgres
	pool  *pgxpool.Pool
}

func (r *liveManifestRuntime) GetDataset(ctx context.Context, key storage.DatasetKey) (storage.Dataset, error) {
	return r.store.GetDataset(ctx, key)
}
func (r *liveManifestRuntime) CommittedBoundaries(ctx context.Context, key storage.DatasetKey) ([]storage.BoundaryHash, error) {
	return r.store.CommittedBoundaries(ctx, key)
}
func (r *liveManifestRuntime) Close() { r.pool.Close() }

// productionDependencies creates bounded pgx/RPC resources only after CLI validation succeeds.
func productionDependencies() dependencies {
	return dependencies{
		openCollect: func(ctx context.Context, databaseURL, rpcURL string, settings tracker.CollectorSettings, observer func(tracker.CollectorEvent)) (collectRuntime, error) {
			pool, err := openPool(ctx, databaseURL)
			if err != nil {
				return nil, err
			}
			client, err := rpc.NewEthereumClient(ctx, rpcURL)
			if err != nil {
				pool.Close()
				return nil, err
			}
			store := storage.NewPostgres(pool)
			collector, err := tracker.NewCollector(client, store, settings, observer)
			if err != nil {
				client.Close()
				pool.Close()
				return nil, err
			}
			return &liveCollectRuntime{collector: collector, store: store, pool: pool, client: client}, nil
		},
		openManifest: func(ctx context.Context, databaseURL string) (manifestRuntime, error) {
			pool, err := openPool(ctx, databaseURL)
			if err != nil {
				return nil, err
			}
			return &liveManifestRuntime{store: storage.NewPostgres(pool), pool: pool}, nil
		},
		runID: randomRunID,
	}
}

// openPool creates and pings a bounded pool with capacity for one advisory lock and one transaction.
func openPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid database connection configuration")
	}
	if config.MaxConns < 2 {
		config.MaxConns = 2
	}
	connectCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(connectCtx, config)
	if err != nil {
		return nil, errors.New("database connection failed")
	}
	if err := pool.Ping(connectCtx); err != nil {
		pool.Close()
		return nil, errors.New("database connection failed")
	}
	return pool, nil
}

func defaultApplication(stdout, stderr io.Writer) application {
	return application{stdout: stdout, stderr: stderr, getenv: os.Getenv, deps: productionDependencies()}
}
