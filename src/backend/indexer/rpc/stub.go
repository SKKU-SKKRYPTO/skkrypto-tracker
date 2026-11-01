package rpc

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

type response[T any] struct {
	value T
	err   error
}

type logRequest struct {
	token string
	start domain.BlockNumber
	end   domain.BlockNumber
}

// Stub은 네트워크 없이 결정적인 RPC 응답과 오류 순서를 제공한다.
// 큐에 넣은 응답을 먼저 소비하고, 큐가 비면 기본 Fixture 값을 사용한다.
type Stub struct {
	mu sync.Mutex

	finalized Block
	logs      []Log
	blocks    map[domain.BlockNumber]Block
	receipts  map[string]Receipt

	finalizedQueue []response[Block]
	logQueues      map[logRequest][]response[[]Log]
	blockQueues    map[domain.BlockNumber][]response[Block]
	receiptQueues  map[string][]response[Receipt]

	maxBlockRange uint64
	maxResults    int
	calls         []Call
}

// NewStub은 기본 finalized 블록을 반환하는 빈 RPC Stub을 만든다.
func NewStub(finalized Block) *Stub {
	return &Stub{
		finalized:     finalized,
		blocks:        make(map[domain.BlockNumber]Block),
		receipts:      make(map[string]Receipt),
		logQueues:     make(map[logRequest][]response[[]Log]),
		blockQueues:   make(map[domain.BlockNumber][]response[Block]),
		receiptQueues: make(map[string][]response[Receipt]),
	}
}

// SetLimits는 공급자의 최대 블록 수와 결과 수를 흉내 낸다. 0이면 제한하지 않는다.
func (s *Stub) SetLimits(maxBlockRange uint64, maxResults int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maxBlockRange = maxBlockRange
	s.maxResults = maxResults
}

// AddLog는 기본 TransferLogs 응답에 로그를 추가한다.
func (s *Stub) AddLog(log Log) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logs = append(s.logs, cloneLog(log))
}

// AddBlock은 기본 BlockByNumber 응답에 블록을 추가한다.
func (s *Stub) AddBlock(block Block) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blocks[block.Number] = block
}

// AddReceipt는 기본 Receipt 응답에 거래 영수증을 추가한다.
func (s *Stub) AddReceipt(receipt Receipt) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.receipts[strings.ToLower(receipt.TxHash)] = cloneReceipt(receipt)
}

// Queue 계열 메서드는 같은 호출의 다음 응답을 순서대로 지정한다.
// err가 있으면 값은 무시한다.
func (s *Stub) QueueFinalized(block Block, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finalizedQueue = append(s.finalizedQueue, response[Block]{value: block, err: err})
}

// QueueTransferLogs는 특정 토큰·범위 호출의 다음 로그 응답을 예약한다.
func (s *Stub) QueueTransferLogs(tokenAddress string, startBlock, endBlock domain.BlockNumber, logs []Log, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := logRequest{token: strings.ToLower(tokenAddress), start: startBlock, end: endBlock}
	s.logQueues[key] = append(s.logQueues[key], response[[]Log]{value: cloneLogs(logs), err: err})
}

// QueueBlock은 특정 블록 번호 호출의 다음 응답을 예약한다.
func (s *Stub) QueueBlock(number domain.BlockNumber, block Block, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blockQueues[number] = append(s.blockQueues[number], response[Block]{value: block, err: err})
}

// QueueReceipt는 특정 거래 hash 호출의 다음 영수증 응답을 예약한다.
func (s *Stub) QueueReceipt(txHash string, receipt Receipt, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := strings.ToLower(txHash)
	s.receiptQueues[key] = append(s.receiptQueues[key], response[Receipt]{value: cloneReceipt(receipt), err: err})
}

// Calls는 현재까지 기록한 RPC 호출의 복사본을 반환한다.
func (s *Stub) Calls() []Call {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Call(nil), s.calls...)
}

// ResetCalls는 기록된 RPC 호출만 비운다.
func (s *Stub) ResetCalls() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = nil
}

