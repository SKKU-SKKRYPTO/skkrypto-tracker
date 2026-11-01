package storage

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

type scanFunc func(dest ...any) error

// Scan은 테스트가 준비한 행 스캔 함수를 실행한다.
func (f scanFunc) Scan(dest ...any) error { return f(dest...) }

type stubRows struct {
	rows   []postgresRow
	index  int
	err    error
	closed bool
}

// Close는 행 반복자가 닫혔음을 기록한다.
func (r *stubRows) Close() { r.closed = true }

// Err는 행 반복 중 주입된 오류를 반환한다.
func (r *stubRows) Err() error { return r.err }

// Next는 스캔할 테스트 행이 남았는지 확인한다.
func (r *stubRows) Next() bool { return r.index < len(r.rows) }

// Scan은 현재 테스트 행을 읽고 다음 행으로 이동한다.
func (r *stubRows) Scan(dest ...any) error {
	row := r.rows[r.index]
	r.index++
	return row.Scan(dest...)
}

type queryResult struct {
	rows postgresRows
	err  error
}

type execResult struct {
	tag pgconn.CommandTag
	err error
}

// stubDB는 PostgreSQL 호출에 미리 정한 결과를 돌려주고 호출 내용을 기록한다.
// Postgres 저장 코드가 사용하는 DB·Tx·Connection 인터페이스를 하나로 구현한다.
type stubDB struct {
	execQueue  []execResult
	rowQueue   []postgresRow
	queryQueue []queryResult
	execSQL    []string
	querySQL   []string
	committed  bool
	rolledBack bool
	released   bool
	destroyed  bool
	beginErr   error
	acquireErr error
}

// Begin은 주입된 오류가 없으면 stubDB 자신을 트랜잭션으로 반환한다.
func (db *stubDB) Begin(context.Context) (postgresTx, error) {
	if db.beginErr != nil {
		return nil, db.beginErr
	}
	return db, nil
}

// Acquire는 주입된 오류가 없으면 stubDB 자신을 잠금 연결로 반환한다.
func (db *stubDB) Acquire(context.Context) (postgresConn, error) {
	if db.acquireErr != nil {
		return nil, db.acquireErr
	}
	return db, nil
}

// Exec은 실행 SQL을 기록하고 준비된 command tag나 오류를 반환한다.
func (db *stubDB) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	db.execSQL = append(db.execSQL, sql)
	if len(db.execQueue) == 0 {
		return pgconn.CommandTag{}, errors.New("unexpected Exec")
	}
	result := db.execQueue[0]
	db.execQueue = db.execQueue[1:]
	return result.tag, result.err
}

// Query는 조회 SQL을 기록하고 준비된 행 반복자나 오류를 반환한다.
func (db *stubDB) Query(_ context.Context, sql string, _ ...any) (postgresRows, error) {
	db.querySQL = append(db.querySQL, sql)
	if len(db.queryQueue) == 0 {
		return nil, errors.New("unexpected Query")
	}
	result := db.queryQueue[0]
	db.queryQueue = db.queryQueue[1:]
	return result.rows, result.err
}

// QueryRow는 준비된 단일 행 결과를 호출 순서대로 반환한다.
func (db *stubDB) QueryRow(_ context.Context, _ string, _ ...any) postgresRow {
	if len(db.rowQueue) == 0 {
		return errorRow(errors.New("unexpected QueryRow"))
	}
	row := db.rowQueue[0]
	db.rowQueue = db.rowQueue[1:]
	return row
}

// Commit은 트랜잭션이 커밋됐음을 기록한다.
func (db *stubDB) Commit(context.Context) error {
	db.committed = true
	return nil
}

// Rollback은 트랜잭션 정리 호출을 기록한다.
func (db *stubDB) Rollback(context.Context) error {
	db.rolledBack = true
	return nil
}

// Release는 advisory lock 연결이 풀로 반환됐음을 기록한다.
func (db *stubDB) Release() { db.released = true }

// Destroy는 advisory lock 연결이 폐기됐음을 기록한다.
func (db *stubDB) Destroy(context.Context) error {
	db.destroyed = true
	return nil
}

