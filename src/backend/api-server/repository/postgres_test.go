package repository

import (
	"context"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

type scanFunc func(dest ...any) error

// Scan은 테스트가 지정한 행 스캔 함수를 실행한다.
func (f scanFunc) Scan(dest ...any) error { return f(dest...) }

type fakeRows struct {
	rows   []postgresRow
	index  int
	err    error
	closed bool
}

// Close는 행 반복자가 닫혔음을 기록한다.
func (r *fakeRows) Close() { r.closed = true }

// Err는 행 반복 중 주입된 오류를 반환한다.
func (r *fakeRows) Err() error { return r.err }

// Next는 스캔할 테스트 행이 남았는지 확인한다.
func (r *fakeRows) Next() bool { return r.index < len(r.rows) }

// Scan은 현재 테스트 행을 읽고 다음 행으로 이동한다.
func (r *fakeRows) Scan(dest ...any) error {
	row := r.rows[r.index]
	r.index++
	return row.Scan(dest...)
}

type queryCall struct {
	sql  string
	args []any
}

type fakePostgresDB struct {
	queryRows     postgresRows
	queryErr      error
	rowQueue      []postgresRow
	queryCalls    []queryCall
	queryRowCalls []queryCall
}

// Query는 다중 행 조회 호출을 기록하고 준비된 행 또는 오류를 반환한다.
func (db *fakePostgresDB) Query(_ context.Context, sql string, args ...any) (postgresRows, error) {
	db.queryCalls = append(db.queryCalls, queryCall{sql: sql, args: args})
	if db.queryErr != nil {
		return nil, db.queryErr
	}
	return db.queryRows, nil
}

// QueryRow는 단일 행 조회 호출을 기록하고 준비된 행을 순서대로 반환한다.
func (db *fakePostgresDB) QueryRow(_ context.Context, sql string, args ...any) postgresRow {
	db.queryRowCalls = append(db.queryRowCalls, queryCall{sql: sql, args: args})
	if len(db.rowQueue) == 0 {
		return errorRow(errors.New("unexpected QueryRow"))
	}
	row := db.rowQueue[0]
	db.rowQueue = db.rowQueue[1:]
	return row
}

// valuesRow는 주어진 값들을 Scan 대상에 복사하는 테스트 행을 만든다.
func valuesRow(values ...any) postgresRow {
	return scanFunc(func(dest ...any) error {
		if len(dest) != len(values) {
			return errors.New("unexpected scan destination count")
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

// ptr은 nullable DB 값을 표현하기 위한 테스트 포인터를 만든다.
func ptr[T any](value T) *T { return &value }

// datasetRow는 Dataset 조회 결과 한 행을 테스트 값으로 구성한다.
func datasetRow(
	id, version, status string,
	finalizedBlock *int64,
	collectedAt *time.Time,
	invalidationReason *string,
	boundaries string,
) postgresRow {
	return valuesRow(
		id,
		version,
		domain.SourceFixture,
		id+"-"+version,
		status,
		int64(domain.ChainID),
		"0x0000000000000000000000000000000000001000",
		"SKK",
		int16(2),
		int64(100),
		int64(200),
		time.Date(2026, 10, 26, 12, 0, 0, 0, time.FixedZone("KST", 9*60*60)),
		time.Date(2026, 10, 26, 13, 0, 0, 0, time.FixedZone("KST", 9*60*60)),
		finalizedBlock,
		collectedAt,
		invalidationReason,
		boundaries,
	)
}

// transferRow는 Transfer 조회 결과 한 행을 테스트 값으로 구성한다.
func transferRow(id, from, to string, block int64, txIndex, logIndex int32) postgresRow {
	return valuesRow(
		id,
		int64(domain.ChainID),
		"0x0000000000000000000000000000000000001000",
		"SKK",
		int16(2),
		"0x0000000000000000000000000000000000000000000000000000000000000001",
		"0x0000000000000000000000000000000000000000000000000000000000000002",
		block,
		txIndex,
		logIndex,
		time.Date(2026, 10, 26, 12, 0, int(logIndex), 0, time.FixedZone("KST", 9*60*60)),
		from,
		to,
		"100",
		ptr(id),
		(*string)(nil),
	)
}

// TestPostgresListDatasets는 Dataset 목록의 정규화·정렬 쿼리·빈 컬렉션 표현을 검증한다.
func TestPostgresListDatasets(t *testing.T) {
	collectedAt := time.Date(2026, 10, 26, 14, 0, 0, 0, time.UTC)
	rows := &fakeRows{rows: []postgresRow{
		datasetRow("flow-demo", "v1", domain.StatusReady, ptr(int64(200)), &collectedAt, nil, `{"100":"0xaaa","200":"0xbbb"}`),
	}}
	db := &fakePostgresDB{queryRows: rows}
	repository := &Postgres{db: db}

	got, err := repository.ListDatasets(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "flow-demo" || got[0].FinalizedBlock == nil || *got[0].FinalizedBlock != 200 {
		t.Fatalf("datasets = %+v", got)
	}
	if got[0].CollectedAt == nil || !got[0].CollectedAt.Equal(collectedAt) {
		t.Fatalf("collectedAt = %v", got[0].CollectedAt)
	}
	if got[0].StartTime.Location() != time.UTC || got[0].BoundaryHashes["200"] != "0xbbb" {
		t.Fatalf("dataset normalization = %+v", got[0])
	}
	if got[0].Labels == nil || got[0].Notes == nil {
		t.Fatal("empty labels and notes must not be nil")
	}
	if !rows.closed {
		t.Fatal("rows must be closed")
	}
	if len(db.queryCalls) != 1 ||
		!strings.Contains(db.queryCalls[0].sql, "boundary.block_number = d.end_block") ||
		!strings.Contains(db.queryCalls[0].sql, "ORDER BY d.dataset_id") {
		t.Fatalf("query = %+v", db.queryCalls)
	}
}

// TestPostgresGetDatasetMapsNotFound는 pgx의 미조회 오류가 ErrNotFound로 변환되는지 검증한다.
func TestPostgresGetDatasetMapsNotFound(t *testing.T) {
	db := &fakePostgresDB{rowQueue: []postgresRow{errorRow(pgx.ErrNoRows)}}
	repository := &Postgres{db: db}

	_, err := repository.GetDataset(context.Background(), "missing", "v1")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
}

// TestPostgresGetDatasetKeepsFixtureNulls는 Fixture의 nullable 필드를 임의 값으로 채우지 않는지 검증한다.
func TestPostgresGetDatasetKeepsFixtureNulls(t *testing.T) {
	db := &fakePostgresDB{rowQueue: []postgresRow{
		datasetRow("collecting-demo", "v1", domain.StatusCollecting, nil, nil, nil, `{}`),
	}}
	repository := &Postgres{db: db}

	got, err := repository.GetDataset(context.Background(), "collecting-demo", "v1")
	if err != nil {
		t.Fatal(err)
	}
	if got.FinalizedBlock != nil || got.CollectedAt != nil || got.BoundaryHashes == nil {
		t.Fatalf("dataset = %+v", got)
	}
}

// TestPostgresListTransfersFiltersAndPaginates는 모든 필터와 위치 커서 기반 페이지 처리를 검증한다.
func TestPostgresListTransfersFiltersAndPaginates(t *testing.T) {
	zero := domain.ZeroAddress
	to := "0x0000000000000000000000000000000000000069"
	rows := &fakeRows{rows: []postgresRow{
		transferRow("fx:patterns-demo-v1:p1", zero, to, 101, 0, 0),
		transferRow("fx:patterns-demo-v1:p2", to, zero, 102, 0, 0),
		transferRow("fx:patterns-demo-v1:p3", to, to, 103, 0, 0),
	}}
	db := &fakePostgresDB{
		rowQueue: []postgresRow{valuesRow(
			domain.SourceFixture,
			"patterns-demo-v1",
			int64(domain.ChainID),
			"0x0000000000000000000000000000000000001000",
			int64(100),
			int64(200),
		)},
		queryRows: rows,
	}
	repository := &Postgres{db: db}
	startBlock, endBlock := domain.BlockNumber(100), domain.BlockNumber(200)
	startTime := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	endTime := startTime.Add(time.Hour)

	page, err := repository.ListTransfers(context.Background(), TransferQuery{
		DatasetID:      "patterns-demo",
		DatasetVersion: "v1",
		Address:        to,
		Direction:      DirectionIncoming,
		TxHash:         "0x0000000000000000000000000000000000000000000000000000000000000001",
		StartBlock:     &startBlock,
		EndBlock:       &endBlock,
		StartTime:      &startTime,
		EndTime:        &endTime,
		MinAmountRaw:   "100",
		After: &Cursor{
			Position: domain.Position{BlockNumber: 100, TransactionIndex: 0, LogIndex: 0},
			ID:       "fx:patterns-demo-v1:p0",
		},
		Limit: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !page.HasMore || len(page.Transfers) != 2 {
		t.Fatalf("page = %+v", page)
	}
	if page.Transfers[0].TransferType != domain.TransferTypeMint || page.Transfers[1].TransferType != domain.TransferTypeBurn {
		t.Fatalf("transfer types = %q, %q", page.Transfers[0].TransferType, page.Transfers[1].TransferType)
	}
	if page.Transfers[0].Timestamp.Location() != time.UTC {
		t.Fatalf("timestamp = %v", page.Transfers[0].Timestamp)
	}
	if len(db.queryCalls) != 1 {
		t.Fatalf("query calls = %d", len(db.queryCalls))
	}
	query := db.queryCalls[0].sql
	for _, part := range []string{
		"t.to_address =",
		"t.tx_hash =",
		"tx.block_number >=",
		"tx.block_number <=",
		"b.block_time >=",
		"b.block_time <=",
		"t.amount_raw >=",
		"(tx.block_number, tx.transaction_index, t.log_index, t.transfer_id) >",
		"ORDER BY tx.block_number, tx.transaction_index, t.log_index, t.transfer_id",
	} {
		if !strings.Contains(query, part) {
			t.Errorf("query does not contain %q", part)
		}
	}
	lastArg := db.queryCalls[0].args[len(db.queryCalls[0].args)-1]
	if lastArg != 3 {
		t.Fatalf("LIMIT arg = %#v", lastArg)
	}
}

// TestPostgresListTransfersReturnsNotFoundForMissingDataset은 없는 Dataset에서 Transfer 조회를 시작하지 않는지 검증한다.
func TestPostgresListTransfersReturnsNotFoundForMissingDataset(t *testing.T) {
	db := &fakePostgresDB{rowQueue: []postgresRow{errorRow(pgx.ErrNoRows)}}
	repository := &Postgres{db: db}

	_, err := repository.ListTransfers(context.Background(), TransferQuery{
		DatasetID: "missing", DatasetVersion: "v1", Limit: 10,
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	if len(db.queryCalls) != 0 {
		t.Fatal("transfer query must not run for a missing dataset")
	}
}

// TestPostgresListTransfersRejectsInvalidQuery는 잘못된 limit·금액·블록 범위를 거부하는지 검증한다.
func TestPostgresListTransfersRejectsInvalidQuery(t *testing.T) {
	repository := &Postgres{db: &fakePostgresDB{}}
	if _, err := repository.ListTransfers(context.Background(), TransferQuery{Limit: 0}); err == nil {
		t.Fatal("zero limit must fail")
	}
	if _, err := repository.ListTransfers(context.Background(), TransferQuery{Limit: 1, MinAmountRaw: "1.5"}); err == nil {
		t.Fatal("invalid amount must fail")
	}

	tooLarge := domain.BlockNumber(math.MaxUint64)
	_, _, err := buildTransferQuery(TransferQuery{StartBlock: &tooLarge, Limit: 1})
	if err == nil {
		t.Fatal("block outside BIGINT must fail")
	}
}
