package rpc

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	gethrpc "github.com/ethereum/go-ethereum/rpc"
)

type stubEthereumAPI struct {
	chainID       *big.Int
	chainErr      error
	header        *types.Header
	headerErr     error
	headerNumber  *big.Int
	logs          []types.Log
	logsErr       error
	query         ethereum.FilterQuery
	receipt       *types.Receipt
	receiptErr    error
	receiptTxHash common.Hash
}

func (s *stubEthereumAPI) ChainID(context.Context) (*big.Int, error) {
	return s.chainID, s.chainErr
}

func (s *stubEthereumAPI) HeaderByNumber(_ context.Context, number *big.Int) (*types.Header, error) {
	if number != nil {
		s.headerNumber = new(big.Int).Set(number)
	}
	return s.header, s.headerErr
}

func (s *stubEthereumAPI) FilterLogs(_ context.Context, query ethereum.FilterQuery) ([]types.Log, error) {
	s.query = query
	return s.logs, s.logsErr
}

func (s *stubEthereumAPI) TransactionReceipt(_ context.Context, txHash common.Hash) (*types.Receipt, error) {
	s.receiptTxHash = txHash
	return s.receipt, s.receiptErr
}

// TestEthereumChainIDValidation covers the expected chain and invalid numeric responses.
func TestEthereumChainIDValidation(t *testing.T) {
	tests := []struct {
		name    string
		chainID *big.Int
		wantErr bool
	}{
		{name: "base sepolia", chainID: new(big.Int).SetUint64(domain.ChainID)},
		{name: "wrong chain", chainID: big.NewInt(1), wantErr: true},
		{name: "nil", wantErr: true},
		{name: "negative", chainID: big.NewInt(-1), wantErr: true},
		{name: "overflow", chainID: new(big.Int).Lsh(big.NewInt(1), 65), wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := newEthereumClient(&stubEthereumAPI{chainID: test.chainID})
			got, err := client.ChainID(context.Background())
			if test.wantErr {
				if err == nil {
					t.Fatalf("ChainID() = %d, nil", got)
				}
				return
			}
			if err != nil || got != domain.ChainID {
				t.Fatalf("ChainID() = %d, %v", got, err)
			}
		})
	}
}