// valuesRow는 주어진 값들을 Scan 대상에 복사하는 테스트 행을 만든다.
func valuesRow(values ...any) postgresRow {
	return scanFunc(func(dest ...any) error {
		if len(dest) != len(values) {
			return fmt.Errorf("scan destinations = %d, values = %d", len(dest), len(values))
		}
		for i := range values {
			reflect.ValueOf(dest[i]).Elem().Set(reflect.ValueOf(values[i]))
		}
		return nil
	})
}

// errorRow는 Scan할 때 지정한 오류를 반환하는 테스트 행을 만든다.
func errorRow(err error) postgresRow {
	return scanFunc(func(...any) error { return err })
}

// affected는 지정된 행 수를 표현하는 테스트 command tag를 만든다.
func affected(rows int64) execResult {
	if rows == 0 {
		return execResult{tag: pgconn.NewCommandTag("INSERT 0 0")}
	}
	return execResult{tag: pgconn.NewCommandTag("INSERT 0 1")}
}

// sampleSpec은 두 블록 범위의 유효한 Snapshot Dataset 입력을 만든다.
func sampleSpec() DatasetSpec {
	return DatasetSpec{
		Key:             DatasetKey{ID: "snapshot-demo", Version: "v1"},
		SourceNamespace: "base-sepolia-snapshot",
		Asset: domain.Asset{
			ChainID:      domain.ChainID,
			TokenAddress: address(1000),
			Symbol:       "SKK",
			Decimals:     2,
		},
		Coverage: domain.Coverage{
			StartBlock: 100,
			EndBlock:   101,
			StartTime:  time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC),
			EndTime:    time.Date(2026, 10, 26, 12, 0, 2, 0, time.UTC),
		},
		FinalizedBlock: 200,
	}
}

// sampleStoredDataset은 sampleSpec과 같은 내부 Dataset 상태를 만든다.
func sampleStoredDataset() storedDataset {
	spec := sampleSpec()
	return storedDataset{
		key:          spec.Key,
		status:       domain.StatusCollecting,
		chainID:      spec.Asset.ChainID,
		tokenAddress: spec.Asset.TokenAddress,
		startBlock:   spec.Coverage.StartBlock,
		endBlock:     spec.Coverage.EndBlock,
	}
}

// sampleDatasetRow는 Dataset 조회 결과 한 행을 테스트 값으로 구성한다.
func sampleDatasetRow(status string) postgresRow {
	dataset := sampleStoredDataset()
	return valuesRow(
		status,
		int64(dataset.chainID),
		dataset.tokenAddress,
		int64(dataset.startBlock),
		int64(dataset.endBlock),
	)
}

// sampleChunk는 블록·거래·전송이 하나씩 연결된 유효한 청크를 만든다.
func sampleChunk() Chunk {
	dataset := sampleStoredDataset()
	txHash := hash(2000)
	return Chunk{
		Key:        dataset.key,
		StartBlock: dataset.startBlock,
		EndBlock:   dataset.endBlock,
		Blocks: []Block{
			{Number: 100, Hash: hash(100), Time: time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)},
			{Number: 101, Hash: hash(101), Time: time.Date(2026, 10, 26, 12, 0, 2, 0, time.UTC)},
		},
		Transactions: []Transaction{
			{Hash: txHash, BlockNumber: 101, TransactionIndex: 3},
		},
		Transfers: []Transfer{
			{
				ID:          domain.SnapshotTransferID(dataset.chainID, txHash, 4),
				TxHash:      txHash,
				LogIndex:    4,
				FromAddress: address(1),
				ToAddress:   address(2),
				AmountRaw:   "100",
			},
		},
	}
}

// hash는 테스트 정수를 32-byte EVM hash로 표현한다.
func hash(value int) string { return fmt.Sprintf("0x%064x", value) }

// address는 테스트 정수를 20-byte EVM 주소로 표현한다.
func address(value int) string { return fmt.Sprintf("0x%040x", value) }

