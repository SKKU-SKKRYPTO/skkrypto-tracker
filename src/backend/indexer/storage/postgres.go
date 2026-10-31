package storage

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// Postgres는 Indexer의 Snapshot Dataset과 성공 청크를 PostgreSQL에 저장한다.
type Postgres struct {
	db postgresDB
}

// NewPostgres는 연결 풀이 준비된 Indexer 저장 구현을 만든다.
// 연결 풀의 종료는 호출자가 담당한다.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{db: pgxPool{pool: pool}}
}

type postgresRow interface {
	Scan(dest ...any) error
}

type postgresRows interface {
	Close()
	Err() error
	Next() bool
	Scan(dest ...any) error
}

type postgresTx interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (postgresRows, error)
	QueryRow(ctx context.Context, sql string, args ...any) postgresRow
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

type postgresConn interface {
	QueryRow(ctx context.Context, sql string, args ...any) postgresRow
	Release()
	Destroy(ctx context.Context) error
}

type postgresDB interface {
	Begin(ctx context.Context) (postgresTx, error)
	Acquire(ctx context.Context) (postgresConn, error)
}

type pgxPool struct {
	pool *pgxpool.Pool
}

// Begin은 청크 저장에 사용할 PostgreSQL 트랜잭션을 시작한다.
func (p pgxPool) Begin(ctx context.Context) (postgresTx, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return pgxTx{Tx: tx}, nil
}

// Acquire는 세션 advisory lock을 유지할 전용 연결을 빌린다.
func (p pgxPool) Acquire(ctx context.Context) (postgresConn, error) {
	conn, err := p.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	return pgxConn{Conn: conn}, nil
}

type pgxTx struct {
	pgx.Tx
}

// Query는 pgx 트랜잭션의 다중 행 조회를 내부 인터페이스로 전달한다.
func (t pgxTx) Query(ctx context.Context, sql string, args ...any) (postgresRows, error) {
	return t.Tx.Query(ctx, sql, args...)
}

// QueryRow는 pgx 트랜잭션의 단일 행 조회를 내부 인터페이스로 전달한다.
func (t pgxTx) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	return t.Tx.QueryRow(ctx, sql, args...)
}

type pgxConn struct {
	*pgxpool.Conn
}

// QueryRow는 advisory lock 연결의 단일 행 조회를 내부 인터페이스로 전달한다.
func (c pgxConn) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	return c.Conn.QueryRow(ctx, sql, args...)
}

// Destroy는 잠금 해제에 실패한 연결을 풀에 돌려보내지 않고 닫는다.
func (c pgxConn) Destroy(ctx context.Context) error {
	return c.Conn.Hijack().Close(ctx)
}

// CreateDataset은 자산 정보를 대조하고 새 Snapshot Dataset을 COLLECTING 상태로 저장한다.
func (p *Postgres) CreateDataset(ctx context.Context, spec DatasetSpec) error {
	if err := validateDatasetSpec(spec); err != nil {
		return err
	}

	tx, err := p.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin create dataset: %w", err)
	}
	defer rollback(tx)

	if _, err := tx.Exec(ctx, `
INSERT INTO assets (chain_id, token_address, symbol, decimals)
VALUES ($1, $2, $3, $4)
ON CONFLICT DO NOTHING`,
		int64(spec.Asset.ChainID),
		strings.ToLower(spec.Asset.TokenAddress),
		spec.Asset.Symbol,
		int16(spec.Asset.Decimals),
	); err != nil {
		return fmt.Errorf("insert asset: %w", err)
	}

	var symbol string
	var decimals int16
	if err := tx.QueryRow(ctx, `
SELECT symbol, decimals
FROM assets
WHERE chain_id = $1 AND token_address = $2`,
		int64(spec.Asset.ChainID),
		strings.ToLower(spec.Asset.TokenAddress),
	).Scan(&symbol, &decimals); err != nil {
		return fmt.Errorf("read asset: %w", err)
	}
	if symbol != spec.Asset.Symbol || int(decimals) != spec.Asset.Decimals {
		return fmt.Errorf("%w: asset metadata", ErrInconsistentSource)
	}

	startBlock, err := postgresBlock(spec.Coverage.StartBlock)
	if err != nil {
		return err
	}
	endBlock, err := postgresBlock(spec.Coverage.EndBlock)
	if err != nil {
		return err
	}
	finalizedBlock, err := postgresBlock(spec.FinalizedBlock)
	if err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
