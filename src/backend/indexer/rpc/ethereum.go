package rpc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	gethrpc "github.com/ethereum/go-ethereum/rpc"
)

const (
	defaultHTTPTimeout = 15 * time.Second
	defaultUserAgent   = "skkrypto-tracker-indexer/1.0"
	// maxRPCResponseBodySize allows substantial headroom for the adaptive 10,000-block
	// Transfer query while preventing an RPC peer from making the JSON decoder grow without bound.
	// A canonical ERC-20 Transfer log is well below 1 KiB in JSON, so 64 MiB also exceeds
	// the expected response for 10,000 logs by several times.
	maxRPCResponseBodySize int64 = 64 << 20
)

var errRPCResponseBodyTooLarge = errors.New("RPC response body exceeds size limit")

type ethereumAPI interface {
	ChainID(context.Context) (*big.Int, error)
	HeaderByNumber(context.Context, *big.Int) (*types.Header, error)
	FilterLogs(context.Context, ethereum.FilterQuery) ([]types.Log, error)
	TransactionReceipt(context.Context, common.Hash) (*types.Receipt, error)
}

// HTTPOptions는 Ethereum RPC HTTP 연결의 제한과 테스트용 transport를 지정한다.
type HTTPOptions struct {
	Timeout   time.Duration
	UserAgent string
	Transport http.RoundTripper
}

// EthereumClient는 go-ethereum 응답을 Indexer의 최소 RPC 계약으로 변환한다.
type EthereumClient struct {
	client ethereumAPI
	close  func()
}

// NewEthereumClient는 제한된 기본 timeout과 User-Agent로 HTTP(S) RPC에 연결한다.
func NewEthereumClient(ctx context.Context, endpoint string) (*EthereumClient, error) {
	return NewEthereumClientWithOptions(ctx, endpoint, HTTPOptions{})
}

// NewEthereumClientWithOptions는 주입된 HTTP 설정으로 RPC 연결을 만든다.
// endpoint의 사용자 정보와 query는 오류에 포함하지 않는다.
func NewEthereumClientWithOptions(ctx context.Context, endpoint string, options HTTPOptions) (*EthereumClient, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("RPC endpoint must be an HTTP(S) URL")
	}
	timeout := options.Timeout
	if timeout == 0 {
		timeout = defaultHTTPTimeout
	}
	if timeout < 0 {
		return nil, errors.New("RPC timeout must be positive")
	}
	userAgent := strings.TrimSpace(options.UserAgent)
	if userAgent == "" {
		userAgent = defaultUserAgent
	}
	transport := options.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	httpClient := &http.Client{
		Timeout:   timeout,
		Transport: &headerTransport{base: transport, userAgent: userAgent},
	}
	rawClient, err := gethrpc.DialOptions(ctx, endpoint, gethrpc.WithHTTPClient(httpClient))
	if err != nil {
		return nil, classifyError(operationConnect, err)
	}
	return &EthereumClient{client: ethclient.NewClient(rawClient), close: rawClient.Close}, nil
}

// Close는 Ethereum RPC 연결의 유휴 자원을 해제한다.
func (c *EthereumClient) Close() {
	if c != nil && c.close != nil {
		c.close()
	}
}

// ChainID는 연결된 체인이 Base Sepolia인지 확인하고 체인 번호를 반환한다.
func (c *EthereumClient) ChainID(ctx context.Context) (uint64, error) {
	chainID, err := c.client.ChainID(ctx)
	if err != nil {
		return 0, classifyContextError(ctx, operationChainID, err)
	}
	if chainID == nil || chainID.Sign() < 0 || !chainID.IsUint64() {
		return 0, errors.New("RPC returned an invalid chain ID")
	}
	value := chainID.Uint64()
	if value != domain.ChainID {
		return 0, fmt.Errorf("unexpected chain ID %d", value)
	}
	return value, nil
}

