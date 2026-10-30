// Package analyzer는 담당 2의 분석 엔진이다.
//
// 엔진은 DB·RPC·HTTP를 모른다. API 서버가 넘겨준 전송 목록(Input)만 보고
// 시간순 연결(Trace·Paths)과 분산·합류 패턴(Patterns)을 계산한다.
// 같은 입력이면 몇 번을 돌려도 같은 결과가 나오도록 정렬과 ID 규칙을 고정했다.
package analyzer

import (
	"context"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// RuleVersion은 경로·패턴 판단 규칙의 버전이다. 규칙이 바뀌면 올리고 응답 meta에 싣는다.
const RuleVersion = "flow-v1"

// 분석 종류.
const (
	KindTrace    = "trace"
	KindPaths    = "paths"
	KindPatterns = "patterns"
)

// 탐색 방향.
const (
	DirectionOutgoing = "outgoing" // 시작 주소에서 나간 돈을 시간 순서대로 따라간다
	DirectionIncoming = "incoming" // 시작 주소로 들어온 돈을 시간을 거슬러 따라간다
)

// 결과가 상한에 걸려 잘린 이유(limits.reasons).
const (
	ReasonPathLimit      = "PATH_LIMIT"
	ReasonStateLimit     = "STATE_LIMIT"
	ReasonCandidateLimit = "CANDIDATE_LIMIT"
	ReasonNodeLimit      = "NODE_LIMIT"
	ReasonEdgeLimit      = "EDGE_LIMIT"
	ReasonTimeBudget     = "TIME_BUDGET"
)

// Engine은 API 서버가 부르는 분석 엔진의 약속이다.
// ctx가 취소되면 계산을 멈추고 ctx.Err()를 돌려준다.
type Engine interface {
	Trace(ctx context.Context, req Request, in Input) (Result, error)
	Paths(ctx context.Context, req Request, in Input) (Result, error)
	Patterns(ctx context.Context, req Request, in Input) (Result, error)
}

// Request는 분석 조건이다. 빈 값은 Normalize가 기본값으로 채운다.
type Request struct {
	Address         string `json:"address"`
	TargetAddress   string `json:"targetAddress,omitempty"`   // Paths에서만 쓴다
	StartTransferID string `json:"startTransferId,omitempty"` // 주소 대신 특정 전송에서 시작할 때
	Direction       string `json:"direction,omitempty"`       // Patterns는 비우면 두 방향 모두
	MaxDepth        int    `json:"maxDepth,omitempty"`        // Patterns는 깊이를 쓰지 않는다
	Filter          Filter `json:"filter"`
	Limits          Limits `json:"limits"`
}

// Filter는 분석에 쓸 전송의 범위다. 비우면 데이터셋 범위 전체다.
type Filter struct {
	StartBlock   *domain.BlockNumber `json:"startBlock,omitempty"`
	EndBlock     *domain.BlockNumber `json:"endBlock,omitempty"`
	StartTime    *time.Time          `json:"startTime,omitempty"`
	EndTime      *time.Time          `json:"endTime,omitempty"`
	MinAmountRaw string              `json:"minAmountRaw,omitempty"`
}

// Limits는 한 번의 분석이 쓸 수 있는 상한이다. 0이면 기본값을 쓴다.
type Limits struct {
	MaxNodes      int `json:"maxNodes"`
	MaxEdges      int `json:"maxEdges"`
	MaxPaths      int `json:"maxPaths"`
	MaxStates     int `json:"maxStates"`
	MaxCandidates int `json:"maxCandidates"`
	TimeBudgetMs  int `json:"timeBudgetMs"`
}

// Input은 API 서버가 저장소에서 꺼내 엔진에 넘기는 재료다.
type Input struct {
	Transfers           []domain.Transfer // 한 데이터셋 버전, 한 자산의 전송
	Coverage            domain.Coverage   // 그 데이터셋의 수집 범위
	CandidatesTruncated bool              // 저장소에서 후보가 상한보다 많아 일부만 받았는지
}

// Result는 분석 결과다. API 응답의 data에 그대로 들어간다.
type Result struct {
	Transfers []domain.Transfer `json:"transfers"` // 결과의 근거 전송(중복 없이, 위치 순)
	Nodes     []Node            `json:"nodes"`
	Paths     []Path            `json:"paths"`
	Patterns  []Pattern         `json:"patterns"`
	Summary   Summary           `json:"summary"`
	Limits    LimitStatus       `json:"limits"`
}

// Node는 결과에 나온 주소 하나다. Label은 API 서버가 데이터셋 이름표로 채운다.
type Node struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
}