INSERT INTO datasets (
    dataset_id,
    dataset_version,
    source_mode,
    source_namespace,
    status,
    chain_id,
    token_address,
    start_block,
    end_block,
    start_time,
    end_time,
    finalized_block
)
VALUES ($1, $2, 'SNAPSHOT', $3, 'COLLECTING', $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT DO NOTHING`,
		spec.Key.ID,
		spec.Key.Version,
		spec.SourceNamespace,
		int64(spec.Asset.ChainID),
		strings.ToLower(spec.Asset.TokenAddress),
		startBlock,
		endBlock,
		spec.Coverage.StartTime.UTC(),
		spec.Coverage.EndTime.UTC(),
		finalizedBlock,
	)
	if err != nil {
		return fmt.Errorf("insert dataset: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: %s/%s", ErrDatasetExists, spec.Key.ID, spec.Key.Version)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit create dataset: %w", err)
	}
	return nil
}

// TryLockDataset은 같은 Dataset 버전의 동시 수집을 막는 advisory lock을 시도한다.
func (p *Postgres) TryLockDataset(ctx context.Context, key DatasetKey) (*CollectionLock, error) {
	if err := validateKey(key); err != nil {
		return nil, err
	}
	conn, err := p.db.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire dataset lock connection: %w", err)
	}

	lockName := datasetLockName(key)
	var locked bool
	if err := conn.QueryRow(ctx, `
SELECT pg_try_advisory_lock(hashtextextended($1, 0))`, lockName).Scan(&locked); err != nil {
		conn.Release()
		return nil, fmt.Errorf("acquire dataset lock: %w", err)
	}
	if !locked {
		conn.Release()
		return nil, fmt.Errorf("%w: %s/%s", ErrDatasetLocked, key.ID, key.Version)
	}
	return &CollectionLock{conn: conn, name: lockName}, nil
}

// CollectionLock은 동일한 Dataset 버전의 중복 수집을 막는 PostgreSQL advisory lock이다.
type CollectionLock struct {
	mu       sync.Mutex
	conn     postgresConn
	name     string
	released bool
}

// Release는 수집이 끝난 뒤 advisory lock이 잡힌 연결을 해제한다.
func (l *CollectionLock) Release(ctx context.Context) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.released {
		return nil
	}
	l.released = true

	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	var unlocked bool
	if err := l.conn.QueryRow(cleanupCtx, `
SELECT pg_advisory_unlock(hashtextextended($1, 0))`, l.name).Scan(&unlocked); err != nil {
		_ = l.conn.Destroy(cleanupCtx)
		return fmt.Errorf("release dataset lock: %w", err)
	}
	if !unlocked {
		_ = l.conn.Destroy(cleanupCtx)
		return errors.New("release dataset lock: lock was not held")
	}
	l.conn.Release()
	return nil
}

// CommitChunk는 정규화된 청크의 모든 행과 체크포인트를 한 트랜잭션으로 저장한다.
func (p *Postgres) CommitChunk(ctx context.Context, chunk Chunk) error {
	if err := validateKey(chunk.Key); err != nil {
		return err
	}

	tx, err := p.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin commit chunk: %w", err)
	}
	defer rollback(tx)

	dataset, err := loadDatasetForUpdate(ctx, tx, chunk.Key)
	if err != nil {
		return err
	}
	if dataset.status != domain.StatusCollecting {
		return fmt.Errorf("%w: status is %s", ErrDatasetNotCollecting, dataset.status)
	}
	if err := validateChunk(chunk, dataset); err != nil {
		return err
	}

	startBlock, _ := postgresBlock(chunk.StartBlock)
	endBlock, _ := postgresBlock(chunk.EndBlock)
	var existingStart, existingEnd int64
	err = tx.QueryRow(ctx, `
SELECT start_block, end_block
FROM ingestion_chunks
WHERE dataset_id = $1
  AND dataset_version = $2
  AND start_block <= $4
  AND end_block >= $3
ORDER BY start_block
LIMIT 1`, chunk.Key.ID, chunk.Key.Version, startBlock, endBlock).Scan(&existingStart, &existingEnd)
	switch {
	case err == nil && existingStart == startBlock && existingEnd == endBlock:
		return fmt.Errorf("%w: %d-%d", ErrChunkAlreadyCommitted, startBlock, endBlock)
	case err == nil:
		return fmt.Errorf("%w: %d-%d with %d-%d", ErrChunkOverlap, startBlock, endBlock, existingStart, existingEnd)
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("check chunk overlap: %w", err)
	}

	for _, block := range chunk.Blocks {
		if err := storeBlock(ctx, tx, chunk.Key, block); err != nil {
			return err
		}
	}
	for _, transaction := range chunk.Transactions {
		if err := storeTransaction(ctx, tx, chunk.Key, transaction); err != nil {
			return err
		}
	}

	transactions := make(map[string]Transaction, len(chunk.Transactions))
	for _, transaction := range chunk.Transactions {
		transactions[transaction.Hash] = transaction
	}
	for _, transfer := range chunk.Transfers {
		transaction := transactions[transfer.TxHash]
		if err := storeTransfer(ctx, tx, dataset, transfer); err != nil {
			return err
		}
		if err := linkTransfer(ctx, tx, chunk.Key, transfer, transaction); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO ingestion_chunks (dataset_id, dataset_version, start_block, end_block)
VALUES ($1, $2, $3, $4)`, chunk.Key.ID, chunk.Key.Version, startBlock, endBlock); err != nil {
		return fmt.Errorf("insert ingestion chunk: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit chunk: %w", err)
	}
	return nil
}

