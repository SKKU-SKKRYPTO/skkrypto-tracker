package rpc

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// ERC-20 Transfer(address,address,uint256) event signature.
const TransferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

// NewFixtureStub은 공통 Fixture를 실제 RPC 모양의 Block·Log·Receipt 응답으로 바꾼다.
// Fixture에는 finality가 없으므로 Dataset 종료 블록을 finalized 응답으로 사용한다.
func NewFixtureStub(dataset domain.Dataset, transfers []domain.Transfer) (*Stub, error) {
	if dataset.SourceMode != domain.SourceFixture {
		return nil, fmt.Errorf("fixture stub requires FIXTURE source mode")
	}
	if dataset.EndBlock < dataset.StartBlock || !domain.ValidAddress(dataset.Asset.TokenAddress) {
		return nil, fmt.Errorf("invalid fixture dataset")
	}

	startHash := strings.ToLower(dataset.BoundaryHashes[dataset.StartBlock.String()])
	endHash := strings.ToLower(dataset.BoundaryHashes[dataset.EndBlock.String()])
	if !domain.ValidHash(startHash) || !domain.ValidHash(endHash) {
		return nil, fmt.Errorf("fixture boundary hashes are required")
	}
	stub := NewStub(Block{Number: dataset.EndBlock, Hash: endHash, Time: dataset.EndTime.UTC()})
	stub.AddBlock(Block{Number: dataset.StartBlock, Hash: startHash, Time: dataset.StartTime.UTC()})
	stub.AddBlock(Block{Number: dataset.EndBlock, Hash: endHash, Time: dataset.EndTime.UTC()})

	blocks := map[domain.BlockNumber]Block{
		dataset.StartBlock: {Number: dataset.StartBlock, Hash: startHash, Time: dataset.StartTime.UTC()},
		dataset.EndBlock:   {Number: dataset.EndBlock, Hash: endHash, Time: dataset.EndTime.UTC()},
	}
	receipts := make(map[string]Receipt)
	for _, transfer := range transfers {
		if err := validateFixtureTransfer(dataset, transfer); err != nil {
			return nil, fmt.Errorf("transfer %s: %w", transfer.ID, err)
		}
		block := Block{
			Number: transfer.BlockNumber,
			Hash:   strings.ToLower(transfer.BlockHash),
			Time:   transfer.Timestamp.UTC(),
		}
		if existing, ok := blocks[block.Number]; ok && (existing.Hash != block.Hash || !existing.Time.Equal(block.Time)) {
			return nil, fmt.Errorf("block %s has inconsistent hash or time", block.Number)
		}
		blocks[block.Number] = block

		log, err := fixtureLog(dataset.Asset.TokenAddress, transfer)
		if err != nil {
			return nil, fmt.Errorf("transfer %s: %w", transfer.ID, err)
		}
		stub.AddLog(log)

		txHash := strings.ToLower(transfer.TxHash)
		receipt, ok := receipts[txHash]
		if !ok {
			receipt = Receipt{
				TxHash:           txHash,
				BlockNumber:      transfer.BlockNumber,
				BlockHash:        strings.ToLower(transfer.BlockHash),
				TransactionIndex: transfer.TransactionIndex,
				Status:           1,
			}
		} else if receipt.BlockNumber != transfer.BlockNumber || receipt.BlockHash != strings.ToLower(transfer.BlockHash) ||
			receipt.TransactionIndex != transfer.TransactionIndex {
			return nil, fmt.Errorf("transaction %s has inconsistent position", txHash)
		}
		receipt.Logs = append(receipt.Logs, log)
		receipts[txHash] = receipt
	}

	for _, block := range blocks {
		stub.AddBlock(block)
	}
	for _, receipt := range receipts {
		sort.Slice(receipt.Logs, func(i, j int) bool {
			return receipt.Logs[i].LogIndex < receipt.Logs[j].LogIndex
		})
		stub.AddReceipt(receipt)
	}
	return stub, nil
}

// validateFixtureTransfer는 Fixture 전송이 Dataset과 일치하고 RPC 응답으로 변환 가능한지 확인한다.
func validateFixtureTransfer(dataset domain.Dataset, transfer domain.Transfer) error {
	switch {
	case !domain.ValidTransferID(dataset.SourceMode, dataset.SourceNamespace, transfer.ID):
		return fmt.Errorf("invalid fixture transfer ID")
	case !transfer.Asset.Same(dataset.Asset):
		return fmt.Errorf("asset differs from dataset")
	case transfer.BlockNumber < dataset.StartBlock || transfer.BlockNumber > dataset.EndBlock:
		return fmt.Errorf("block is outside dataset coverage")
	case !domain.ValidHash(transfer.TxHash) || !domain.ValidHash(transfer.BlockHash):
		return fmt.Errorf("invalid transaction or block hash")
	case !domain.ValidAddress(transfer.From) || !domain.ValidAddress(transfer.To):
		return fmt.Errorf("invalid transfer address")
	}
	_, err := domain.ParseAmount(transfer.AmountRaw)
	return err
}

// fixtureLog는 공통 Transfer를 ERC-20 Transfer 이벤트 로그 모양으로 변환한다.
func fixtureLog(tokenAddress string, transfer domain.Transfer) (Log, error) {
	amount, err := domain.ParseAmount(transfer.AmountRaw)
	if err != nil {
		return Log{}, err
	}
	data := make([]byte, 32)
	amount.FillBytes(data)
	return Log{
		Address: strings.ToLower(tokenAddress),
		Topics: []string{
			TransferTopic,
			addressTopic(transfer.From),
			addressTopic(transfer.To),
		},
		Data:             data,
		BlockNumber:      transfer.BlockNumber,
		BlockHash:        strings.ToLower(transfer.BlockHash),
		TxHash:           strings.ToLower(transfer.TxHash),
		TransactionIndex: transfer.TransactionIndex,
		LogIndex:         transfer.LogIndex,
	}, nil
}

// addressTopic은 20-byte 주소를 32-byte indexed event topic으로 채운다.
func addressTopic(address string) string {
	addressBytes, _ := hex.DecodeString(strings.TrimPrefix(strings.ToLower(address), "0x"))
	topic := make([]byte, 32)
	copy(topic[12:], addressBytes)
	return "0x" + hex.EncodeToString(topic)
}
