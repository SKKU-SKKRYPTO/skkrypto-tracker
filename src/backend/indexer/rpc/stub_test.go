package rpc

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// loadFlowFixture는 RPC Stub 검증에 사용할 기본 흐름 Fixture를 읽는다.
func loadFlowFixture(t *testing.T) (domain.Dataset, []domain.Transfer) {
	t.Helper()
	path := filepath.Join("..", "..", "api-server", "testdata", "fixtures", "flow-demo-v1.json")
	return loadFixture(t, path)
}

// loadFixture는 JSON Fixture의 Dataset과 Transfer 목록을 읽는다.
func loadFixture(t *testing.T, path string) (domain.Dataset, []domain.Transfer) {
	t.Helper()
	data, err := os.ReadFile(path)
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
	return fixture.Dataset, fixture.Transfers
}

// TestAllFixturesCanBuildRPCStub은 모든 공개 Fixture가 RPC 응답으로 변환되는지 검증한다.
func TestAllFixturesCanBuildRPCStub(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "api-server", "testdata", "fixtures", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("no fixtures found")
	}
	for _, path := range paths {
		t.Run(filepath.Base(path), func(t *testing.T) {
			dataset, transfers := loadFixture(t, path)
			if _, err := NewFixtureStub(dataset, transfers); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestFixtureStubProvidesRPCView는 Fixture의 finalized·로그·블록·Receipt 응답을 검증한다.
func TestFixtureStubProvidesRPCView(t *testing.T) {
	dataset, transfers := loadFlowFixture(t)
	stub, err := NewFixtureStub(dataset, transfers)
	if err != nil {
		t.Fatal(err)
	}

	finalized, err := stub.FinalizedBlock(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if finalized.Number != dataset.EndBlock || finalized.Hash != dataset.BoundaryHashes[dataset.EndBlock.String()] {
		t.Fatalf("finalized = %+v", finalized)
	}

	logs, err := stub.TransferLogs(context.Background(), dataset.Asset.TokenAddress, dataset.StartBlock, dataset.EndBlock)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != len(transfers) || logs[0].Topics[0] != TransferTopic || len(logs[0].Data) != 32 {
		t.Fatalf("logs = %+v", logs)
	}

	block, err := stub.BlockByNumber(context.Background(), transfers[0].BlockNumber)
	if err != nil {
		t.Fatal(err)
	}
	if block.Hash != transfers[0].BlockHash || !block.Time.Equal(transfers[0].Timestamp) {
		t.Fatalf("block = %+v", block)
	}

	receipt, err := stub.Receipt(context.Background(), transfers[0].TxHash)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Status != 1 || len(receipt.Logs) != 1 || receipt.Logs[0].LogIndex != transfers[0].LogIndex {
		t.Fatalf("receipt = %+v", receipt)
	}
}

// TestStubRangeAndResultLimits는 공급자 범위·결과 수 제한 오류를 검증한다.
func TestStubRangeAndResultLimits(t *testing.T) {
	dataset, transfers := loadFlowFixture(t)
	stub, err := NewFixtureStub(dataset, transfers)
	if err != nil {
		t.Fatal(err)
	}

	stub.SetLimits(1, 0)
	_, err = stub.TransferLogs(context.Background(), dataset.Asset.TokenAddress, dataset.StartBlock, dataset.StartBlock+1)
	if !errors.Is(err, ErrRangeLimit) {
		t.Fatalf("range error = %v", err)
	}

	stub.SetLimits(0, 1)
	_, err = stub.TransferLogs(context.Background(), dataset.Asset.TokenAddress, dataset.StartBlock, dataset.EndBlock)
	if !errors.Is(err, ErrResultLimit) {
		t.Fatalf("result error = %v", err)
	}
}

// TestStubQueuesTemporaryFailureThenFixtureResult는 일시 오류 뒤 정상 응답 순서를 검증한다.
func TestStubQueuesTemporaryFailureThenFixtureResult(t *testing.T) {
	dataset, transfers := loadFlowFixture(t)
	stub, err := NewFixtureStub(dataset, transfers)
	if err != nil {
		t.Fatal(err)
	}
	start, end := transfers[0].BlockNumber, transfers[0].BlockNumber
	stub.QueueTransferLogs(dataset.Asset.TokenAddress, start, end, nil, ErrTemporary)

	if _, err := stub.TransferLogs(context.Background(), dataset.Asset.TokenAddress, start, end); !errors.Is(err, ErrTemporary) {
		t.Fatalf("first call error = %v", err)
	}
	logs, err := stub.TransferLogs(context.Background(), dataset.Asset.TokenAddress, start, end)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 || logs[0].TxHash != transfers[0].TxHash {
		t.Fatalf("logs = %+v", logs)
	}

	calls := stub.Calls()
	if len(calls) != 2 || calls[0].Method != MethodTransferLogs || calls[1].Method != MethodTransferLogs {
		t.Fatalf("calls = %+v", calls)
	}
}

// TestStubCanChangeBoundaryHashBetweenCalls는 재개 시 경계 hash 변경 상황을 검증한다.
func TestStubCanChangeBoundaryHashBetweenCalls(t *testing.T) {
	dataset, _ := loadFlowFixture(t)
	stub, err := NewFixtureStub(dataset, nil)
	if err != nil {
		t.Fatal(err)
	}
	original := Block{Number: dataset.EndBlock, Hash: dataset.BoundaryHashes[dataset.EndBlock.String()], Time: dataset.EndTime}
	changed := original
	changed.Hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	stub.QueueBlock(dataset.EndBlock, original, nil)
	stub.QueueBlock(dataset.EndBlock, changed, nil)

	first, err := stub.BlockByNumber(context.Background(), dataset.EndBlock)
	if err != nil {
		t.Fatal(err)
	}
	second, err := stub.BlockByNumber(context.Background(), dataset.EndBlock)
	if err != nil {
		t.Fatal(err)
	}
	if first.Hash == second.Hash {
		t.Fatalf("hash did not change: %s", first.Hash)
	}
}

// TestStubCanReturnFailedReceipt는 실패 거래 Receipt를 주입할 수 있는지 검증한다.
func TestStubCanReturnFailedReceipt(t *testing.T) {
	dataset, transfers := loadFlowFixture(t)
	stub, err := NewFixtureStub(dataset, transfers)
	if err != nil {
		t.Fatal(err)
	}
	failed := Receipt{
		TxHash:           transfers[0].TxHash,
		BlockNumber:      transfers[0].BlockNumber,
		BlockHash:        transfers[0].BlockHash,
		TransactionIndex: transfers[0].TransactionIndex,
		Status:           0,
	}
	stub.QueueReceipt(transfers[0].TxHash, failed, nil)

	receipt, err := stub.Receipt(context.Background(), transfers[0].TxHash)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Status != 0 {
		t.Fatalf("receipt status = %d", receipt.Status)
	}
}