// ResumePoint는 Dataset 시작부터 연속해서 저장된 마지막 청크 다음 위치를 반환한다.
func (p *Postgres) ResumePoint(ctx context.Context, key DatasetKey) (ResumePoint, error) {
	if err := validateKey(key); err != nil {
		return ResumePoint{}, err
	}
	tx, err := p.db.Begin(ctx)
	if err != nil {
		return ResumePoint{}, fmt.Errorf("begin resume point: %w", err)
	}
	defer rollback(tx)

	dataset, err := loadDataset(ctx, tx, key, false)
	if err != nil {
		return ResumePoint{}, err
	}
	if dataset.status != domain.StatusCollecting {
		return ResumePoint{}, fmt.Errorf("%w: status is %s", ErrDatasetNotCollecting, dataset.status)
	}
	point, err := readResumePoint(ctx, tx, dataset)
	if err != nil {
		return ResumePoint{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ResumePoint{}, fmt.Errorf("commit resume point: %w", err)
	}
	return point, nil
}

// MarkReady는 전체 범위와 검증된 마지막 경계 hash를 확인한 뒤 Dataset을 게시한다.
func (p *Postgres) MarkReady(ctx context.Context, key DatasetKey, boundary *BoundaryHash, collectedAt time.Time) error {
	if err := validateKey(key); err != nil {
		return err
	}
	if collectedAt.IsZero() {
		return invalidInput("collectedAt is required")
	}

	tx, err := p.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin mark ready: %w", err)
	}
	defer rollback(tx)

	dataset, err := loadDatasetForUpdate(ctx, tx, key)
	if err != nil {
		return err
	}
	if dataset.status != domain.StatusCollecting {
		return fmt.Errorf("%w: %s to READY", ErrInvalidStatusTransition, dataset.status)
	}
	point, err := readResumePoint(ctx, tx, dataset)
	if err != nil {
		return err
	}
	if !point.Complete || point.Boundary == nil {
		return ErrIncompleteCoverage
	}
	if boundary == nil {
		return invalidInput("READY transition requires a verified boundary hash")
	}
	if boundary.BlockNumber != point.Boundary.BlockNumber || boundary.BlockHash != point.Boundary.BlockHash {
		return fmt.Errorf("%w: READY boundary hash", ErrInconsistentSource)
	}

	if _, err := tx.Exec(ctx, `
UPDATE datasets
SET status = 'READY', collected_at = $3
WHERE dataset_id = $1 AND dataset_version = $2`, key.ID, key.Version, collectedAt.UTC()); err != nil {
		return fmt.Errorf("update dataset READY: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit mark ready: %w", err)
	}
	return nil
}

