package indexer

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/rpc"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

// assembleChunk obtains and verifies all RPC source data for one inclusive
// range. It performs no storage mutation; callers may commit the returned chunk
// only after this function succeeds.
func assembleChunk(
	ctx context.Context,
	client rpc.Client,
	spec storage.DatasetSpec,
	startBlock, endBlock domain.BlockNumber,
) (storage.Chunk, error) {
	if client == nil {
		return storage.Chunk{}, errors.New("RPC client is required")
	}
	if endBlock < startBlock || startBlock < spec.Coverage.StartBlock || endBlock > spec.Coverage.EndBlock {
		return storage.Chunk{}, errors.New("chunk range is outside dataset coverage")
	}
	logs, err := client.TransferLogs(ctx, spec.Asset.TokenAddress, startBlock, endBlock)
	if err != nil {
		return storage.Chunk{}, err
	}
	decoded, err := decodeAndDeduplicate(logs, spec.Asset, startBlock, endBlock)
	if err != nil {
		return storage.Chunk{}, err
	}

	blockNumbers := map[domain.BlockNumber]struct{}{endBlock: {}}
	if startBlock == spec.Coverage.StartBlock {
		blockNumbers[spec.Coverage.StartBlock] = struct{}{}
	}
	for _, transfer := range decoded {
		blockNumbers[transfer.blockNumber] = struct{}{}
	}
	blocks, blockByNumber, err := fetchChunkBlocks(ctx, client, spec, blockNumbers)
	if err != nil {
		return storage.Chunk{}, err
	}
	transactions, transfers, err := verifyChunkReceipts(ctx, client, spec.Asset, decoded, blockByNumber)
	if err != nil {
		return storage.Chunk{}, err
	}

	return storage.Chunk{
		Key:          spec.Key,
		StartBlock:   startBlock,
		EndBlock:     endBlock,
		Blocks:       blocks,
		Transactions: transactions,
		Transfers:    transfers,
	}, nil
}

// decodeAndDeduplicate sorts unordered logs and admits an identical repeated
// source record once while rejecting every stable-ID conflict.
func decodeAndDeduplicate(logs []rpc.Log, asset domain.Asset, startBlock, endBlock domain.BlockNumber) ([]decodedTransfer, error) {
	byID := make(map[string]decodedTransfer, len(logs))
	for i := range logs {
		transfer, err := decodeTransferLog(logs[i], asset, startBlock, endBlock)
		if err != nil {
			return nil, fmt.Errorf("decode filtered log %d: %w", i, err)
		}
		if previous, exists := byID[transfer.stored.ID]; exists {
			if !sameRPCLog(previous.source, transfer.source) {
				return nil, fmt.Errorf("conflicting duplicate Transfer %s", transfer.stored.ID)
			}
			continue
		}
		byID[transfer.stored.ID] = transfer
	}
	result := make([]decodedTransfer, 0, len(byID))
	for _, transfer := range byID {
		result = append(result, transfer)
	}
	sort.Slice(result, func(i, j int) bool {
		return compareDecodedPosition(result[i], result[j]) < 0
	})
	for i := 1; i < len(result); i++ {
		if result[i-1].blockNumber == result[i].blockNumber &&
			result[i-1].transactionIndex == result[i].transactionIndex &&
			result[i-1].stored.LogIndex == result[i].stored.LogIndex {
			return nil, errors.New("different Transfers occupy the same chain position")
		}
	}
	return result, nil
}