// FinalizedBlock은 finalized tag로 조회한 헤더를 변환한다.
func (c *EthereumClient) FinalizedBlock(ctx context.Context) (Block, error) {
	header, err := c.client.HeaderByNumber(ctx, big.NewInt(int64(gethrpc.FinalizedBlockNumber)))
	if err != nil {
		return Block{}, classifyContextError(ctx, operationFinalizedBlock, err)
	}
	return blockFromHeader(header)
}

// TransferLogs는 토큰 주소와 Transfer topic을 정확히 적용해 포함 범위의 로그를 조회한다.
func (c *EthereumClient) TransferLogs(
	ctx context.Context,
	tokenAddress string,
	startBlock, endBlock domain.BlockNumber,
) ([]Log, error) {
	address, err := parseNonzeroAddress(tokenAddress)
	if err != nil {
		return nil, err
	}
	if endBlock < startBlock {
		return nil, fmt.Errorf("invalid block range %s-%s", startBlock, endBlock)
	}
	query := ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(uint64(startBlock)),
		ToBlock:   new(big.Int).SetUint64(uint64(endBlock)),
		Addresses: []common.Address{address},
		Topics:    [][]common.Hash{{common.HexToHash(TransferTopic)}},
	}
	logs, err := c.client.FilterLogs(ctx, query)
	if err != nil {
		return nil, classifyContextError(ctx, operationTransferLogs, err)
	}
	converted := make([]Log, len(logs))
	for i := range logs {
		if logs[i].Address != address || len(logs[i].Topics) != 3 || logs[i].Topics[0] != query.Topics[0][0] || len(logs[i].Data) != 32 {
			return nil, fmt.Errorf("RPC returned malformed Transfer log at index %d", i)
		}
		converted[i], err = logFromEthereum(logs[i])
		if err != nil {
			return nil, fmt.Errorf("RPC returned invalid Transfer log at index %d: %w", i, err)
		}
		if converted[i].BlockNumber < startBlock || converted[i].BlockNumber > endBlock {
			return nil, fmt.Errorf("RPC returned Transfer log outside requested range")
		}
	}
	return converted, nil
}

// BlockByNumber는 지정 번호의 헤더를 조회하고 번호 일치까지 검증한다.
func (c *EthereumClient) BlockByNumber(ctx context.Context, number domain.BlockNumber) (Block, error) {
	header, err := c.client.HeaderByNumber(ctx, new(big.Int).SetUint64(uint64(number)))
	if err != nil {
		return Block{}, classifyContextError(ctx, operationBlockByNumber, err)
	}
	block, err := blockFromHeader(header)
	if err != nil {
		return Block{}, err
	}
	if block.Number != number {
		return Block{}, fmt.Errorf("RPC returned block %s for requested block %s", block.Number, number)
	}
	return block, nil
}

// Receipt는 지정 거래 영수증과 로그를 검증해 변환한다.
func (c *EthereumClient) Receipt(ctx context.Context, txHash string) (Receipt, error) {
	if !domain.ValidHash(txHash) || strings.EqualFold(txHash, common.Hash{}.Hex()) {
		return Receipt{}, errors.New("invalid transaction hash")
	}
	requested := common.HexToHash(txHash)
	receipt, err := c.client.TransactionReceipt(ctx, requested)
	if err != nil {
		return Receipt{}, classifyContextError(ctx, operationReceipt, err)
	}
	if receipt == nil {
		return Receipt{}, fmt.Errorf("%w: receipt", ErrNotFound)
	}
	if receipt.TxHash != requested || receipt.BlockNumber == nil || receipt.BlockNumber.Sign() < 0 || !receipt.BlockNumber.IsUint64() {
		return Receipt{}, errors.New("RPC returned an invalid receipt")
	}
	if receipt.BlockHash == (common.Hash{}) || receipt.TransactionIndex > math.MaxUint32 || receipt.Status > 1 {
		return Receipt{}, errors.New("RPC returned malformed receipt fields")
	}
	result := Receipt{
		TxHash:           strings.ToLower(receipt.TxHash.Hex()),
		BlockNumber:      domain.BlockNumber(receipt.BlockNumber.Uint64()),
		BlockHash:        strings.ToLower(receipt.BlockHash.Hex()),
		TransactionIndex: uint32(receipt.TransactionIndex),
		Status:           receipt.Status,
		Logs:             make([]Log, len(receipt.Logs)),
	}
	for i, source := range receipt.Logs {
		if source == nil {
			return Receipt{}, fmt.Errorf("RPC returned nil receipt log at index %d", i)
		}
		result.Logs[i], err = logFromEthereum(*source)
		if err != nil {
			return Receipt{}, fmt.Errorf("RPC returned invalid receipt log at index %d: %w", i, err)
		}
		if result.Logs[i].TxHash != result.TxHash || result.Logs[i].BlockHash != result.BlockHash ||
			result.Logs[i].BlockNumber != result.BlockNumber || result.Logs[i].TransactionIndex != result.TransactionIndex {
			return Receipt{}, fmt.Errorf("RPC returned inconsistent receipt log at index %d", i)
		}
	}
	return result, nil
}