// MarkFailed는 수집 중인 Dataset을 FAILED 상태로 전환한다.
func (p *Postgres) MarkFailed(ctx context.Context, key DatasetKey) error {
	return p.changeStatus(ctx, key, domain.StatusFailed, "")
}

// Invalidate는 수집 중이거나 게시된 Dataset을 사유와 함께 INVALIDATED로 전환한다.
func (p *Postgres) Invalidate(ctx context.Context, key DatasetKey, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return invalidInput("invalidation reason is required")
	}
	return p.changeStatus(ctx, key, domain.StatusInvalidated, reason)
}

// changeStatus는 Dataset 행을 잠근 상태에서 허용된 상태 전환만 적용한다.
func (p *Postgres) changeStatus(ctx context.Context, key DatasetKey, target, reason string) error {
	if err := validateKey(key); err != nil {
		return err
	}
	tx, err := p.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin change status: %w", err)
	}
	defer rollback(tx)

	dataset, err := loadDatasetForUpdate(ctx, tx, key)
	if err != nil {
		return err
	}
	switch target {
	case domain.StatusFailed:
		if dataset.status != domain.StatusCollecting {
			return fmt.Errorf("%w: %s to FAILED", ErrInvalidStatusTransition, dataset.status)
		}
	case domain.StatusInvalidated:
		if dataset.status != domain.StatusCollecting && dataset.status != domain.StatusReady {
			return fmt.Errorf("%w: %s to INVALIDATED", ErrInvalidStatusTransition, dataset.status)
		}
	default:
		return invalidInput("unsupported target status")
	}

	if _, err := tx.Exec(ctx, `
UPDATE datasets
SET status = $3,
    invalidation_reason = CASE WHEN $3 = 'INVALIDATED' THEN $4 ELSE NULL END
WHERE dataset_id = $1 AND dataset_version = $2`, key.ID, key.Version, target, reason); err != nil {
		return fmt.Errorf("update dataset status: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit change status: %w", err)
	}
	return nil
}

type storedDataset struct {
	key          DatasetKey
	status       string
	chainID      uint64
	tokenAddress string
	startBlock   domain.BlockNumber
	endBlock     domain.BlockNumber
}

// loadDatasetForUpdate는 상태 변경과 청크 저장을 위해 Dataset 행을 잠가 읽는다.
func loadDatasetForUpdate(ctx context.Context, tx postgresTx, key DatasetKey) (storedDataset, error) {
	return loadDataset(ctx, tx, key, true)
}

// loadDataset은 Snapshot Dataset의 저장 범위와 현재 상태를 읽는다.
func loadDataset(ctx context.Context, tx postgresTx, key DatasetKey, forUpdate bool) (storedDataset, error) {
	query := `
SELECT status, chain_id, token_address, start_block, end_block
FROM datasets
WHERE dataset_id = $1
  AND dataset_version = $2
  AND source_mode = 'SNAPSHOT'`
	if forUpdate {
		query += "\nFOR UPDATE"
	}

	var dataset storedDataset
	var chainID, startBlock, endBlock int64
	err := tx.QueryRow(ctx, query, key.ID, key.Version).Scan(
		&dataset.status,
		&chainID,
		&dataset.tokenAddress,
		&startBlock,
		&endBlock,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return storedDataset{}, fmt.Errorf("%w: %s/%s", ErrNotFound, key.ID, key.Version)
	}
	if err != nil {
		return storedDataset{}, fmt.Errorf("read dataset: %w", err)
	}
	if chainID <= 0 || startBlock < 0 || endBlock < 0 {
		return storedDataset{}, fmt.Errorf("%w: invalid dataset values", ErrInconsistentSource)
	}
	dataset.key = key
	dataset.chainID = uint64(chainID)
	dataset.startBlock = domain.BlockNumber(startBlock)
	dataset.endBlock = domain.BlockNumber(endBlock)
	return dataset, nil
}

