package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// Postgres는 PostgreSQL에 저장된 Dataset과 Transfer를 조회한다.
// 데이터가 Fixture Seed 또는 RPC 수집기 중 어디에서 들어왔는지는 알지 못한다.
type Postgres struct {
	db postgresDB
}

var _ Repository = (*Postgres)(nil)

// NewPostgres는 연결 풀이 준비된 PostgreSQL Repository를 만든다.
// 연결 풀의 종료는 이를 만든 호출자가 담당한다.
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

type postgresDB interface {
	Query(ctx context.Context, sql string, args ...any) (postgresRows, error)
	QueryRow(ctx context.Context, sql string, args ...any) postgresRow
}

type pgxPool struct {
	pool *pgxpool.Pool
}

func (p pgxPool) Query(ctx context.Context, sql string, args ...any) (postgresRows, error) {
	return p.pool.Query(ctx, sql, args...)
}

func (p pgxPool) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	return p.pool.QueryRow(ctx, sql, args...)
}

const datasetSelect = `
SELECT
    d.dataset_id,
    d.dataset_version,
    d.source_mode,
    d.source_namespace,
    d.status,
    d.chain_id,
    d.token_address,
    a.symbol,
    a.decimals,
    d.start_block,
    d.end_block,
    d.start_time,
    d.end_time,
    d.finalized_block,
    d.collected_at,
    d.invalidation_reason,
    COALESCE((
        SELECT jsonb_object_agg(
            boundary.block_number::text,
            boundary.block_hash
            ORDER BY boundary.block_number
        )::text
        FROM blocks boundary
        WHERE boundary.dataset_id = d.dataset_id
          AND boundary.dataset_version = d.dataset_version
          AND (
              boundary.block_number = d.start_block
	              OR boundary.block_number = d.end_block
              OR EXISTS (
                  SELECT 1
                  FROM ingestion_chunks chunk
                  WHERE chunk.dataset_id = d.dataset_id
                    AND chunk.dataset_version = d.dataset_version
                    AND chunk.end_block = boundary.block_number
              )
          )
    ), '{}') AS boundary_hashes
FROM datasets d
JOIN assets a
  ON a.chain_id = d.chain_id
 AND a.token_address = d.token_address`

// ListDatasets는 저장된 모든 Dataset 버전을 ID와 버전 순서로 조회한다.
func (p *Postgres) ListDatasets(ctx context.Context) ([]domain.Dataset, error) {
	rows, err := p.db.Query(ctx, datasetSelect+`
ORDER BY d.dataset_id, d.dataset_version`)
	if err != nil {
		return nil, fmt.Errorf("list datasets: %w", err)
	}
	defer rows.Close()

	datasets := []domain.Dataset{}
	for rows.Next() {
		dataset, err := scanDataset(rows)
		if err != nil {
			return nil, fmt.Errorf("list datasets: %w", err)
		}
		datasets = append(datasets, dataset)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list datasets: %w", err)
	}
	return datasets, nil
}

// GetDataset은 ID와 버전이 모두 일치하는 Dataset을 조회한다.
func (p *Postgres) GetDataset(ctx context.Context, id, version string) (domain.Dataset, error) {
	row := p.db.QueryRow(ctx, datasetSelect+`
WHERE d.dataset_id = $1
  AND d.dataset_version = $2`, id, version)
	dataset, err := scanDataset(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Dataset{}, ErrNotFound
	}
	if err != nil {
		return domain.Dataset{}, fmt.Errorf("get dataset %s@%s: %w", id, version, err)
	}
	return dataset, nil
}

// scanDataset은 Dataset 조회 행의 nullable 값과 정수 범위를 검사해 공통 도메인 타입으로 변환한다.
func scanDataset(row postgresRow) (domain.Dataset, error) {
	var (
		dataset            domain.Dataset
		chainID            int64
		decimals           int16
		startBlock         int64
		endBlock           int64
		finalizedBlock     *int64
		collectedAt        *time.Time
		invalidationReason *string
		boundaryHashesJSON string
	)
	if err := row.Scan(
		&dataset.ID,
		&dataset.Version,
		&dataset.SourceMode,
		&dataset.SourceNamespace,
		&dataset.Status,
		&chainID,
		&dataset.Asset.TokenAddress,
		&dataset.Asset.Symbol,
		&decimals,
		&startBlock,
		&endBlock,
		&dataset.StartTime,
		&dataset.EndTime,
		&finalizedBlock,
		&collectedAt,
		&invalidationReason,
		&boundaryHashesJSON,
	); err != nil {
		return domain.Dataset{}, err
	}

	if chainID <= 0 || decimals < 0 || startBlock < 0 || endBlock < 0 {
		return domain.Dataset{}, fmt.Errorf("database contains a negative or zero dataset value")
	}
	dataset.Asset.ChainID = uint64(chainID)
	dataset.Asset.Decimals = int(decimals)
	dataset.StartBlock = domain.BlockNumber(startBlock)
	dataset.EndBlock = domain.BlockNumber(endBlock)
	dataset.StartTime = dataset.StartTime.UTC()
	dataset.EndTime = dataset.EndTime.UTC()
	if finalizedBlock != nil {
		if *finalizedBlock < 0 {
			return domain.Dataset{}, fmt.Errorf("database contains a negative finalized block")
		}
		value := domain.BlockNumber(*finalizedBlock)
		dataset.FinalizedBlock = &value
	}
	if collectedAt != nil {
		value := collectedAt.UTC()
		dataset.CollectedAt = &value
	}
	if invalidationReason != nil {
		dataset.InvalidationReason = *invalidationReason
	}

	dataset.BoundaryHashes = map[string]string{}
	if err := json.Unmarshal([]byte(boundaryHashesJSON), &dataset.BoundaryHashes); err != nil {
		return domain.Dataset{}, fmt.Errorf("decode boundary hashes: %w", err)
	}
	// 현재 DB 모델에는 Dataset 주소 label과 note 컬럼이 없다.
	dataset.Labels = map[string]string{}
	dataset.Notes = []string{}
	return dataset, nil
}