func newEthereumClient(client ethereumAPI) *EthereumClient {
	return &EthereumClient{client: client}
}

// blockFromHeader validates values before narrowing them into domain fields.
func blockFromHeader(header *types.Header) (Block, error) {
	if header == nil {
		return Block{}, fmt.Errorf("%w: block header", ErrNotFound)
	}
	if header.Number == nil || header.Number.Sign() < 0 || !header.Number.IsUint64() || header.Time > math.MaxInt64 {
		return Block{}, errors.New("RPC returned invalid block fields")
	}
	hash := header.Hash()
	if hash == (common.Hash{}) {
		return Block{}, errors.New("RPC returned an empty block hash")
	}
	return Block{
		Number: domain.BlockNumber(header.Number.Uint64()),
		Hash:   strings.ToLower(hash.Hex()),
		Time:   time.Unix(int64(header.Time), 0).UTC(),
	}, nil
}

// logFromEthereum validates hashes and indices before converting a geth log.
func logFromEthereum(source types.Log) (Log, error) {
	if source.Address == (common.Address{}) || source.BlockHash == (common.Hash{}) || source.TxHash == (common.Hash{}) {
		return Log{}, errors.New("log contains an empty address or hash")
	}
	if source.TxIndex > math.MaxUint32 || source.Index > math.MaxUint32 {
		return Log{}, errors.New("log index exceeds uint32")
	}
	topics := make([]string, len(source.Topics))
	for i := range source.Topics {
		topics[i] = strings.ToLower(source.Topics[i].Hex())
	}
	return Log{
		Address:          strings.ToLower(source.Address.Hex()),
		Topics:           topics,
		Data:             append([]byte(nil), source.Data...),
		BlockNumber:      domain.BlockNumber(source.BlockNumber),
		BlockHash:        strings.ToLower(source.BlockHash.Hex()),
		TxHash:           strings.ToLower(source.TxHash.Hex()),
		TransactionIndex: uint32(source.TxIndex),
		LogIndex:         uint32(source.Index),
		Removed:          source.Removed,
	}, nil
}

func parseNonzeroAddress(value string) (common.Address, error) {
	value = domain.NormalizeAddress(value)
	if !domain.ValidAddress(value) || value == domain.ZeroAddress {
		return common.Address{}, errors.New("invalid token address")
	}
	return common.HexToAddress(value), nil
}

type operation uint8

const (
	operationConnect operation = iota
	operationChainID
	operationFinalizedBlock
	operationTransferLogs
	operationBlockByNumber
	operationReceipt
)

type rpcError interface {
	error
	ErrorCode() int
}

type httpStatusError struct {
	status int
}

func (e *httpStatusError) Error() string { return fmt.Sprintf("RPC HTTP status %d", e.status) }