// storeBlock은 블록을 추가하거나 같은 번호의 기존 원천 값과 일치하는지 확인한다.
func storeBlock(ctx context.Context, tx postgresTx, key DatasetKey, block Block) error {
	number, err := postgresBlock(block.Number)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO blocks (
    dataset_id, dataset_version, block_number, block_hash, block_time
)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT DO NOTHING`,
		key.ID, key.Version, number, block.Hash, block.Time.UTC(),
	); err != nil {
		return fmt.Errorf("insert block %d: %w", block.Number, err)
	}

	var hash string
	var blockTime time.Time
	if err := tx.QueryRow(ctx, `
SELECT block_hash, block_time
FROM blocks
WHERE dataset_id = $1 AND dataset_version = $2 AND block_number = $3`,
		key.ID, key.Version, number,
	).Scan(&hash, &blockTime); err != nil {
		return fmt.Errorf("read block %d: %w", block.Number, err)
	}
	if hash != block.Hash || !blockTime.Equal(block.Time) {
		return fmt.Errorf("%w: block %d", ErrInconsistentSource, block.Number)
	}
	return nil
}

// storeTransaction은 거래 위치를 추가하거나 기존 원천 값과 일치하는지 확인한다.
func storeTransaction(ctx context.Context, tx postgresTx, key DatasetKey, transaction Transaction) error {
	blockNumber, err := postgresBlock(transaction.BlockNumber)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO transactions (
    dataset_id, dataset_version, tx_hash, block_number, transaction_index
)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT DO NOTHING`,
		key.ID,
		key.Version,
		transaction.Hash,
		blockNumber,
		int32(transaction.TransactionIndex),
	); err != nil {
		return fmt.Errorf("insert transaction %s: %w", transaction.Hash, err)
	}

	var hash string
	var storedBlock int64
	var index int32
	err = tx.QueryRow(ctx, `
SELECT tx_hash, block_number, transaction_index
FROM transactions
WHERE dataset_id = $1
  AND dataset_version = $2
  AND (
      tx_hash = $3
      OR (block_number = $4 AND transaction_index = $5)
  )
ORDER BY (tx_hash = $3) DESC
LIMIT 1`,
		key.ID,
		key.Version,
		transaction.Hash,
		blockNumber,
		int32(transaction.TransactionIndex),
	).Scan(&hash, &storedBlock, &index)
	if err != nil {
		return fmt.Errorf("read transaction %s: %w", transaction.Hash, err)
	}
	if hash != transaction.Hash || storedBlock != blockNumber || uint32(index) != transaction.TransactionIndex {
		return fmt.Errorf("%w: transaction %s", ErrInconsistentSource, transaction.Hash)
	}
	return nil
}