// Path는 시작 주소와 대상 주소를 잇는 전송들이다. TransferIDs는 방향과 상관없이 돈이 흐른
// 시간순이다(incoming이면 대상 주소에서 시작 주소 쪽으로). 그래서 같은 경로는 어느 방향으로
// 찾아도 같은 ID를 갖는다.
type Path struct {
	ID          string   `json:"id"`
	TransferIDs []string `json:"transferIds"`
	Hops        int      `json:"hops"`
}

// Pattern은 짧은 시간 안에 여러 상대와 주고받은 모양(FAN_OUT·FAN_IN)이다.
type Pattern struct {
	ID                   string       `json:"patternId"` // {ruleId}:{address}:{direction}:{첫 근거 전송 ID}
	RuleID               string       `json:"ruleId"`    // FAN_OUT | FAN_IN
	RuleVersion          string       `json:"ruleVersion"`
	Asset                domain.Asset `json:"asset"`
	Address              string       `json:"address"`
	Direction            string       `json:"direction"`
	WindowStart          time.Time    `json:"windowStart"`
	WindowEnd            time.Time    `json:"windowEnd"`
	WindowSeconds        int          `json:"windowSeconds"`
	Threshold            int          `json:"threshold"`
	UniqueCounterparties int          `json:"uniqueCounterparties"`
	Counterparties       []string     `json:"counterparties"`
	EvidenceIDs          []string     `json:"evidenceIds"`
	GroupID              string       `json:"groupId"`
	Incomplete           bool         `json:"incomplete"`
}

// Summary는 근거 전송을 한 번씩만 센 합계다. 두 경로가 같은 전송을 지나도 두 번 더하지 않는다.
type Summary struct {
	UniqueTransferCount int    `json:"uniqueTransferCount"`
	UniqueAmountRaw     string `json:"uniqueAmountRaw"`
}

// LimitStatus는 결과가 완전한지 알려 준다.
//   - truncated가 null이면 상한에 걸리지 않은 결과다.
//   - foundIsLowerBound가 true면 탐색을 중간에 멈췄거나 후보가 잘려서 found가 "최소 이만큼"이다.
//     경로가 maxPaths보다 많기만 한 경우(PATH_LIMIT)는 끝까지 세므로 found가 정확하다.
//   - analyzedUntil은 후보가 잘렸을 때 실제로 분석한 마지막 전송 위치다. 그 뒤 전송은 보지 않았다.
type LimitStatus struct {
	Truncated            *Truncation    `json:"truncated"`
	Found                int            `json:"found"`
	FoundIsLowerBound    bool           `json:"foundIsLowerBound"`
	StatesVisited        int            `json:"statesVisited"`
	CandidatesConsidered int            `json:"candidatesConsidered"`
	AnalyzedUntil        *AnalyzedUntil `json:"analyzedUntil"`
	DurationMs           int64          `json:"durationMs"`
}

// AnalyzedUntil은 후보 상한(CANDIDATE_LIMIT) 때문에 분석이 멈춘 위치다.
// 화면은 "블록 N까지만 분석했다"고 보여 주고, 더 보려면 범위를 좁혀 다시 요청하게 한다.
type AnalyzedUntil struct {
	BlockNumber domain.BlockNumber `json:"blockNumber"`
	Timestamp   time.Time          `json:"timestamp"`
}

// Truncation은 결과가 잘린 이유다.
type Truncation struct {
	Reason  string   `json:"reason"`  // 대표 사유: 탐색을 멈춘 사유, 멈추지 않았으면 처음 생긴 사유
	Reasons []string `json:"reasons"` // 함께 생긴 사유 전부(예: CANDIDATE_LIMIT와 PATH_LIMIT)
}

// Analyzer는 Engine의 구현이다.
type Analyzer struct {
	now func() time.Time
}

var _ Engine = (*Analyzer)(nil)

// New는 실제 시계를 쓰는 엔진을 만든다.
func New() *Analyzer { return NewWithClock(time.Now) }

// NewWithClock은 시계를 바꿔 끼운 엔진을 만든다. 테스트에서 시간 예산 초과를 재현할 때 쓴다.
func NewWithClock(now func() time.Time) *Analyzer {
	if now == nil {
		now = time.Now
	}
	return &Analyzer{now: now}
}
