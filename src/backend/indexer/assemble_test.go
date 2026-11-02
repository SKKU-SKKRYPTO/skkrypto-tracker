package indexer

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/rpc"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

// TestAssembleChunkFromFixtureRPC normalizes the shared multi-transaction,
// multi-log Fixture into Snapshot IDs without changing raw values.
func TestAssembleChunkFromFixtureRPC(t *testing.T) {
	data, err := os.ReadFile("../api-server/testdata/fixtures/flow-demo-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Dataset   domain.Dataset    `json:"dataset"`
		Transfers []domain.Transfer `json:"transfers"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	stub, err := rpc.NewFixtureStub(fixture.Dataset, fixture.Transfers)
	if err != nil {
		t.Fatal(err)
	}
	spec := storage.DatasetSpec{
		Key:             storage.DatasetKey{ID: fixture.Dataset.ID, Version: "snapshot-v1"},
		SourceNamespace: fixture.Dataset.SourceNamespace,
		Asset:           fixture.Dataset.Asset,
		Coverage:        fixture.Dataset.Coverage(),
		FinalizedBlock:  fixture.Dataset.EndBlock,
	}
	chunk, err := assembleChunk(context.Background(), stub, spec, spec.Coverage.StartBlock, spec.Coverage.EndBlock)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunk.Transfers) != len(fixture.Transfers) || len(chunk.Transactions) == 0 {
		t.Fatalf("chunk counts = blocks %d, transactions %d, transfers %d", len(chunk.Blocks), len(chunk.Transactions), len(chunk.Transfers))
	}
	wantByID := make(map[string]domain.Transfer, len(fixture.Transfers))
	for _, transfer := range fixture.Transfers {
		wantByID[domain.SnapshotTransferID(domain.ChainID, transfer.TxHash, transfer.LogIndex)] = transfer
	}
	for i, transfer := range chunk.Transfers {
		want, ok := wantByID[transfer.ID]
		if !ok || transfer.AmountRaw != want.AmountRaw || transfer.FromAddress != want.From || transfer.ToAddress != want.To {
			t.Fatalf("transfer %d = %+v, fixture = %+v", i, transfer, want)
		}
	}
}

func testDatasetSpec() storage.DatasetSpec {
	return storage.DatasetSpec{
		Key:             storage.DatasetKey{ID: "test", Version: "v1"},
		SourceNamespace: "base-sepolia",
		Asset:           testAsset(18),
		Coverage: domain.Coverage{
			StartBlock: 10,
			EndBlock:   20,
			StartTime:  time.Unix(1_700_000_010, 0).UTC(),
			EndTime:    time.Unix(1_700_000_020, 0).UTC(),
		},
		FinalizedBlock: 20,
	}
}

func testBlock(number domain.BlockNumber, at time.Time) rpc.Block {
	return rpc.Block{Number: number, Hash: testHash(byte(number)), Time: at.UTC()}
}

func addSuccessfulSource(stub *rpc.Stub, log rpc.Log, at time.Time) {
	stub.AddLog(log)
	stub.AddBlock(testBlock(log.BlockNumber, at))
	stub.AddReceipt(rpc.Receipt{
		TxHash:           log.TxHash,
		BlockNumber:      log.BlockNumber,
		BlockHash:        log.BlockHash,
		TransactionIndex: log.TransactionIndex,
		Status:           1,
		Logs:             []rpc.Log{log},
	})
}

// TestAssembleChunkSortsDeduplicatesAndCaches verifies deterministic output,
// exact duplicate admission and one Header/Receipt call per source identity.
func TestAssembleChunkSortsDeduplicatesAndCaches(t *testing.T) {
	spec := testDatasetSpec()
	first := testRPCTransferLog(12, 3, 4, big.NewInt(7))
	second := testRPCTransferLog(13, 1, 2, big.NewInt(8))
	stub := rpc.NewStub(rpc.Block{})
	addSuccessfulSource(stub, first, time.Unix(1_700_000_012, 0))
	addSuccessfulSource(stub, second, time.Unix(1_700_000_013, 0))
	stub.AddBlock(testBlock(10, spec.Coverage.StartTime))
	stub.AddBlock(testBlock(20, spec.Coverage.EndTime))
	stub.QueueTransferLogs(spec.Asset.TokenAddress, 10, 20, []rpc.Log{second, first, first}, nil)

	chunk, err := assembleChunk(context.Background(), stub, spec, 10, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunk.Blocks) != 4 || chunk.Blocks[0].Number != 10 || chunk.Blocks[3].Number != 20 {
		t.Fatalf("blocks = %+v", chunk.Blocks)
	}
	if len(chunk.Transactions) != 2 || chunk.Transactions[0].Hash != first.TxHash || chunk.Transactions[1].Hash != second.TxHash {
		t.Fatalf("transactions = %+v", chunk.Transactions)
	}
	if len(chunk.Transfers) != 2 || chunk.Transfers[0].AmountRaw != "7" || chunk.Transfers[1].AmountRaw != "8" {
		t.Fatalf("transfers = %+v", chunk.Transfers)
	}
	counts := map[rpc.Method]int{}
	for _, call := range stub.Calls() {
		counts[call.Method]++
	}
	if counts[rpc.MethodTransferLogs] != 1 || counts[rpc.MethodBlockByNumber] != 4 || counts[rpc.MethodReceipt] != 2 {
		t.Fatalf("calls = %+v", stub.Calls())
	}
}

// TestAssembleChunkEmptyRangeIncludesRequiredBoundaries verifies an empty first
// chunk advances with its end block and immutable Dataset start block.
func TestAssembleChunkEmptyRangeIncludesRequiredBoundaries(t *testing.T) {
	spec := testDatasetSpec()
	stub := rpc.NewStub(rpc.Block{})
	stub.AddBlock(testBlock(10, spec.Coverage.StartTime))
	stub.AddBlock(testBlock(15, time.Unix(1_700_000_015, 0)))
	chunk, err := assembleChunk(context.Background(), stub, spec, 10, 15)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunk.Blocks) != 2 || chunk.Blocks[0].Number != 10 || chunk.Blocks[1].Number != 15 ||
		len(chunk.Transactions) != 0 || len(chunk.Transfers) != 0 {
		t.Fatalf("chunk = %+v", chunk)
	}

	stub = rpc.NewStub(rpc.Block{})
	stub.AddBlock(testBlock(20, spec.Coverage.EndTime))
	chunk, err = assembleChunk(context.Background(), stub, spec, 20, 20)
	if err != nil || len(chunk.Blocks) != 1 || chunk.Blocks[0].Number != 20 {
		t.Fatalf("same-block chunk = %+v, %v", chunk, err)
	}
}

// TestAssembleChunkRejectsConflictingDuplicate rejects a stable source ID whose
// repeated payload is not byte-for-byte equivalent.
func TestAssembleChunkRejectsConflictingDuplicate(t *testing.T) {
	spec := testDatasetSpec()
	first := testRPCTransferLog(12, 3, 4, big.NewInt(7))
	conflict := cloneRPCLog(first)
	conflict.Data = testAmountData(big.NewInt(8))
	stub := rpc.NewStub(rpc.Block{})
	stub.QueueTransferLogs(spec.Asset.TokenAddress, 10, 20, []rpc.Log{first, conflict}, nil)
	if _, err := assembleChunk(context.Background(), stub, spec, 10, 20); err == nil {
		t.Fatal("conflicting duplicate was accepted")
	}
	if len(stub.Calls()) != 1 || stub.Calls()[0].Method != rpc.MethodTransferLogs {
		t.Fatalf("calls after decode failure = %+v", stub.Calls())
	}
}

// TestAssembleChunkRejectsHeaderAndCoverageMismatch freezes source hash and
// immutable endpoint-time validation before Receipt reads.
func TestAssembleChunkRejectsHeaderAndCoverageMismatch(t *testing.T) {
	spec := testDatasetSpec()
	log := testRPCTransferLog(12, 3, 4, big.NewInt(7))
	tests := map[string]func(*rpc.Stub){
		"header hash": func(stub *rpc.Stub) {
			stub.AddBlock(rpc.Block{Number: 12, Hash: testHash(0x99), Time: time.Unix(1_700_000_012, 0)})
			stub.AddBlock(testBlock(20, spec.Coverage.EndTime))
		},
		"end time": func(stub *rpc.Stub) {
			stub.AddBlock(testBlock(12, time.Unix(1_700_000_012, 0)))
			stub.AddBlock(testBlock(20, spec.Coverage.EndTime.Add(time.Second)))
		},
	}
	for name, configure := range tests {
		t.Run(name, func(t *testing.T) {
			stub := rpc.NewStub(rpc.Block{})
			stub.AddLog(log)
			configure(stub)
			if _, err := assembleChunk(context.Background(), stub, spec, 11, 20); err == nil {
				t.Fatal("mismatching source was accepted")
			}
			for _, call := range stub.Calls() {
				if call.Method == rpc.MethodReceipt {
					t.Fatalf("Receipt was read after header failure: %+v", stub.Calls())
				}
			}
		})
	}
}

// TestAssembleChunkReceiptValidation covers receipt success, identity, payload,
// omission and the allowed presence of unrelated logs.
func TestAssembleChunkReceiptValidation(t *testing.T) {
	spec := testDatasetSpec()
	log := testRPCTransferLog(12, 3, 4, big.NewInt(7))
	baseReceipt := rpc.Receipt{
		TxHash: log.TxHash, BlockNumber: 12, BlockHash: log.BlockHash,
		TransactionIndex: 3, Status: 1, Logs: []rpc.Log{log},
	}
	tests := map[string]struct {
		mutate  func(*rpc.Receipt)
		wantErr bool
	}{
		"failed transaction": {mutate: func(receipt *rpc.Receipt) { receipt.Status = 0 }, wantErr: true},
		"tx hash":            {mutate: func(receipt *rpc.Receipt) { receipt.TxHash = testHash(0x91) }, wantErr: true},
		"tx index":           {mutate: func(receipt *rpc.Receipt) { receipt.TransactionIndex++ }, wantErr: true},
		"block number":       {mutate: func(receipt *rpc.Receipt) { receipt.BlockNumber++ }, wantErr: true},
		"block hash":         {mutate: func(receipt *rpc.Receipt) { receipt.BlockHash = testHash(0x92) }, wantErr: true},
		"missing payload":    {mutate: func(receipt *rpc.Receipt) { receipt.Logs = nil }, wantErr: true},
		"different payload": {mutate: func(receipt *rpc.Receipt) {
			receipt.Logs[0].Data = testAmountData(big.NewInt(9))
		}, wantErr: true},
		"log transaction index": {mutate: func(receipt *rpc.Receipt) {
			receipt.Logs[0].TransactionIndex++
		}, wantErr: true},
		"duplicate receipt log": {mutate: func(receipt *rpc.Receipt) {
			receipt.Logs = append(receipt.Logs, cloneRPCLog(receipt.Logs[0]))
		}, wantErr: true},
		"extra selected transfer": {mutate: func(receipt *rpc.Receipt) {
			extra := cloneRPCLog(log)
			extra.LogIndex++
			receipt.Logs = append(receipt.Logs, extra)
		}, wantErr: true},
		"unrelated logs": {mutate: func(receipt *rpc.Receipt) {
			otherToken := cloneRPCLog(log)
			otherToken.Address = testAddress(0x99)
			approval := cloneRPCLog(log)
			approval.Topics[0] = testHash(0x77)
			receipt.Logs = append(receipt.Logs, otherToken, approval)
		}},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			stub := rpc.NewStub(rpc.Block{})
			stub.AddLog(log)
			stub.AddBlock(testBlock(12, time.Unix(1_700_000_012, 0)))
			stub.AddBlock(testBlock(20, spec.Coverage.EndTime))
			receipt := baseReceipt
			receipt.Logs = append([]rpc.Log(nil), baseReceipt.Logs...)
			test.mutate(&receipt)
			stub.AddReceipt(receipt)
			_, err := assembleChunk(context.Background(), stub, spec, 11, 20)
			if test.wantErr && err == nil {
				t.Fatal("receipt mismatch was accepted")
			}
			if !test.wantErr && err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestAssembleChunkPropagatesCancellation ensures source work stops with the
// caller context and does not convert cancellation into a retryable source error.
func TestAssembleChunkPropagatesCancellation(t *testing.T) {
	spec := testDatasetSpec()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stub := rpc.NewStub(rpc.Block{})
	if _, err := assembleChunk(ctx, stub, spec, 10, 20); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v", err)
	}
	if len(stub.Calls()) != 0 {
		t.Fatalf("calls = %+v", stub.Calls())
	}
}