// TestCreateDataset은 자산 대조와 Snapshot Dataset 생성이 한 트랜잭션으로 커밋되는지 검증한다.
func TestCreateDataset(t *testing.T) {
	db := &stubDB{
		execQueue: []execResult{affected(1), affected(1)},
		rowQueue:  []postgresRow{valuesRow("SKK", int16(2))},
	}
	storage := &Postgres{db: db}

	if err := storage.CreateDataset(context.Background(), sampleSpec()); err != nil {
		t.Fatal(err)
	}
	if !db.committed {
		t.Fatal("dataset transaction was not committed")
	}
	if len(db.execSQL) != 2 || !strings.Contains(db.execSQL[1], "INSERT INTO datasets") {
		t.Fatalf("exec SQL = %v", db.execSQL)
	}
	if !strings.Contains(db.execSQL[1], "'SNAPSHOT'") {
		t.Fatalf("dataset source mode is not fixed to SNAPSHOT: %s", db.execSQL[1])
	}
}

// TestCreateDatasetRejectsChangedAssetMetadata는 같은 자산 키의 metadata 변경을 거부하는지 검증한다.
func TestCreateDatasetRejectsChangedAssetMetadata(t *testing.T) {
	db := &stubDB{
		execQueue: []execResult{affected(0)},
		rowQueue:  []postgresRow{valuesRow("OTHER", int16(2))},
	}
	storage := &Postgres{db: db}

	err := storage.CreateDataset(context.Background(), sampleSpec())
	if !errors.Is(err, ErrInconsistentSource) {
		t.Fatalf("error = %v", err)
	}
	if db.committed {
		t.Fatal("inconsistent asset transaction was committed")
	}
}

