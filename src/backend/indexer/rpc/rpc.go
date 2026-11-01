// Package rpc는 Indexer가 Ethereum RPC에서 필요한 최소 계약을 정의한다.
// 실제 go-ethereum 어댑터와 단위 테스트용 Stub은 이 계약을 구현한다.
package rpc

import (
	"context"
	"errors"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

var (
	ErrRangeLimit  = errors.New("rpc block range limit")
	ErrResultLimit = errors.New("rpc result limit")
	ErrTemporary   = errors.New("temporary rpc failure")
	ErrNotFound    = errors.New("rpc value not found")
)

// Client는 수집기가 사용하는 Ethereum RPC의 최소 기능이다.
// 구현체는 Transfer topic과 tokenAddress를 적용한 로그만 돌려준다.
type Client interface {
	FinalizedBlock(ctx context.Context) (Block, error)
	TransferLogs(ctx context.Context, tokenAddress string, startBlock, endBlock domain.BlockNumber) ([]Log, error)
	BlockByNumber(ctx context.Context, number domain.BlockNumber) (Block, error)
	Receipt(ctx context.Context, txHash string) (Receipt, error)
}

// Block은 수집 범위와 경계 hash 검증에 필요한 블록 정보다.
type Block struct {
	Number domain.BlockNumber
	Hash   string
	Time   time.Time
}

// Log는 eth_getLogs와 Receipt에 포함된 원본 로그 위치와 payload다.
type Log struct {
	Address          string
	Topics           []string
	Data             []byte
	BlockNumber      domain.BlockNumber
	BlockHash        string
	TxHash           string
	TransactionIndex uint32
	LogIndex         uint32
	Removed          bool
}

// Receipt는 거래 성공 여부와 포함 로그를 대조하는 데 필요한 값이다.
type Receipt struct {
	TxHash           string
	BlockNumber      domain.BlockNumber
	BlockHash        string
	TransactionIndex uint32
	Status           uint64
	Logs             []Log
}

// Method와 Call은 Stub에 기록된 RPC 호출을 검증할 때 사용한다.
type Method string

const (
	MethodFinalizedBlock Method = "finalizedBlock"
	MethodTransferLogs   Method = "transferLogs"
	MethodBlockByNumber  Method = "blockByNumber"
	MethodReceipt        Method = "receipt"
)

type Call struct {
	Method       Method
	TokenAddress string
	StartBlock   domain.BlockNumber
	EndBlock     domain.BlockNumber
	BlockNumber  domain.BlockNumber
	TxHash       string
}
