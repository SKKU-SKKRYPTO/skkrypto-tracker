package indexer

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/rpc"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

type decodedTransfer struct {
	stored           storage.Transfer
	blockNumber      domain.BlockNumber
	blockHash        string
	transactionIndex uint32
	source           rpc.Log
}

// decodeTransferLog validates one filtered ERC-20 Transfer log and converts it
// without applying token decimals to the raw uint256 value.
func decodeTransferLog(source rpc.Log, asset domain.Asset, startBlock, endBlock domain.BlockNumber) (decodedTransfer, error) {
	if asset.ChainID != domain.ChainID || !domain.ValidAddress(asset.TokenAddress) || asset.TokenAddress == domain.ZeroAddress {
		return decodedTransfer{}, errors.New("invalid selected asset")
	}
	if source.Removed {
		return decodedTransfer{}, errors.New("removed Transfer log")
	}
	address := domain.NormalizeAddress(source.Address)
	if !domain.ValidAddress(address) || address != domain.NormalizeAddress(asset.TokenAddress) {
		return decodedTransfer{}, errors.New("Transfer log token differs from selected asset")
	}
	if source.BlockNumber < startBlock || source.BlockNumber > endBlock {
		return decodedTransfer{}, errors.New("Transfer log is outside requested range")
	}
	if uint64(source.BlockNumber) > math.MaxInt64 {
		return decodedTransfer{}, errors.New("Transfer block number exceeds storage range")
	}
	if len(source.Topics) != 3 || !strings.EqualFold(source.Topics[0], rpc.TransferTopic) {
		return decodedTransfer{}, errors.New("invalid Transfer topics")
	}
	from, err := decodeAddressTopic(source.Topics[1])
	if err != nil {
		return decodedTransfer{}, fmt.Errorf("decode Transfer from address: %w", err)
	}
	to, err := decodeAddressTopic(source.Topics[2])
	if err != nil {
		return decodedTransfer{}, fmt.Errorf("decode Transfer to address: %w", err)
	}
	if len(source.Data) != 32 {
		return decodedTransfer{}, errors.New("Transfer amount must be exactly 32 bytes")
	}
	if source.TransactionIndex > math.MaxInt32 || source.LogIndex > math.MaxInt32 {
		return decodedTransfer{}, errors.New("Transfer position exceeds storage range")
	}
	txHash := strings.ToLower(source.TxHash)
	blockHash := strings.ToLower(source.BlockHash)
	if !domain.ValidHash(txHash) || !domain.ValidHash(blockHash) {
		return decodedTransfer{}, errors.New("invalid Transfer transaction or block hash")
	}
	amountRaw := new(big.Int).SetBytes(source.Data).String()
	if _, err := domain.ParseAmount(amountRaw); err != nil {
		return decodedTransfer{}, fmt.Errorf("invalid Transfer amount: %w", err)
	}

	return decodedTransfer{
		stored: storage.Transfer{
			ID:          domain.SnapshotTransferID(asset.ChainID, txHash, source.LogIndex),
			TxHash:      txHash,
			LogIndex:    source.LogIndex,
			FromAddress: from,
			ToAddress:   to,
			AmountRaw:   amountRaw,
		},
		blockNumber:      source.BlockNumber,
		blockHash:        blockHash,
		transactionIndex: source.TransactionIndex,
		source:           cloneRPCLog(source),
	}, nil
}

// decodeAddressTopic accepts only the canonical 12 zero bytes followed by a
// 20-byte indexed address and returns its lowercase representation.
func decodeAddressTopic(topic string) (string, error) {
	if len(topic) != 66 || !strings.HasPrefix(topic, "0x") {
		return "", errors.New("address topic must be 32 bytes")
	}
	data, err := hex.DecodeString(topic[2:])
	if err != nil || len(data) != 32 {
		return "", errors.New("address topic is not hexadecimal")
	}
	for _, value := range data[:12] {
		if value != 0 {
			return "", errors.New("address topic has nonzero padding")
		}
	}
	return "0x" + hex.EncodeToString(data[12:]), nil
}

// cloneRPCLog copies mutable topic and data slices before retaining source data
// for duplicate and Receipt comparisons.
func cloneRPCLog(source rpc.Log) rpc.Log {
	clone := source
	clone.Topics = append([]string(nil), source.Topics...)
	clone.Data = append([]byte(nil), source.Data...)
	return clone
}