// TestDatasetLock은 advisory lock의 획득·해제와 중복 해제 안전성을 검증한다.
func TestDatasetLock(t *testing.T) {
	db := &stubDB{rowQueue: []postgresRow{valuesRow(true), valuesRow(true)}}
	storage := &Postgres{db: db}

	lock, err := storage.TryLockDataset(context.Background(), sampleSpec().Key)
	if err != nil {
		t.Fatal(err)
	}
	if err := lock.Release(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !db.released || db.destroyed {
		t.Fatalf("released = %v, destroyed = %v", db.released, db.destroyed)
	}
	if err := lock.Release(context.Background()); err != nil {
		t.Fatalf("second release must be idempotent: %v", err)
	}
}

// TestDatasetLockBusy는 이미 실행 중인 Dataset의 두 번째 잠금이 거부되는지 검증한다.
func TestDatasetLockBusy(t *testing.T) {
	db := &stubDB{rowQueue: []postgresRow{valuesRow(false)}}
	storage := &Postgres{db: db}

	_, err := storage.TryLockDataset(context.Background(), sampleSpec().Key)
	if !errors.Is(err, ErrDatasetLocked) {
		t.Fatalf("error = %v", err)
	}
	if !db.released {
		t.Fatal("busy lock connection was not released")
	}
}

// TestCommitChunkStoresAllRecordsAtomically는 청크 구성 행과 체크포인트가 함께 커밋되는지 검증한다.
func TestCommitChunkStoresAllRecordsAtomically(t *testing.T) {
	chunk := sampleChunk()
	transaction := chunk.Transactions[0]
	transfer := chunk.Transfers[0]
	db := &stubDB{
		execQueue: []execResult{
			affected(1), affected(1), // blocks
			affected(1), // transaction
			affected(1), // transfer
			affected(1), // dataset transfer
			affected(1), // ingestion chunk
		},
		rowQueue: []postgresRow{
			sampleDatasetRow(domain.StatusCollecting),
			errorRow(pgx.ErrNoRows),
			valuesRow(chunk.Blocks[0].Hash, chunk.Blocks[0].Time),
			valuesRow(chunk.Blocks[1].Hash, chunk.Blocks[1].Time),
			valuesRow(transaction.Hash, int64(transaction.BlockNumber), int32(transaction.TransactionIndex)),
			valuesRow(
				transfer.ID,
				domain.SourceSnapshot,
				(*string)(nil),
				(*string)(nil),
				int64(domain.ChainID),
				sampleSpec().Asset.TokenAddress,
				transfer.TxHash,
				int32(transfer.LogIndex),
				transfer.FromAddress,
				transfer.ToAddress,
				transfer.AmountRaw,
			),
			errorRow(pgx.ErrNoRows),
		},
	}
	storage := &Postgres{db: db}

	if err := storage.CommitChunk(context.Background(), chunk); err != nil {
		t.Fatal(err)
	}
	if !db.committed {
		t.Fatal("chunk transaction was not committed")
	}
	if len(db.execSQL) != 6 || !strings.Contains(db.execSQL[5], "INSERT INTO ingestion_chunks") {
		t.Fatalf("exec SQL = %v", db.execSQL)
	}
	if !strings.Contains(db.execSQL[3], "'SNAPSHOT'") || strings.Contains(db.execSQL[3], "fixture_namespace") {
		t.Fatalf("transfer insert is not Snapshot-only: %s", db.execSQL[3])
	}
}

// TestCommitChunkRejectsOverlapBeforeWriting은 겹치는 청크가 행 저장 전에 거부되는지 검증한다.
func TestCommitChunkRejectsOverlapBeforeWriting(t *testing.T) {
	chunk := sampleChunk()
	db := &stubDB{
		rowQueue: []postgresRow{
			sampleDatasetRow(domain.StatusCollecting),
			valuesRow(int64(100), int64(100)),
		},
	}
	storage := &Postgres{db: db}

	err := storage.CommitChunk(context.Background(), chunk)
	if !errors.Is(err, ErrChunkOverlap) {
		t.Fatalf("error = %v", err)
	}
	if len(db.execSQL) != 0 || db.committed {
		t.Fatalf("execs = %d, committed = %v", len(db.execSQL), db.committed)
	}
}

// TestCommitChunkReportsAlreadyCommittedRange는 같은 범위 재처리를 구분해 반환하는지 검증한다.
func TestCommitChunkReportsAlreadyCommittedRange(t *testing.T) {
	chunk := sampleChunk()
	db := &stubDB{
		rowQueue: []postgresRow{
			sampleDatasetRow(domain.StatusCollecting),
			valuesRow(int64(chunk.StartBlock), int64(chunk.EndBlock)),
		},
	}
	storage := &Postgres{db: db}

	err := storage.CommitChunk(context.Background(), chunk)
	if !errors.Is(err, ErrChunkAlreadyCommitted) {
		t.Fatalf("error = %v", err)
	}
	if len(db.execSQL) != 0 || db.committed {
		t.Fatalf("execs = %d, committed = %v", len(db.execSQL), db.committed)
	}
}

// TestResumePointReturnsLastBoundary는 연속 청크 다음 위치와 마지막 경계 hash를 검증한다.
func TestResumePointReturnsLastBoundary(t *testing.T) {
	chunk := sampleChunk()
	rows := &stubRows{rows: []postgresRow{
		valuesRow(int64(chunk.StartBlock), int64(chunk.EndBlock), chunk.Blocks[1].Hash),
	}}
	db := &stubDB{
		rowQueue:   []postgresRow{sampleDatasetRow(domain.StatusCollecting)},
		queryQueue: []queryResult{{rows: rows}},
	}
	storage := &Postgres{db: db}

	point, err := storage.ResumePoint(context.Background(), chunk.Key)
	if err != nil {
		t.Fatal(err)
	}
	if !point.Complete || point.NextBlock != 102 || point.Boundary == nil || point.Boundary.BlockHash != chunk.Blocks[1].Hash {
		t.Fatalf("resume point = %+v", point)
	}
}

// TestMarkReadyChecksCoverageAndBoundary는 전체 범위와 검증된 경계가 있을 때만 게시하는지 검증한다.
func TestMarkReadyChecksCoverageAndBoundary(t *testing.T) {
	chunk := sampleChunk()
	rows := &stubRows{rows: []postgresRow{
		valuesRow(int64(chunk.StartBlock), int64(chunk.EndBlock), chunk.Blocks[1].Hash),
	}}
	db := &stubDB{
		execQueue:  []execResult{affected(1)},
		rowQueue:   []postgresRow{sampleDatasetRow(domain.StatusCollecting)},
		queryQueue: []queryResult{{rows: rows}},
	}
	storage := &Postgres{db: db}
	boundary := &BoundaryHash{BlockNumber: chunk.EndBlock, BlockHash: chunk.Blocks[1].Hash}

	if err := storage.MarkReady(context.Background(), chunk.Key, boundary, time.Now()); err != nil {
		t.Fatal(err)
	}
	if !db.committed || len(db.execSQL) != 1 || !strings.Contains(db.execSQL[0], "SET status = 'READY'") {
		t.Fatalf("committed = %v, exec SQL = %v", db.committed, db.execSQL)
	}
}

// TestMarkReadyRejectsGap은 청크 사이에 빈 범위가 있으면 READY 전환을 막는지 검증한다.
func TestMarkReadyRejectsGap(t *testing.T) {
	chunk := sampleChunk()
	rows := &stubRows{rows: []postgresRow{
		valuesRow(int64(101), int64(101), chunk.Blocks[1].Hash),
	}}
	db := &stubDB{
		rowQueue:   []postgresRow{sampleDatasetRow(domain.StatusCollecting)},
		queryQueue: []queryResult{{rows: rows}},
	}
	storage := &Postgres{db: db}
	boundary := &BoundaryHash{BlockNumber: chunk.EndBlock, BlockHash: chunk.Blocks[1].Hash}

	err := storage.MarkReady(context.Background(), chunk.Key, boundary, time.Now())
	if !errors.Is(err, ErrIncompleteCoverage) {
		t.Fatalf("error = %v", err)
	}
	if db.committed {
		t.Fatal("incomplete dataset was marked READY")
	}
}

// TestDatasetStatusTransitions는 허용된 FAILED·INVALIDATED 상태 전환을 검증한다.
func TestDatasetStatusTransitions(t *testing.T) {
	tests := []struct {
		name       string
		status     string
		transition func(*Postgres) error
	}{
		{
			name:   "collecting to failed",
			status: domain.StatusCollecting,
			transition: func(storage *Postgres) error {
				return storage.MarkFailed(context.Background(), sampleSpec().Key)
			},
		},
		{
			name:   "ready to invalidated",
			status: domain.StatusReady,
			transition: func(storage *Postgres) error {
				return storage.Invalidate(context.Background(), sampleSpec().Key, "boundary hash changed")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := &stubDB{
				execQueue: []execResult{affected(1)},
				rowQueue:  []postgresRow{sampleDatasetRow(tt.status)},
			}
			storage := &Postgres{db: db}

			if err := tt.transition(storage); err != nil {
				t.Fatal(err)
			}
			if !db.committed || len(db.execSQL) != 1 {
				t.Fatalf("committed = %v, exec SQL = %v", db.committed, db.execSQL)
			}
			if !strings.Contains(db.execSQL[0], "SET status = $3") {
				t.Fatalf("status SQL = %s", db.execSQL[0])
			}
		})
	}
}

// TestDatasetStatusTransitionRejectsReadyToFailed는 게시된 Dataset을 FAILED로 되돌리지 않는지 검증한다.
func TestDatasetStatusTransitionRejectsReadyToFailed(t *testing.T) {
	db := &stubDB{rowQueue: []postgresRow{sampleDatasetRow(domain.StatusReady)}}
	storage := &Postgres{db: db}

	err := storage.MarkFailed(context.Background(), sampleSpec().Key)
	if !errors.Is(err, ErrInvalidStatusTransition) {
		t.Fatalf("error = %v", err)
	}
	if db.committed {
		t.Fatal("invalid status transition was committed")
	}
}

// TestValidateDatasetSpecFinality는 종료 블록이 finalized 상한을 넘으면 거부하는지 검증한다.
func TestValidateDatasetSpecFinality(t *testing.T) {
	spec := sampleSpec()
	spec.FinalizedBlock = spec.Coverage.EndBlock - 1
	if err := validateDatasetSpec(spec); !errors.Is(err, ErrInvalidStorageInput) {
		t.Fatalf("error = %v", err)
	}
}

// TestValidateChunkRejectsWrongTransferID는 Snapshot 원천 필드와 다른 Transfer ID를 거부하는지 검증한다.
func TestValidateChunkRejectsWrongTransferID(t *testing.T) {
	chunk := sampleChunk()
	chunk.Transfers[0].ID = "wrong"
	if err := validateChunk(chunk, sampleStoredDataset()); !errors.Is(err, ErrInvalidStorageInput) {
		t.Fatalf("error = %v", err)
	}
}