// storeTransfer는 Snapshot Transfer를 추가하거나 원천 ID와 불변 필드가 일치하는지 확인한다.
func storeTransfer(ctx context.Context, tx postgresTx, dataset storedDataset, transfer Transfer) error {
	if _, err := tx.Exec(ctx, `
INSERT INTO transfers (
    transfer_id,
    source_mode,
    chain_id,
    token_address,
    tx_hash,
    log_index,
    from_address,
    to_address,
    amount_raw
)
VALUES ($1, 'SNAPSHOT', $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT DO NOTHING`,
		transfer.ID,
		int64(dataset.chainID),
		dataset.tokenAddress,
		transfer.TxHash,
		int32(transfer.LogIndex),
		transfer.FromAddress,
		transfer.ToAddress,
		transfer.AmountRaw,
	); err != nil {
		return fmt.Errorf("insert transfer %s: %w", transfer.ID, err)
	}

	var (
		id, sourceMode, tokenAddress, txHash, fromAddress, toAddress, amountRaw string
		storedNamespace, storedRecordID                                         *string
		chainID                                                                 int64
		logIndex                                                                int32
	)
	if err := tx.QueryRow(ctx, `
SELECT
    transfer_id,
    source_mode,
    fixture_namespace,
    fixture_record_id,
    chain_id,
    token_address,
    tx_hash,
    log_index,
    from_address,
    to_address,
    amount_raw::text
FROM transfers
WHERE transfer_id = $1
   OR (source_mode = 'SNAPSHOT' AND chain_id = $2 AND tx_hash = $3 AND log_index = $4)
ORDER BY (transfer_id = $1) DESC
LIMIT 1`, transfer.ID, int64(dataset.chainID), transfer.TxHash, int32(transfer.LogIndex)).Scan(
		&id,
		&sourceMode,
		&storedNamespace,
		&storedRecordID,
		&chainID,
		&tokenAddress,
		&txHash,
		&logIndex,
		&fromAddress,
		&toAddress,
		&amountRaw,
	); err != nil {
		return fmt.Errorf("read transfer %s: %w", transfer.ID, err)
	}
	if id != transfer.ID || sourceMode != domain.SourceSnapshot || uint64(chainID) != dataset.chainID ||
		tokenAddress != dataset.tokenAddress || txHash != transfer.TxHash || uint32(logIndex) != transfer.LogIndex ||
		fromAddress != transfer.FromAddress || toAddress != transfer.ToAddress || amountRaw != transfer.AmountRaw {
		return fmt.Errorf("%w: transfer %s", ErrInconsistentSource, transfer.ID)
	}
	if storedNamespace != nil || storedRecordID != nil {
		return fmt.Errorf("%w: snapshot transfer %s", ErrInconsistentSource, transfer.ID)
	}
	return nil
}

