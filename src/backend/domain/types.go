// Package domain은 수집(담당 1)·분석 엔진(담당 2)·API 서버(담당 3)가 함께 쓰는 공통 타입이다.
//
// 기획안 공통 개발 기준대로 전송·자산·위치·금액만 둔다.
// 분석 조건·결과는 analyzer, HTTP 응답 모양은 api-server 패키지에 둔다.
package domain

import (
	"strings"
	"time"
)

// ChainID는 이번 프로젝트가 다루는 Base Sepolia의 체인 번호다.
const ChainID uint64 = 84532

// 데이터셋 출처(sourceMode).
const (
	SourceFixture  = "FIXTURE"  // 사람이 만든 합성 데이터
	SourceSnapshot = "SNAPSHOT" // 체인에서 수집한 고정 범위 데이터
)

// 데이터셋 상태(status). 분석은 READY일 때만 한다.
const (
	StatusReady       = "READY"
	StatusCollecting  = "COLLECTING"
	StatusFailed      = "FAILED"
	StatusInvalidated = "INVALIDATED"
)

// 전송 유형(transferType). 발행·소각은 원본에는 남기지만 분석 후보에서는 뺀다.
const (
	TransferTypeTransfer = "TRANSFER"
	TransferTypeMint     = "MINT" // from이 0 주소
	TransferTypeBurn     = "BURN" // to가 0 주소
)

// Asset은 분석 대상 토큰이다. 같은 자산인지는 chainId와 tokenAddress로만 판단한다.
type Asset struct {
	ChainID      uint64 `json:"chainId"`
	TokenAddress string `json:"tokenAddress"`
	Symbol       string `json:"symbol"`
	Decimals     int    `json:"decimals"`
}

// Same은 체인 번호와 토큰 주소가 같은지 본다. 기호·소수 자릿수는 표시용이라 비교하지 않는다.
func (a Asset) Same(b Asset) bool {
	return a.ChainID == b.ChainID && strings.EqualFold(a.TokenAddress, b.TokenAddress)
}

// Coverage는 데이터셋이 수집한 고정 범위다. 이 범위 밖의 거래는 "없음"이 아니라 "모름"이다.
type Coverage struct {
	StartBlock BlockNumber `json:"startBlock"`
	EndBlock   BlockNumber `json:"endBlock"`
	StartTime  time.Time   `json:"startTime"`
	EndTime    time.Time   `json:"endTime"`
}

// Dataset은 datasetId + datasetVersion으로 구분되는 수집 결과 한 벌이다.
// 한 번 READY가 된 버전은 내용이 바뀌지 않는다. 고칠 일이 생기면 새 버전을 만든다.
type Dataset struct {
	ID                 string            `json:"datasetId"`
	Version            string            `json:"datasetVersion"`
	SourceMode         string            `json:"sourceMode"`
	SourceNamespace    string            `json:"sourceNamespace"`
	Status             string            `json:"status"`
	Asset              Asset             `json:"asset"`
	StartBlock         BlockNumber       `json:"startBlock"`
	EndBlock           BlockNumber       `json:"endBlock"`
	StartTime          time.Time         `json:"startTime"`
	EndTime            time.Time         `json:"endTime"`
	FinalizedBlock     BlockNumber       `json:"finalizedBlock"`
	CollectedAt        time.Time         `json:"collectedAt"`
	BoundaryHashes     map[string]string `json:"boundaryHashes"` // 블록 번호 → 블록 해시
	Labels             map[string]string `json:"labels"`         // 주소(소문자) → 화면 표시용 이름
	Notes              []string          `json:"notes"`
	InvalidationReason string            `json:"invalidationReason,omitempty"`
}

// Coverage는 데이터셋의 수집 범위를 돌려준다.
func (d Dataset) Coverage() Coverage {
	return Coverage{StartBlock: d.StartBlock, EndBlock: d.EndBlock, StartTime: d.StartTime.UTC(), EndTime: d.EndTime.UTC()}
}

// Transfer는 ERC-20 Transfer 로그 하나다.
// ID는 그래프·표·상세·JSON 내보내기에서 모두 같은 값을 쓴다(id.go 참고).
type Transfer struct {
	ID               string      `json:"id"`
	Label            string      `json:"label,omitempty"` // Fixture에서만 쓰는 짧은 이름(e1, p3 등)
	Asset            Asset       `json:"asset"`
	TransferType     string      `json:"transferType"`
	TxHash           string      `json:"txHash"`
	BlockHash        string      `json:"blockHash"`
	BlockNumber      BlockNumber `json:"blockNumber"`
	TransactionIndex uint32      `json:"transactionIndex"`
	LogIndex         uint32      `json:"logIndex"`
	Timestamp        time.Time   `json:"timestamp"`
	From             string      `json:"from"`
	To               string      `json:"to"`
	AmountRaw        string      `json:"amountRaw"` // uint256 십진 문자열. decimals를 적용하지 않은 원래 값
}

// Position은 전송의 체인 위치를 돌려준다.
func (t Transfer) Position() Position {
	return Position{BlockNumber: t.BlockNumber, TransactionIndex: t.TransactionIndex, LogIndex: t.LogIndex}
}