// ListTransfers는 필터와 위치 기반 커서를 적용해 Transfer 한 페이지를 조회한다.
func (p *Postgres) ListTransfers(ctx context.Context, q TransferQuery) (TransferPage, error) {
	if q.Limit < 1 {
		return TransferPage{}, fmt.Errorf("transfer limit must be positive")
	}
	if q.MinAmountRaw != "" {
		if _, err := domain.ParseAmount(q.MinAmountRaw); err != nil {
			return TransferPage{}, err
		}
	}

	dataset, err := p.transferDataset(ctx, q.DatasetID, q.DatasetVersion)
	if err != nil {
		return TransferPage{}, err
	}

	query, args, err := buildTransferQuery(q)
	if err != nil {
		return TransferPage{}, err
	}
	rows, err := p.db.Query(ctx, query, args...)
	if err != nil {
		return TransferPage{}, fmt.Errorf("list transfers: %w", err)
	}
	defer rows.Close()

	page := TransferPage{Transfers: []domain.Transfer{}}
	for rows.Next() {
		transfer, err := scanTransfer(rows)
		if err != nil {
			return TransferPage{}, fmt.Errorf("list transfers: %w", err)
		}
		if err := checkTransfer(dataset, transfer); err != nil {
			return TransferPage{}, fmt.Errorf("list transfers: database transfer %q: %w", transfer.ID, err)
		}
		page.Transfers = append(page.Transfers, transfer)
	}
	if err := rows.Err(); err != nil {
		return TransferPage{}, fmt.Errorf("list transfers: %w", err)
	}
	if len(page.Transfers) > q.Limit {
		page.HasMore = true
		page.Transfers = page.Transfers[:q.Limit]
	}
	return page, nil
}

// transferDataset은 Transfer 조회 검증에 필요한 Dataset 원천과 수집 범위를 읽는다.
func (p *Postgres) transferDataset(ctx context.Context, id, version string) (domain.Dataset, error) {
	var (
		dataset    domain.Dataset
		chainID    int64
		startBlock int64
		endBlock   int64
	)
	err := p.db.QueryRow(ctx, `
SELECT source_mode, source_namespace, chain_id, token_address, start_block, end_block
FROM datasets
WHERE dataset_id = $1
  AND dataset_version = $2`, id, version).Scan(
		&dataset.SourceMode,
		&dataset.SourceNamespace,
		&chainID,
		&dataset.Asset.TokenAddress,
		&startBlock,
		&endBlock,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Dataset{}, ErrNotFound
	}
	if err != nil {
		return domain.Dataset{}, fmt.Errorf("check dataset %s@%s: %w", id, version, err)
	}
	if chainID <= 0 || startBlock < 0 || endBlock < startBlock {
		return domain.Dataset{}, fmt.Errorf("check dataset %s@%s: database contains an invalid range", id, version)
	}
	dataset.ID = id
	dataset.Version = version
	dataset.Asset.ChainID = uint64(chainID)
	dataset.StartBlock = domain.BlockNumber(startBlock)
	dataset.EndBlock = domain.BlockNumber(endBlock)
	return dataset, nil
}