// linkTransfer는 Dataset 포함 관계와 동일 위치의 Transfer 중복 여부를 저장한다.
func linkTransfer(ctx context.Context, tx postgresTx, key DatasetKey, transfer Transfer, transaction Transaction) error {
	blockNumber, _ := postgresBlock(transaction.BlockNumber)
	var existingID string
	err := tx.QueryRow(ctx, `
SELECT existing.transfer_id
FROM dataset_transfers dt
JOIN transfers existing ON existing.transfer_id = dt.transfer_id
JOIN transactions observed_tx
  ON observed_tx.dataset_id = dt.dataset_id
 AND observed_tx.dataset_version = dt.dataset_version
 AND observed_tx.tx_hash = existing.tx_hash
WHERE dt.dataset_id = $1
  AND dt.dataset_version = $2
  AND observed_tx.block_number = $3
  AND observed_tx.transaction_index = $4
  AND existing.log_index = $5
LIMIT 1`,
		key.ID,
		key.Version,
		blockNumber,
		int32(transaction.TransactionIndex),
		int32(transfer.LogIndex),
	).Scan(&existingID)
	if err == nil && existingID != transfer.ID {
		return fmt.Errorf("%w: transfer position already belongs to %s", ErrInconsistentSource, existingID)
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("check transfer position: %w", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO dataset_transfers (dataset_id, dataset_version, transfer_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING`, key.ID, key.Version, transfer.ID); err != nil {
		return fmt.Errorf("link transfer %s: %w", transfer.ID, err)
	}
	return nil
}

// readResumePoint는 저장된 청크가 Dataset 시작부터 겹침 없이 연속되는지 확인한다.
func readResumePoint(ctx context.Context, tx postgresTx, dataset storedDataset) (ResumePoint, error) {
	rows, err := tx.Query(ctx, `
SELECT c.start_block, c.end_block, b.block_hash
FROM ingestion_chunks c
JOIN blocks b
  ON b.dataset_id = c.dataset_id
 AND b.dataset_version = c.dataset_version
 AND b.block_number = c.end_block
WHERE c.dataset_id = $1 AND c.dataset_version = $2
ORDER BY c.start_block`, dataset.key.ID, dataset.key.Version)
	if err != nil {
		return ResumePoint{}, fmt.Errorf("read committed chunks: %w", err)
	}
	defer rows.Close()

	expected := dataset.startBlock
	point := ResumePoint{NextBlock: expected}
	for rows.Next() {
		var start, end int64
		var hash string
		if err := rows.Scan(&start, &end, &hash); err != nil {
			return ResumePoint{}, fmt.Errorf("scan committed chunk: %w", err)
		}
		if start < 0 || end < start || domain.BlockNumber(start) != expected || domain.BlockNumber(end) > dataset.endBlock {
			return ResumePoint{}, ErrIncompleteCoverage
		}
		boundary := &BoundaryHash{BlockNumber: domain.BlockNumber(end), BlockHash: hash}
		point.Boundary = boundary
		point.NextBlock = domain.BlockNumber(end) + 1
		expected = point.NextBlock
	}
	if err := rows.Err(); err != nil {
		return ResumePoint{}, fmt.Errorf("read committed chunks: %w", err)
	}
	point.Complete = point.Boundary != nil && point.Boundary.BlockNumber == dataset.endBlock
	return point, nil
}

// validateDatasetSpec은 Base Sepolia Snapshot의 자산·범위·finality 입력을 검사한다.
func validateDatasetSpec(spec DatasetSpec) error {
	if err := validateKey(spec.Key); err != nil {
		return err
	}
	if strings.TrimSpace(spec.SourceNamespace) == "" {
		return invalidInput("source namespace is required")
	}
	if spec.Asset.ChainID != domain.ChainID {
		return invalidInput("chainId must be Base Sepolia")
	}
	if !lowerAddress(spec.Asset.TokenAddress) {
		return invalidInput("token address must be a lowercase EVM address")
	}
	if strings.TrimSpace(spec.Asset.Symbol) == "" || spec.Asset.Decimals < 0 || spec.Asset.Decimals > 255 {
		return invalidInput("invalid asset metadata")
	}
	if spec.Coverage.EndBlock < spec.Coverage.StartBlock || spec.Coverage.StartTime.IsZero() ||
		spec.Coverage.EndTime.IsZero() || spec.Coverage.EndTime.Before(spec.Coverage.StartTime) {
		return invalidInput("invalid dataset coverage")
	}
	if spec.Coverage.EndBlock > spec.FinalizedBlock {
		return invalidInput("snapshot end block exceeds finalized block")
	}
	return nil
}

// validateChunk는 청크 범위와 Block·Transaction·Transfer의 참조 관계를 검사한다.
func validateChunk(chunk Chunk, dataset storedDataset) error {
	if chunk.EndBlock < chunk.StartBlock || chunk.StartBlock < dataset.startBlock || chunk.EndBlock > dataset.endBlock {
		return invalidInput("chunk range is outside dataset coverage")
	}
	blocks := make(map[domain.BlockNumber]Block, len(chunk.Blocks))
	for _, block := range chunk.Blocks {
		if block.Number < chunk.StartBlock || block.Number > chunk.EndBlock || !lowerHash(block.Hash) || block.Time.IsZero() {
			return invalidInput("invalid block record")
		}
		if _, exists := blocks[block.Number]; exists {
			return invalidInput("duplicate block record")
		}
		blocks[block.Number] = block
	}
	if _, ok := blocks[chunk.EndBlock]; !ok {
		return invalidInput("chunk end block record is required")
	}
	if chunk.StartBlock == dataset.startBlock {
		if _, ok := blocks[chunk.StartBlock]; !ok {
			return invalidInput("dataset start block record is required")
		}
	}

	transactions := make(map[string]Transaction, len(chunk.Transactions))
	positions := make(map[string]struct{}, len(chunk.Transactions))
	for _, transaction := range chunk.Transactions {
		if !lowerHash(transaction.Hash) || transaction.BlockNumber < chunk.StartBlock || transaction.BlockNumber > chunk.EndBlock ||
			transaction.TransactionIndex > math.MaxInt32 {
			return invalidInput("invalid transaction record")
		}
		if _, ok := blocks[transaction.BlockNumber]; !ok {
			return invalidInput("transaction block record is required")
		}
		if _, exists := transactions[transaction.Hash]; exists {
			return invalidInput("duplicate transaction hash")
		}
		position := fmt.Sprintf("%d:%d", transaction.BlockNumber, transaction.TransactionIndex)
		if _, exists := positions[position]; exists {
			return invalidInput("duplicate transaction position")
		}
		transactions[transaction.Hash] = transaction
		positions[position] = struct{}{}
	}

	transferIDs := make(map[string]struct{}, len(chunk.Transfers))
	transferPositions := make(map[string]struct{}, len(chunk.Transfers))
	for _, transfer := range chunk.Transfers {
		transaction, ok := transactions[transfer.TxHash]
		if !ok {
			return invalidInput("transfer transaction record is required")
		}
		if transfer.LogIndex > math.MaxInt32 || !lowerAddress(transfer.FromAddress) || !lowerAddress(transfer.ToAddress) {
			return invalidInput("invalid transfer record")
		}
		if _, err := domain.ParseAmount(transfer.AmountRaw); err != nil {
			return fmt.Errorf("%w: amountRaw: %v", ErrInvalidStorageInput, err)
		}
		if transfer.ID != domain.SnapshotTransferID(dataset.chainID, transfer.TxHash, transfer.LogIndex) {
			return invalidInput("invalid snapshot transfer ID")
		}
		if _, exists := transferIDs[transfer.ID]; exists {
			return invalidInput("duplicate transfer ID")
		}
		position := fmt.Sprintf("%d:%d:%d", transaction.BlockNumber, transaction.TransactionIndex, transfer.LogIndex)
		if _, exists := transferPositions[position]; exists {
			return invalidInput("duplicate transfer position")
		}
		transferIDs[transfer.ID] = struct{}{}
		transferPositions[position] = struct{}{}
	}
	return nil
}

// validateKey는 Dataset ID와 버전이 모두 있는지 확인한다.
func validateKey(key DatasetKey) error {
	if strings.TrimSpace(key.ID) == "" || strings.TrimSpace(key.Version) == "" {
		return invalidInput("dataset ID and version are required")
	}
	return nil
}

// invalidInput은 저장 입력 검증 오류에 공통 sentinel을 붙인다.
func invalidInput(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidStorageInput, message)
}

// postgresBlock은 BlockNumber가 PostgreSQL BIGINT 범위에 들어오는지 확인한다.
func postgresBlock(block domain.BlockNumber) (int64, error) {
	if uint64(block) > math.MaxInt64 {
		return 0, invalidInput("block number exceeds PostgreSQL BIGINT")
	}
	return int64(block), nil
}

// lowerAddress는 값이 소문자 EVM 주소 형식인지 확인한다.
func lowerAddress(value string) bool {
	return domain.ValidAddress(value) && value == strings.ToLower(value)
}

// lowerHash는 값이 소문자 EVM hash 형식인지 확인한다.
func lowerHash(value string) bool {
	return domain.ValidHash(value) && value == strings.ToLower(value)
}

// datasetLockName은 두 DatasetKey 필드의 경계를 보존한 advisory lock 키를 만든다.
func datasetLockName(key DatasetKey) string {
	return strconv.Itoa(len(key.ID)) + ":" + key.ID + key.Version
}

// rollback은 성공적으로 커밋되지 않은 트랜잭션을 정리한다.
func rollback(tx postgresTx) {
	_ = tx.Rollback(context.Background())
}
