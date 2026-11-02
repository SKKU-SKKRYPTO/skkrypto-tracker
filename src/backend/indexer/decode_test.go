package indexer

import (
	"encoding/hex"
	"math"
	"math/big"
	"strings"
	"testing"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/rpc"
)

const testTokenAddress = "0x1111111111111111111111111111111111111111"

func testAsset(decimals int) domain.Asset {
	return domain.Asset{ChainID: domain.ChainID, TokenAddress: testTokenAddress, Symbol: "TKN", Decimals: decimals}
}

func testHash(value byte) string {
	return "0x" + strings.Repeat(hex.EncodeToString([]byte{value}), 32)
}

func testAddress(value byte) string {
	return "0x" + strings.Repeat(hex.EncodeToString([]byte{value}), 20)
}

func testAddressTopic(address string) string {
	return "0x" + strings.Repeat("0", 24) + strings.TrimPrefix(address, "0x")
}

func testAmountData(value *big.Int) []byte {
	data := make([]byte, 32)
	value.FillBytes(data)
	return data
}

func testRPCTransferLog(block domain.BlockNumber, txIndex, logIndex uint32, amount *big.Int) rpc.Log {
	return rpc.Log{
		Address: testTokenAddress,
		Topics: []string{
			rpc.TransferTopic,
			testAddressTopic(testAddress(0x22)),
			testAddressTopic(testAddress(0x33)),
		},
		Data:             testAmountData(amount),
		BlockNumber:      block,
		BlockHash:        testHash(byte(block)),
		TxHash:           testHash(byte(block + domain.BlockNumber(txIndex) + 20)),
		TransactionIndex: txIndex,
		LogIndex:         logIndex,
	}
}

// TestDecodeTransferLogPreservesRawUint256 freezes zero/max values, stable IDs,
// lowercase addresses and the rule that decimals never scale AmountRaw.
func TestDecodeTransferLogPreservesRawUint256(t *testing.T) {
	maximum := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	for _, amount := range []*big.Int{big.NewInt(0), maximum} {
		log := testRPCTransferLog(12, 3, 4, amount)
		log.Address = strings.ToUpper(log.Address)
		decoded, err := decodeTransferLog(log, testAsset(6), 10, 20)
		if err != nil {
			t.Fatal(err)
		}
		if decoded.stored.AmountRaw != amount.String() || decoded.stored.FromAddress != testAddress(0x22) || decoded.stored.ToAddress != testAddress(0x33) {
			t.Fatalf("decoded = %+v", decoded)
		}
		wantID := domain.SnapshotTransferID(domain.ChainID, strings.ToLower(log.TxHash), log.LogIndex)
		if decoded.stored.ID != wantID {
			t.Fatalf("ID = %q, want %q", decoded.stored.ID, wantID)
		}
		otherDecimals, err := decodeTransferLog(log, testAsset(18), 10, 20)
		if err != nil || otherDecimals.stored.ID != decoded.stored.ID || otherDecimals.stored.AmountRaw != decoded.stored.AmountRaw {
			t.Fatalf("decimals changed source identity/value: %+v, %v", otherDecimals, err)
		}
	}
}

// TestDecodeTransferLogPreservesTransferKinds verifies mint, burn and self
// transfers remain ordinary normalized source records.
func TestDecodeTransferLogPreservesTransferKinds(t *testing.T) {
	tests := []struct{ from, to string }{
		{domain.ZeroAddress, testAddress(0x33)},
		{testAddress(0x22), domain.ZeroAddress},
		{testAddress(0x44), testAddress(0x44)},
	}
	for i, test := range tests {
		log := testRPCTransferLog(12, 3, uint32(i), big.NewInt(0))
		log.Topics[1] = testAddressTopic(test.from)
		log.Topics[2] = testAddressTopic(test.to)
		decoded, err := decodeTransferLog(log, testAsset(18), 10, 20)
		if err != nil {
			t.Fatal(err)
		}
		if decoded.stored.FromAddress != test.from || decoded.stored.ToAddress != test.to || decoded.stored.AmountRaw != "0" {
			t.Fatalf("decoded = %+v", decoded)
		}
	}
}

// TestDecodeTransferLogRejectsMalformedSource covers every source validation
// boundary before a record can enter chunk assembly.
func TestDecodeTransferLogRejectsMalformedSource(t *testing.T) {
	base := testRPCTransferLog(12, 3, 4, big.NewInt(1))
	tests := map[string]func(*rpc.Log){
		"wrong token":       func(log *rpc.Log) { log.Address = testAddress(0x99) },
		"outside range":     func(log *rpc.Log) { log.BlockNumber = 21 },
		"removed":           func(log *rpc.Log) { log.Removed = true },
		"wrong signature":   func(log *rpc.Log) { log.Topics[0] = testHash(0x99) },
		"two topics":        func(log *rpc.Log) { log.Topics = log.Topics[:2] },
		"four topics":       func(log *rpc.Log) { log.Topics = append(log.Topics, testHash(1)) },
		"short address":     func(log *rpc.Log) { log.Topics[1] = "0x12" },
		"nonzero padding":   func(log *rpc.Log) { log.Topics[1] = "0x01" + strings.TrimPrefix(log.Topics[1], "0x")[2:] },
		"bad address hex":   func(log *rpc.Log) { log.Topics[1] = "0x" + strings.Repeat("z", 64) },
		"31-byte data":      func(log *rpc.Log) { log.Data = make([]byte, 31) },
		"33-byte data":      func(log *rpc.Log) { log.Data = make([]byte, 33) },
		"bad tx hash":       func(log *rpc.Log) { log.TxHash = "0x12" },
		"bad block hash":    func(log *rpc.Log) { log.BlockHash = "0x12" },
		"large block":       func(log *rpc.Log) { log.BlockNumber = domain.BlockNumber(math.MaxInt64) + 1 },
		"large tx position": func(log *rpc.Log) { log.TransactionIndex = math.MaxInt32 + 1 },
		"large log position": func(log *rpc.Log) {
			log.LogIndex = math.MaxInt32 + 1
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			log := cloneRPCLog(base)
			mutate(&log)
			if _, err := decodeTransferLog(log, testAsset(18), 10, 20); err == nil {
				t.Fatal("malformed source was accepted")
			}
		})
	}
}