// TestEthereumFinalizedAndBlockConversion verifies the finalized tag and UTC header conversion.
func TestEthereumFinalizedAndBlockConversion(t *testing.T) {
	header := testHeader(100, 1_700_000_000)
	api := &stubEthereumAPI{header: header}
	client := newEthereumClient(api)
	block, err := client.FinalizedBlock(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if api.headerNumber == nil || api.headerNumber.Int64() != int64(gethrpc.FinalizedBlockNumber) {
		t.Fatalf("header number = %v", api.headerNumber)
	}
	if block.Number != 100 || block.Hash != strings.ToLower(header.Hash().Hex()) || block.Time.Location() != time.UTC {
		t.Fatalf("block = %+v", block)
	}

	api.header = nil
	if _, err := client.BlockByNumber(context.Background(), 100); !errors.Is(err, ErrNotFound) {
		t.Fatalf("nil header error = %v", err)
	}
}

// TestEthereumTransferLogsUsesExactFilter verifies address, topic, inclusive bounds and conversion.
func TestEthereumTransferLogsUsesExactFilter(t *testing.T) {
	address := common.HexToAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e")
	log := testTransferLog(address)
	api := &stubEthereumAPI{logs: []types.Log{log}}
	client := newEthereumClient(api)
	uppercase := "0x" + strings.ToUpper(strings.TrimPrefix(address.Hex(), "0x"))
	got, err := client.TransferLogs(context.Background(), uppercase, 10, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(api.query.Addresses) != 1 || api.query.Addresses[0] != address ||
		len(api.query.Topics) != 1 || len(api.query.Topics[0]) != 1 || api.query.Topics[0][0] != common.HexToHash(TransferTopic) ||
		api.query.FromBlock.Uint64() != 10 || api.query.ToBlock.Uint64() != 20 {
		t.Fatalf("query = %+v", api.query)
	}
	if len(got) != 1 || got[0].BlockNumber != 12 || got[0].TransactionIndex != 3 || got[0].LogIndex != 4 || len(got[0].Data) != 32 {
		t.Fatalf("logs = %+v", got)
	}
	api.logs[0].Data = []byte{1}
	if _, err := client.TransferLogs(context.Background(), address.Hex(), 10, 20); err == nil {
		t.Fatal("malformed Transfer log was accepted")
	}
}

// TestEthereumReceiptConversion validates receipt position and included log conversion.
func TestEthereumReceiptConversion(t *testing.T) {
	address := common.HexToAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e")
	log := testTransferLog(address)
	receipt := &types.Receipt{
		TxHash:           log.TxHash,
		BlockNumber:      new(big.Int).SetUint64(log.BlockNumber),
		BlockHash:        log.BlockHash,
		TransactionIndex: log.TxIndex,
		Status:           types.ReceiptStatusSuccessful,
		Logs:             []*types.Log{&log},
	}
	api := &stubEthereumAPI{receipt: receipt}
	client := newEthereumClient(api)
	got, err := client.Receipt(context.Background(), strings.ToLower(log.TxHash.Hex()))
	if err != nil {
		t.Fatal(err)
	}
	if api.receiptTxHash != log.TxHash || got.Status != 1 || len(got.Logs) != 1 || got.Logs[0].LogIndex != uint32(log.Index) {
		t.Fatalf("receipt = %+v", got)
	}
	api.receipt = nil
	if _, err := client.Receipt(context.Background(), log.TxHash.Hex()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("nil receipt error = %v", err)
	}
}

// TestEthereumRejectsOverflowAndNotFoundResponses covers narrowing and missing-value boundaries.
func TestEthereumRejectsOverflowAndNotFoundResponses(t *testing.T) {
	tooLarge := new(big.Int).Lsh(big.NewInt(1), 65)
	client := newEthereumClient(&stubEthereumAPI{header: &types.Header{Number: tooLarge, GasLimit: 1}})
	if _, err := client.FinalizedBlock(context.Background()); err == nil {
		t.Fatal("overflow block number was accepted")
	}

	address := common.HexToAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e")
	log := testTransferLog(address)
	log.Index = uint(^uint32(0)) + 1
	client = newEthereumClient(&stubEthereumAPI{logs: []types.Log{log}})
	if _, err := client.TransferLogs(context.Background(), address.Hex(), 10, 20); err == nil {
		t.Fatal("overflow log index was accepted")
	}

	missing := newEthereumClient(&stubEthereumAPI{headerErr: ethereum.NotFound})
	if _, err := missing.BlockByNumber(context.Background(), 10); !errors.Is(err, ErrNotFound) {
		t.Fatalf("not found block error = %v", err)
	}
}

type codedError struct {
	code    int
	message string
}

func (e codedError) Error() string  { return e.message }
func (e codedError) ErrorCode() int { return e.code }

type timeoutError struct{}

func (timeoutError) Error() string   { return "timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

// TestRPCErrorClassification freezes the fail-closed structured classifier.
func TestRPCErrorClassification(t *testing.T) {
	tests := []struct {
		name      string
		operation operation
		err       error
		want      error
	}{
		{name: "logs 413", operation: operationTransferLogs, err: &httpStatusError{status: 413}, want: ErrRangeLimit},
		{name: "other 413", operation: operationReceipt, err: &httpStatusError{status: 413}},
		{name: "logs -32005", operation: operationTransferLogs, err: codedError{code: -32005}, want: ErrResultLimit},
		{name: "other -32005", operation: operationReceipt, err: codedError{code: -32005}},
		{name: "429", operation: operationReceipt, err: &httpStatusError{status: 429}, want: ErrTemporary},
		{name: "500", operation: operationChainID, err: &httpStatusError{status: 500}, want: ErrTemporary},
		{name: "599", operation: operationTransferLogs, err: &httpStatusError{status: 599}, want: ErrTemporary},
		{name: "401", operation: operationTransferLogs, err: &httpStatusError{status: 401}},
		{name: "403", operation: operationTransferLogs, err: &httpStatusError{status: 403}},
		{name: "-32000 substring", operation: operationTransferLogs, err: codedError{code: -32000, message: "too many results"}},
		{name: "-32602 substring", operation: operationTransferLogs, err: codedError{code: -32602, message: "range limit"}},
		{name: "timeout", operation: operationReceipt, err: timeoutError{}, want: ErrTemporary},
		{name: "canceled", operation: operationReceipt, err: context.Canceled, want: context.Canceled},
		{name: "deadline", operation: operationReceipt, err: context.DeadlineExceeded, want: context.DeadlineExceeded},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := classifyError(test.operation, test.err)
			if test.want == nil {
				if errors.Is(got, ErrRangeLimit) || errors.Is(got, ErrResultLimit) || errors.Is(got, ErrTemporary) {
					t.Fatalf("fatal error was classified retryable: %v", got)
				}
				return
			}
			if !errors.Is(got, test.want) {
				t.Fatalf("classifyError() = %v, want %v", got, test.want)
			}
		})
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := classifyContextError(canceled, operationReceipt, timeoutError{}); !errors.Is(err, context.Canceled) || errors.Is(err, ErrTemporary) {
		t.Fatalf("canceled context with timeout error = %v", err)
	}
	deadline, cancelDeadline := context.WithDeadline(context.Background(), time.Unix(0, 0))
	defer cancelDeadline()
	if err := classifyContextError(deadline, operationReceipt, timeoutError{}); !errors.Is(err, context.DeadlineExceeded) || errors.Is(err, ErrTemporary) {
		t.Fatalf("expired context with timeout error = %v", err)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

// TestEthereumHTTPOptionsReachTransport verifies the configured User-Agent and bounded timeout.
func TestEthereumHTTPOptionsReachTransport(t *testing.T) {
	var userAgent string
	var hasDeadline bool
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		userAgent = request.Header.Get("User-Agent")
		_, hasDeadline = request.Context().Deadline()
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"result":"0x14a34"}`)),
			Request:    request,
		}, nil
	})
	client, err := NewEthereumClientWithOptions(context.Background(), "https://example.invalid", HTTPOptions{
		Timeout: 50 * time.Millisecond, UserAgent: "test-agent", Transport: transport,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if _, err := client.ChainID(context.Background()); err != nil {
		t.Fatal(err)
	}
	if userAgent != "test-agent" || !hasDeadline {
		t.Fatalf("User-Agent = %q, has deadline = %v", userAgent, hasDeadline)
	}
}

// TestEthereumHTTPClientTimeoutIsTemporary verifies that the client's own deadline remains retryable while the caller is live.
func TestEthereumHTTPClientTimeoutIsTemporary(t *testing.T) {
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		select {
		case <-request.Context().Done():
			return nil, request.Context().Err()
		case <-time.After(time.Second):
			return nil, errors.New("HTTP client timeout was not propagated")
		}
	})
	client, err := NewEthereumClientWithOptions(
		context.Background(),
		"https://user:secret@example.invalid/private?key=secret",
		HTTPOptions{Timeout: 10 * time.Millisecond, Transport: transport},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.ChainID(context.Background())
	if !errors.Is(err, ErrTemporary) || errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("client timeout classification = %v", err)
	}
	if strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "example.invalid") {
		t.Fatalf("unsafe error = %v", err)
	}
}

// TestEthereumHTTPStatusClassification exercises status handling through the injected transport.
func TestEthereumHTTPStatusClassification(t *testing.T) {
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 503, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("secret")), Request: request}, nil
	})
	client, err := NewEthereumClientWithOptions(context.Background(), "https://user:secret@example.invalid/private?key=secret", HTTPOptions{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.ChainID(context.Background())
	if !errors.Is(err, ErrTemporary) || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "example.invalid") {
		t.Fatalf("error = %v", err)
	}
}

type trackingReadCloser struct {
	reader     io.Reader
	bytesRead  int
	closeCount int
}

func (b *trackingReadCloser) Read(destination []byte) (int, error) {
	n, err := b.reader.Read(destination)
	b.bytesRead += n
	return n, err
}

func (b *trackingReadCloser) Close() error {
	b.closeCount++
	return nil
}

// TestSuccessfulResponseBodyLimit verifies exact-bound reads, overflow detection and idempotent close.
func TestSuccessfulResponseBodyLimit(t *testing.T) {
	t.Run("exact bound", func(t *testing.T) {
		source := &trackingReadCloser{reader: strings.NewReader("12345678")}
		body := newLimitedResponseBody(source, 8)
		got, err := io.ReadAll(body)
		if err != nil || string(got) != "12345678" {
			t.Fatalf("ReadAll() = %q, %v", got, err)
		}
		if err := body.Close(); err != nil {
			t.Fatal(err)
		}
		if err := body.Close(); err != nil {
			t.Fatal(err)
		}
		if source.closeCount != 1 {
			t.Fatalf("close count = %d", source.closeCount)
		}
	})

	t.Run("stream overflow", func(t *testing.T) {
		source := &trackingReadCloser{reader: strings.NewReader("123456789")}
		body := newLimitedResponseBody(source, 8)
		got, err := io.ReadAll(body)
		if !errors.Is(err, errRPCResponseBodyTooLarge) || string(got) != "12345678" {
			t.Fatalf("ReadAll() = %q, %v", got, err)
		}
		_ = body.Close()
		_ = body.Close()
		if source.closeCount != 1 {
			t.Fatalf("close count = %d", source.closeCount)
		}
	})
}

// TestOversizedHTTPSuccessIsFatal verifies early Content-Length rejection through the real RPC client.
func TestOversizedHTTPSuccessIsFatal(t *testing.T) {
	body := &trackingReadCloser{reader: strings.NewReader("secret response body")}
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: maxRPCResponseBodySize + 1,
			Header:        make(http.Header),
			Body:          body,
			Request:       request,
		}, nil
	})
	client, err := NewEthereumClientWithOptions(
		context.Background(),
		"https://user:secret@example.invalid/private?key=secret",
		HTTPOptions{Transport: transport},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.ChainID(context.Background())
	if err == nil || errors.Is(err, ErrTemporary) || errors.Is(err, ErrRangeLimit) || errors.Is(err, ErrResultLimit) {
		t.Fatalf("oversized response classification = %v", err)
	}
	if strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "example.invalid") {
		t.Fatalf("unsafe error = %v", err)
	}
	if body.bytesRead != 0 || body.closeCount != 1 {
		t.Fatalf("body reads = %d, closes = %d", body.bytesRead, body.closeCount)
	}
}

// TestHTTPErrorBodyDrainRemainsCapped verifies non-success bodies still read at most 4 KiB.
func TestHTTPErrorBodyDrainRemainsCapped(t *testing.T) {
	body := &trackingReadCloser{reader: bytes.NewReader(bytes.Repeat([]byte{'x'}, 8192))}
	transport := &headerTransport{
		base: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: body, Request: request}, nil
		}),
		userAgent: "test-agent",
	}
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://example.invalid", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := transport.RoundTrip(request); err == nil {
		t.Fatal("non-success response was accepted")
	}
	if body.bytesRead != 4096 || body.closeCount != 1 {
		t.Fatalf("body reads = %d, closes = %d", body.bytesRead, body.closeCount)
	}
}

func testHeader(number, timestamp uint64) *types.Header {
	return &types.Header{Number: new(big.Int).SetUint64(number), Time: timestamp, GasLimit: 1}
}

func testTransferLog(address common.Address) types.Log {
	return types.Log{
		Address: address,
		Topics: []common.Hash{
			common.HexToHash(TransferTopic),
			common.HexToHash("0x01"),
			common.HexToHash("0x02"),
		},
		Data:        make([]byte, 32),
		BlockNumber: 12,
		BlockHash:   common.HexToHash("0x03"),
		TxHash:      common.HexToHash("0x04"),
		TxIndex:     3,
		Index:       4,
	}
}

var _ net.Error = timeoutError{}
