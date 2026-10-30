package analyzer

import (
	"fmt"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// 깊이 기본값과 최댓값. 기획안 기준으로 1~3 hop만 본다.
const (
	DefaultMaxDepth = 2
	MaxDepth        = 3
)

// RequestError는 분석 조건이 잘못됐을 때 돌려준다.
// Message는 화면에 그대로 보여 줘도 되는 문장이다. API 서버는 이 오류를 400으로 바꾼다.
type RequestError struct {
	Message string
}

func (e *RequestError) Error() string { return e.Message }

func invalid(format string, args ...any) error {
	return &RequestError{Message: fmt.Sprintf(format, args...)}
}

// Normalize는 빈 값을 기본값으로 채우고 잘못된 조건을 걸러 낸다.
// API 서버도 이 함수를 불러서, 응답 meta.conditions에 실제로 쓴 조건을 보여 준다.
func Normalize(kind string, req Request) (Request, error) {
	if kind != KindTrace && kind != KindPaths && kind != KindPatterns {
		return req, invalid("지원하지 않는 분석 종류입니다: %s", kind)
	}
	if !domain.ValidAddress(req.Address) {
		return req, invalid("시작 주소(address)는 0x로 시작하는 16진수 40자리여야 합니다.")
	}
	req.Address = domain.NormalizeAddress(req.Address)

	if kind == KindPatterns {
		// 패턴은 대상·시작 전송·깊이를 쓰지 않는다. 보내면 무시하지 않고 알려 준다(조용히 버리면
		// 사용자는 그 조건이 적용됐다고 착각한다). 방향을 주면 그 방향의 규칙만, 비우면 두 규칙을 모두 본다.
		if req.TargetAddress != "" || req.StartTransferID != "" || req.MaxDepth != 0 {
			return req, invalid("패턴 분석은 targetAddress·startTransferId·maxDepth를 쓰지 않습니다. 빼고 보내 주세요.")
		}
		if req.Direction != "" && req.Direction != DirectionOutgoing && req.Direction != DirectionIncoming {
			return req, invalid("방향(direction)은 outgoing 또는 incoming이어야 합니다.")
		}
	} else if err := normalizeWalk(kind, &req); err != nil {
		return req, err
	}

	f := req.Filter
	if f.StartBlock != nil && f.EndBlock != nil && *f.StartBlock > *f.EndBlock {
		return req, invalid("블록 범위의 시작이 끝보다 큽니다.")
	}
	if f.StartTime != nil && f.EndTime != nil && f.StartTime.After(*f.EndTime) {
		return req, invalid("시간 범위의 시작이 끝보다 늦습니다.")
	}
	if f.MinAmountRaw != "" {
		if _, err := domain.ParseAmount(f.MinAmountRaw); err != nil {
			return req, invalid("최소 금액(minAmountRaw)은 uint256 범위의 십진 문자열이어야 합니다.")
		}
	}

	limits, err := normalizeLimits(req.Limits)
	if err != nil {
		return req, err
	}
	req.Limits = limits
	return req, nil
}

// normalizeWalk는 Trace·Paths가 쓰는 대상·방향·깊이를 확인한다.
func normalizeWalk(kind string, req *Request) error {
	// 추적은 대상 주소를 쓰지 않는다. 받아서 조건에만 남기면 그 조건이 적용됐다고 착각하므로 알려 준다.
	if kind == KindTrace && req.TargetAddress != "" {
		return invalid("추적(trace)은 targetAddress를 쓰지 않습니다. 두 주소 사이 경로는 paths로 찾아 주세요.")
	}
	if req.TargetAddress != "" && !domain.ValidAddress(req.TargetAddress) {
		return invalid("대상 주소(targetAddress)는 0x로 시작하는 16진수 40자리여야 합니다.")
	}
	req.TargetAddress = domain.NormalizeAddress(req.TargetAddress)
	if kind == KindPaths && req.TargetAddress == "" {
		return invalid("경로 찾기에는 대상 주소(targetAddress)가 필요합니다.")
	}
	if kind == KindPaths && req.TargetAddress == req.Address {
		return invalid("시작 주소와 대상 주소가 같습니다.")
	}

	if req.Direction == "" {
		req.Direction = DirectionOutgoing
	}
	if req.Direction != DirectionOutgoing && req.Direction != DirectionIncoming {
		return invalid("방향(direction)은 outgoing 또는 incoming이어야 합니다.")
	}
	if req.MaxDepth == 0 {
		req.MaxDepth = DefaultMaxDepth
	}
	if req.MaxDepth < 1 || req.MaxDepth > MaxDepth {
		return invalid("최대 hop(maxDepth)은 1~%d이어야 합니다.", MaxDepth)
	}
	return nil
}

// normalizeLimits는 상한을 채운다. 기본값과 최댓값은 기획안 성능 기준
// (전송 1만 건, 3 hop, 노드 200·엣지 500, 2초 안 응답)에 맞췄다.
func normalizeLimits(l Limits) (Limits, error) {
	fields := []struct {
		name     string
		value    *int
		def, max int
	}{
		{"maxNodes", &l.MaxNodes, 200, 200},
		{"maxEdges", &l.MaxEdges, 500, 500},
		{"maxPaths", &l.MaxPaths, 10, 10},
		{"maxStates", &l.MaxStates, 10000, 10000},
		{"maxCandidates", &l.MaxCandidates, 10000, 10000},
		{"timeBudgetMs", &l.TimeBudgetMs, 1500, 2000},
	}
	for _, f := range fields {
		if *f.value == 0 {
			*f.value = f.def
		}
		if *f.value < 1 || *f.value > f.max {
			return l, invalid("limits.%s 값은 1~%d 사이여야 합니다.", f.name, f.max)
		}
	}
	return l, nil
}