// buildTransferQuery는 Transfer 필터와 커서를 SQL 조건과 바인딩 인자로 구성한다.
func buildTransferQuery(q TransferQuery) (string, []any, error) {
	args := []any{q.DatasetID, q.DatasetVersion}
	var conditions []string
	add := func(value any) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}

	if q.Address != "" {
		address := add(domain.NormalizeAddress(q.Address))
		switch q.Direction {
		case DirectionIncoming:
			conditions = append(conditions, "t.to_address = "+address)
		case DirectionOutgoing:
			conditions = append(conditions, "t.from_address = "+address)
		default:
			conditions = append(conditions, "(t.from_address = "+address+" OR t.to_address = "+address+")")
		}
	}
	if q.TxHash != "" {
		conditions = append(conditions, "t.tx_hash = "+add(strings.ToLower(q.TxHash)))
	}
	if q.StartBlock != nil {
		block, err := postgresBlock(*q.StartBlock)
		if err != nil {
			return "", nil, err
		}
		conditions = append(conditions, "tx.block_number >= "+add(block))
	}
	if q.EndBlock != nil {
		block, err := postgresBlock(*q.EndBlock)
		if err != nil {
			return "", nil, err
		}
		conditions = append(conditions, "tx.block_number <= "+add(block))
	}
	if q.StartTime != nil {
		conditions = append(conditions, "b.block_time >= "+add(q.StartTime.UTC()))
	}
	if q.EndTime != nil {
		conditions = append(conditions, "b.block_time <= "+add(q.EndTime.UTC()))
	}
	if q.MinAmountRaw != "" {
		conditions = append(conditions, "t.amount_raw >= "+add(q.MinAmountRaw)+"::numeric")
	}
	if q.After != nil {
		block, err := postgresBlock(q.After.Position.BlockNumber)
		if err != nil {
			return "", nil, err
		}
		blockArg := add(block)
		txArg := add(int64(q.After.Position.TransactionIndex))
		logArg := add(int64(q.After.Position.LogIndex))
		idArg := add(q.After.ID)
		conditions = append(conditions, fmt.Sprintf(
			"(tx.block_number, tx.transaction_index, t.log_index, t.transfer_id) > (%s, %s, %s, %s)",
			blockArg, txArg, logArg, idArg,
		))
	}

	where := ""
	if len(conditions) > 0 {
		where = "\n  AND " + strings.Join(conditions, "\n  AND ")
	}
	limitArg := add(q.Limit + 1)
	query := `
SELECT
    t.transfer_id,
    a.chain_id,
    a.token_address,
    a.symbol,
    a.decimals,
    t.tx_hash,
    b.block_hash,
    tx.block_number,
    tx.transaction_index,
    t.log_index,
    b.block_time,
    t.from_address,
    t.to_address,
    t.amount_raw::text,
    t.label,
    t.note
FROM dataset_transfers dt
JOIN transfers t
  ON t.transfer_id = dt.transfer_id
JOIN assets a
  ON a.chain_id = t.chain_id
 AND a.token_address = t.token_address
JOIN transactions tx
  ON tx.dataset_id = dt.dataset_id
 AND tx.dataset_version = dt.dataset_version
 AND tx.tx_hash = t.tx_hash
JOIN blocks b
  ON b.dataset_id = tx.dataset_id
 AND b.dataset_version = tx.dataset_version
 AND b.block_number = tx.block_number
WHERE dt.dataset_id = $1
  AND dt.dataset_version = $2` + where + `
ORDER BY tx.block_number, tx.transaction_index, t.log_index, t.transfer_id
LIMIT ` + limitArg
	return query, args, nil
}

// postgresBlock은 BlockNumber가 PostgreSQL BIGINT 범위에 들어오는지 검사한다.
func postgresBlock(block domain.BlockNumber) (int64, error) {
	if uint64(block) > math.MaxInt64 {
		return 0, fmt.Errorf("block number exceeds PostgreSQL BIGINT")
	}
	return int64(block), nil
}

// scanTransfer는 조인된 조회 행의 위치와 표시 값을 검사해 정규화된 Transfer로 변환한다.
func scanTransfer(row postgresRow) (domain.Transfer, error) {
	var (
		transfer         domain.Transfer
		chainID          int64
		decimals         int16
		blockNumber      int64
		transactionIndex int32
		logIndex         int32
		label            *string
		note             *string
	)
	if err := row.Scan(
		&transfer.ID,
		&chainID,
		&transfer.Asset.TokenAddress,
		&transfer.Asset.Symbol,
		&decimals,
		&transfer.TxHash,
		&transfer.BlockHash,
		&blockNumber,
		&transactionIndex,
		&logIndex,
		&transfer.Timestamp,
		&transfer.From,
		&transfer.To,
		&transfer.AmountRaw,
		&label,
		&note,
	); err != nil {
		return domain.Transfer{}, err
	}
	if chainID <= 0 || decimals < 0 || blockNumber < 0 || transactionIndex < 0 || logIndex < 0 {
		return domain.Transfer{}, fmt.Errorf("database contains a negative or zero transfer value")
	}
	transfer.Asset.ChainID = uint64(chainID)
	transfer.Asset.Decimals = int(decimals)
	transfer.BlockNumber = domain.BlockNumber(blockNumber)
	transfer.TransactionIndex = uint32(transactionIndex)
	transfer.LogIndex = uint32(logIndex)
	transfer.Timestamp = transfer.Timestamp.UTC()
	transfer.From = domain.NormalizeAddress(transfer.From)
	transfer.To = domain.NormalizeAddress(transfer.To)
	transfer.TxHash = strings.ToLower(transfer.TxHash)
	transfer.BlockHash = strings.ToLower(transfer.BlockHash)
	transfer.TransferType = domain.TransferTypeOf(transfer.From, transfer.To)
	if label != nil {
		transfer.Label = *label
	}
	_ = note // note는 현재 공개 Transfer 타입에 대응 필드가 없다.
	return transfer, nil
}