// fetchChunkBlocks reads each required header once and verifies hashes and
// immutable Dataset endpoint timestamps before exposing storage records.
func fetchChunkBlocks(
	ctx context.Context,
	client rpc.Client,
	spec storage.DatasetSpec,
	numbers map[domain.BlockNumber]struct{},
) ([]storage.Block, map[domain.BlockNumber]rpc.Block, error) {
	ordered := make([]domain.BlockNumber, 0, len(numbers))
	for number := range numbers {
		ordered = append(ordered, number)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	blocks := make([]storage.Block, 0, len(ordered))
	byNumber := make(map[domain.BlockNumber]rpc.Block, len(ordered))
	for _, number := range ordered {
		block, err := client.BlockByNumber(ctx, number)
		if err != nil {
			return nil, nil, err
		}
		block.Hash = strings.ToLower(block.Hash)
		block.Time = block.Time.UTC()
		if block.Number != number || !domain.ValidHash(block.Hash) || block.Time.IsZero() {
			return nil, nil, fmt.Errorf("invalid block response for %s", number)
		}
		if number == spec.Coverage.StartBlock && !block.Time.Equal(spec.Coverage.StartTime) {
			return nil, nil, errors.New("dataset start block time differs from immutable coverage")
		}
		if number == spec.Coverage.EndBlock && !block.Time.Equal(spec.Coverage.EndTime) {
			return nil, nil, errors.New("dataset end block time differs from immutable coverage")
		}
		byNumber[number] = block
		blocks = append(blocks, storage.Block{Number: number, Hash: block.Hash, Time: block.Time})
	}
	return blocks, byNumber, nil
}

// verifyChunkReceipts fetches each transaction once and requires bidirectional
// agreement: every filtered Transfer is present in its successful Receipt and
// every selected-token Transfer in that Receipt is present in the filtered set.
func verifyChunkReceipts(
	ctx context.Context,
	client rpc.Client,
	asset domain.Asset,
	decoded []decodedTransfer,
	blocks map[domain.BlockNumber]rpc.Block,
) ([]storage.Transaction, []storage.Transfer, error) {
	byTransaction := make(map[string][]decodedTransfer)
	for _, transfer := range decoded {
		block, ok := blocks[transfer.blockNumber]
		if !ok || block.Hash != transfer.blockHash {
			return nil, nil, fmt.Errorf("Transfer %s block hash differs from header", transfer.stored.ID)
		}
		byTransaction[transfer.stored.TxHash] = append(byTransaction[transfer.stored.TxHash], transfer)
	}

	txHashes := make([]string, 0, len(byTransaction))
	for hash := range byTransaction {
		txHashes = append(txHashes, hash)
	}
	sort.Slice(txHashes, func(i, j int) bool {
		left, right := byTransaction[txHashes[i]][0], byTransaction[txHashes[j]][0]
		if compared := compareDecodedPosition(left, right); compared != 0 {
			return compared < 0
		}
		return txHashes[i] < txHashes[j]
	})

	transactions := make([]storage.Transaction, 0, len(txHashes))
	transfers := make([]storage.Transfer, 0, len(decoded))
	transactionPositions := make(map[string]string, len(txHashes))
	for _, txHash := range txHashes {
		expected := byTransaction[txHash]
		for _, transfer := range expected[1:] {
			if transfer.blockNumber != expected[0].blockNumber || transfer.blockHash != expected[0].blockHash ||
				transfer.transactionIndex != expected[0].transactionIndex {
				return nil, nil, fmt.Errorf("transaction %s has contradictory log positions", txHash)
			}
		}
		receipt, err := client.Receipt(ctx, txHash)
		if err != nil {
			return nil, nil, err
		}
		if err := validateReceiptIdentity(receipt, expected[0]); err != nil {
			return nil, nil, fmt.Errorf("receipt %s: %w", txHash, err)
		}
		positionKey := fmt.Sprintf("%d:%d", receipt.BlockNumber, receipt.TransactionIndex)
		if previous, exists := transactionPositions[positionKey]; exists && previous != txHash {
			return nil, nil, errors.New("different transactions occupy the same block position")
		}
		transactionPositions[positionKey] = txHash

		expectedByID := make(map[string]decodedTransfer, len(expected))
		for _, transfer := range expected {
			expectedByID[transfer.stored.ID] = transfer
		}
		seen := make(map[string]struct{}, len(expected))
		for i := range receipt.Logs {
			log := receipt.Logs[i]
			if !isSelectedTransferLog(log, asset.TokenAddress) {
				continue
			}
			if !receiptLogMatchesIdentity(log, receipt) {
				return nil, nil, fmt.Errorf("selected-token receipt log %d contradicts transaction position", i)
			}
			actual, err := decodeTransferLog(log, asset, receipt.BlockNumber, receipt.BlockNumber)
			if err != nil {
				return nil, nil, fmt.Errorf("decode receipt log %d: %w", i, err)
			}
			wanted, exists := expectedByID[actual.stored.ID]
			if !exists {
				return nil, nil, fmt.Errorf("selected-token receipt Transfer %s is missing from filtered logs", actual.stored.ID)
			}
			if !sameRPCLog(wanted.source, log) {
				return nil, nil, fmt.Errorf("receipt payload differs for Transfer %s", actual.stored.ID)
			}
			if _, duplicate := seen[actual.stored.ID]; duplicate {
				return nil, nil, fmt.Errorf("receipt repeats Transfer %s", actual.stored.ID)
			}
			seen[actual.stored.ID] = struct{}{}
		}
		if len(seen) != len(expectedByID) {
			return nil, nil, fmt.Errorf("receipt omits a filtered Transfer for transaction %s", txHash)
		}
		transactions = append(transactions, storage.Transaction{
			Hash: txHash, BlockNumber: receipt.BlockNumber, TransactionIndex: receipt.TransactionIndex,
		})
	}
	for _, transfer := range decoded {
		transfers = append(transfers, transfer.stored)
	}
	return transactions, transfers, nil
}

// validateReceiptIdentity verifies the successful transaction-level fields
// shared by every selected Transfer in one Receipt.
func validateReceiptIdentity(receipt rpc.Receipt, expected decodedTransfer) error {
	if receipt.Status != 1 {
		return errors.New("transaction was not successful")
	}
	if strings.ToLower(receipt.TxHash) != expected.stored.TxHash ||
		receipt.BlockNumber != expected.blockNumber ||
		strings.ToLower(receipt.BlockHash) != expected.blockHash ||
		receipt.TransactionIndex != expected.transactionIndex {
		return errors.New("transaction identity or position differs")
	}
	if !domain.ValidHash(strings.ToLower(receipt.TxHash)) || !domain.ValidHash(strings.ToLower(receipt.BlockHash)) {
		return errors.New("receipt contains an invalid hash")
	}
	return nil
}

// isSelectedTransferLog distinguishes the selected token's Transfer event from
// Approval events and other-token logs that may coexist in a Receipt.
func isSelectedTransferLog(log rpc.Log, tokenAddress string) bool {
	return strings.EqualFold(log.Address, tokenAddress) && len(log.Topics) > 0 && strings.EqualFold(log.Topics[0], rpc.TransferTopic)
}

// receiptLogMatchesIdentity ensures a selected log repeats its containing
// Receipt's transaction and block position.
func receiptLogMatchesIdentity(log rpc.Log, receipt rpc.Receipt) bool {
	return strings.EqualFold(log.TxHash, receipt.TxHash) && log.BlockNumber == receipt.BlockNumber &&
		strings.EqualFold(log.BlockHash, receipt.BlockHash) && log.TransactionIndex == receipt.TransactionIndex
}

// compareDecodedPosition orders normalized records by block, transaction and
// log index, then stable ID for deterministic output.
func compareDecodedPosition(left, right decodedTransfer) int {
	switch {
	case left.blockNumber < right.blockNumber:
		return -1
	case left.blockNumber > right.blockNumber:
		return 1
	case left.transactionIndex < right.transactionIndex:
		return -1
	case left.transactionIndex > right.transactionIndex:
		return 1
	case left.stored.LogIndex < right.stored.LogIndex:
		return -1
	case left.stored.LogIndex > right.stored.LogIndex:
		return 1
	case left.stored.ID < right.stored.ID:
		return -1
	case left.stored.ID > right.stored.ID:
		return 1
	default:
		return 0
	}
}

// sameRPCLog compares the complete source identity and payload while treating
// hexadecimal case as representation-only.
func sameRPCLog(left, right rpc.Log) bool {
	if !strings.EqualFold(left.Address, right.Address) || left.BlockNumber != right.BlockNumber ||
		!strings.EqualFold(left.BlockHash, right.BlockHash) || !strings.EqualFold(left.TxHash, right.TxHash) ||
		left.TransactionIndex != right.TransactionIndex || left.LogIndex != right.LogIndex || left.Removed != right.Removed ||
		len(left.Topics) != len(right.Topics) || len(left.Data) != len(right.Data) {
		return false
	}
	for i := range left.Topics {
		if !strings.EqualFold(left.Topics[i], right.Topics[i]) {
			return false
		}
	}
	for i := range left.Data {
		if left.Data[i] != right.Data[i] {
			return false
		}
	}
	return true
}