func classifyContextError(ctx context.Context, operation operation, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	var networkError net.Error
	if errors.As(err, &networkError) && (networkError.Timeout() || networkError.Temporary()) {
		return fmt.Errorf("%w: transport timeout", ErrTemporary)
	}
	return classifyError(operation, err)
}

// classifyError maps only explicitly approved structured failures to retry categories.
func classifyError(operation operation, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	var statusError *httpStatusError
	if errors.As(err, &statusError) {
		switch {
		case operation == operationTransferLogs && statusError.status == http.StatusRequestEntityTooLarge:
			return fmt.Errorf("%w: HTTP 413", ErrRangeLimit)
		case statusError.status == http.StatusTooManyRequests || statusError.status >= 500 && statusError.status <= 599:
			return fmt.Errorf("%w: HTTP status %d", ErrTemporary, statusError.status)
		default:
			return fmt.Errorf("fatal RPC HTTP status %d", statusError.status)
		}
	}
	var protocolError rpcError
	if errors.As(err, &protocolError) {
		if operation == operationTransferLogs && protocolError.ErrorCode() == -32005 {
			return fmt.Errorf("%w: JSON-RPC code -32005", ErrResultLimit)
		}
		return fmt.Errorf("fatal JSON-RPC error code %d", protocolError.ErrorCode())
	}
	var networkError net.Error
	if errors.As(err, &networkError) && (networkError.Timeout() || networkError.Temporary()) {
		return fmt.Errorf("%w: transport timeout", ErrTemporary)
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.ECONNREFUSED) {
		return fmt.Errorf("%w: transient transport failure", ErrTemporary)
	}
	if errors.Is(err, ethereum.NotFound) {
		return fmt.Errorf("%w", ErrNotFound)
	}
	return errors.New("fatal RPC failure")
}

type headerTransport struct {
	base      http.RoundTripper
	userAgent string
}

type limitedResponseBody struct {
	body      io.ReadCloser
	reader    *io.LimitedReader
	limit     int64
	read      int64
	overflow  bool
	closeOnce sync.Once
	closeErr  error
}

func newLimitedResponseBody(body io.ReadCloser, limit int64) *limitedResponseBody {
	return &limitedResponseBody{
		body:   body,
		reader: &io.LimitedReader{R: body, N: limit + 1},
		limit:  limit,
	}
}

// Read returns an explicit fatal sentinel without exposing or silently truncating excess bytes.
func (b *limitedResponseBody) Read(destination []byte) (int, error) {
	if b.overflow {
		return 0, errRPCResponseBodyTooLarge
	}
	n, err := b.reader.Read(destination)
	b.read += int64(n)
	if b.read > b.limit {
		excess := b.read - b.limit
		n -= int(excess)
		b.overflow = true
		return n, errRPCResponseBodyTooLarge
	}
	return n, err
}

// Close closes the underlying HTTP body at most once even if callers repeat cleanup.
func (b *limitedResponseBody) Close() error {
	b.closeOnce.Do(func() {
		b.closeErr = b.body.Close()
	})
	return b.closeErr
}

func limitSuccessfulResponseBody(response *http.Response, limit int64) error {
	if response.Body == nil {
		return errors.New("RPC response has no body")
	}
	if response.ContentLength > limit {
		_ = response.Body.Close()
		return errRPCResponseBodyTooLarge
	}
	response.Body = newLimitedResponseBody(response.Body, limit)
	return nil
}

// RoundTrip sets the fixed User-Agent and converts non-success status codes without exposing response bodies.
func (t *headerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	clone.Header = request.Header.Clone()
	clone.Header.Set("User-Agent", t.userAgent)
	response, err := t.base.RoundTrip(clone)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		_ = response.Body.Close()
		return nil, &httpStatusError{status: response.StatusCode}
	}
	if err := limitSuccessfulResponseBody(response, maxRPCResponseBodySize); err != nil {
		return nil, err
	}
	return response, nil
}