// FinalizedBlock은 예약된 응답 또는 기본 finalized 블록을 반환한다.
func (s *Stub) FinalizedBlock(ctx context.Context) (Block, error) {
	if err := ctx.Err(); err != nil {
		return Block{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, Call{Method: MethodFinalizedBlock})
	if len(s.finalizedQueue) != 0 {
		result := s.finalizedQueue[0]
		s.finalizedQueue = s.finalizedQueue[1:]
		return result.value, result.err
	}
	return s.finalized, nil
}

// TransferLogs는 예약 응답과 공급자 제한을 적용하고 기본 로그를 위치순으로 반환한다.
func (s *Stub) TransferLogs(
	ctx context.Context,
	tokenAddress string,
	startBlock, endBlock domain.BlockNumber,
) ([]Log, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if endBlock < startBlock {
		return nil, fmt.Errorf("invalid block range %s-%s", startBlock, endBlock)
	}

	tokenAddress = strings.ToLower(tokenAddress)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, Call{
		Method: MethodTransferLogs, TokenAddress: tokenAddress, StartBlock: startBlock, EndBlock: endBlock,
	})
	if s.maxBlockRange > 0 && uint64(endBlock-startBlock) >= s.maxBlockRange {
		return nil, fmt.Errorf("%w: requested %d blocks, maximum %d", ErrRangeLimit, uint64(endBlock-startBlock)+1, s.maxBlockRange)
	}

	key := logRequest{token: tokenAddress, start: startBlock, end: endBlock}
	if queue := s.logQueues[key]; len(queue) != 0 {
		result := queue[0]
		s.logQueues[key] = queue[1:]
		return cloneLogs(result.value), result.err
	}

	logs := make([]Log, 0)
	for _, log := range s.logs {
		if strings.EqualFold(log.Address, tokenAddress) && log.BlockNumber >= startBlock && log.BlockNumber <= endBlock {
			logs = append(logs, cloneLog(log))
		}
	}
	sort.Slice(logs, func(i, j int) bool {
		return compareLogPosition(logs[i], logs[j]) < 0
	})
	if s.maxResults > 0 && len(logs) > s.maxResults {
		return nil, fmt.Errorf("%w: got %d results, maximum %d", ErrResultLimit, len(logs), s.maxResults)
	}
	return logs, nil
}

// BlockByNumber는 예약된 응답 또는 기본 블록을 반환한다.
func (s *Stub) BlockByNumber(ctx context.Context, number domain.BlockNumber) (Block, error) {
	if err := ctx.Err(); err != nil {
		return Block{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, Call{Method: MethodBlockByNumber, BlockNumber: number})
	if queue := s.blockQueues[number]; len(queue) != 0 {
		result := queue[0]
		s.blockQueues[number] = queue[1:]
		return result.value, result.err
	}
	block, ok := s.blocks[number]
	if !ok {
		return Block{}, fmt.Errorf("%w: block %s", ErrNotFound, number)
	}
	return block, nil
}

// Receipt는 예약된 응답 또는 기본 거래 영수증을 반환한다.
func (s *Stub) Receipt(ctx context.Context, txHash string) (Receipt, error) {
	if err := ctx.Err(); err != nil {
		return Receipt{}, err
	}
	txHash = strings.ToLower(txHash)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, Call{Method: MethodReceipt, TxHash: txHash})
	if queue := s.receiptQueues[txHash]; len(queue) != 0 {
		result := queue[0]
		s.receiptQueues[txHash] = queue[1:]
		return cloneReceipt(result.value), result.err
	}
	receipt, ok := s.receipts[txHash]
	if !ok {
		return Receipt{}, fmt.Errorf("%w: receipt %s", ErrNotFound, txHash)
	}
	return cloneReceipt(receipt), nil
}

// compareLogPosition은 블록·거래·로그 위치 순서로 두 로그를 비교한다.
func compareLogPosition(a, b Log) int {
	aPosition := domain.Position{
		BlockNumber: a.BlockNumber, TransactionIndex: a.TransactionIndex, LogIndex: a.LogIndex,
	}
	bPosition := domain.Position{
		BlockNumber: b.BlockNumber, TransactionIndex: b.TransactionIndex, LogIndex: b.LogIndex,
	}
	return domain.ComparePosition(aPosition, bPosition)
}

// cloneLogs는 호출자가 Stub 내부 데이터를 변경하지 못하도록 로그 목록을 복사한다.
func cloneLogs(logs []Log) []Log {
	cloned := make([]Log, len(logs))
	for i, log := range logs {
		cloned[i] = cloneLog(log)
	}
	return cloned
}

// cloneLog는 topic과 data byte slice까지 포함해 로그를 복사한다.
func cloneLog(log Log) Log {
	log.Topics = append([]string(nil), log.Topics...)
	log.Data = append([]byte(nil), log.Data...)
	return log
}

// cloneReceipt는 포함 로그까지 복사한 영수증을 반환한다.
func cloneReceipt(receipt Receipt) Receipt {
	receipt.Logs = cloneLogs(receipt.Logs)
	return receipt
}
