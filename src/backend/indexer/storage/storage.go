// Package storage는 Indexer가 정규화한 Snapshot 수집 결과를 PostgreSQL에 저장한다.
// RPC 조회와 로그 디코딩은 트랜잭션 밖에서 끝낸 뒤 구체 Postgres 구현을 호출한다.
package storage

import (
	"errors"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

var (
	ErrNotFound                = errors.New("dataset not found")
	ErrDatasetExists           = errors.New("dataset already exists")
	ErrDatasetLocked           = errors.New("dataset collection is already running")
	ErrDatasetNotCollecting    = errors.New("dataset is not collecting")
	ErrChunkAlreadyCommitted   = errors.New("chunk already committed")
	ErrChunkOverlap            = errors.New("chunk overlaps a committed chunk")
	ErrIncompleteCoverage      = errors.New("committed chunks do not cover the dataset")
	ErrInconsistentSource      = errors.New("stored source data differs")
	ErrInvalidStorageInput     = errors.New("invalid storage input")
	ErrInvalidStatusTransition = errors.New("invalid dataset status transition")
)

// DatasetKey는 Dataset 한 버전을 식별한다.
type DatasetKey struct {
	ID      string
	Version string
}

// DatasetSpec은 Snapshot 수집 시작 전에 고정하는 Dataset 규격이다.
type DatasetSpec struct {
	Key             DatasetKey
	SourceNamespace string
	Asset           domain.Asset
	Coverage        domain.Coverage
	FinalizedBlock  domain.BlockNumber
}

// Block은 한 Dataset 버전에서 관측한 블록이다.
type Block struct {
	Number domain.BlockNumber
	Hash   string
	Time   time.Time
}

// Transaction은 Transfer 로그가 포함된 거래와 블록 안의 위치다.
type Transaction struct {
	Hash             string
	BlockNumber      domain.BlockNumber
	TransactionIndex uint32
}

// Transfer는 Snapshot 원천 로그 하나의 불변 데이터를 저장하는 입력이다.
type Transfer struct {
	ID          string
	TxHash      string
	LogIndex    uint32
	FromAddress string
	ToAddress   string
	AmountRaw   string
}

// Chunk는 RPC 조회와 디코딩이 끝난 하나의 성공 후보 청크다.
// CommitChunk가 전체를 한 DB 트랜잭션으로 저장한다.
type Chunk struct {
	Key          DatasetKey
	StartBlock   domain.BlockNumber
	EndBlock     domain.BlockNumber
	Blocks       []Block
	Transactions []Transaction
	Transfers    []Transfer
}

// BoundaryHash는 재개·게시 전에 RPC와 대조하는 청크 종료 블록 hash다.
type BoundaryHash struct {
	BlockNumber domain.BlockNumber
	BlockHash   string
}

// ResumePoint는 연속해서 커밋된 마지막 청크 다음 수집 위치다.
type ResumePoint struct {
	NextBlock domain.BlockNumber
	Boundary  *BoundaryHash
	Complete  bool
}
