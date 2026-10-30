package analyzer

import (
	"context"
	"math/big"
	"slices"
	"sort"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// run은 분석 한 번의 작업 상태다. 상한을 세고, 결과에 넣을 전송과 주소를 모은다.
type run struct {
	ctx       context.Context
	now       func() time.Time
	req       Request
	start     time.Time
	deadline  time.Time
	status    LimitStatus
	edges     map[string]domain.Transfer // 결과에 넣은 전송(ID마다 한 번)
	nodes     map[string]bool            // 결과에 넣은 주소
	found     [][]domain.Transfer        // Paths가 결과에 넣은 경로(최대 maxPaths개)
	pathCount int                        // 찾은 경로 수(결과에 못 넣은 것까지)
	patterns  []Pattern
	stopped   bool // 상한에 걸려서 더 찾지 않는다
}

// begin은 조건을 확인하고 분석 후보를 준비한다.
func (a *Analyzer) begin(ctx context.Context, kind string, req Request, in Input) (*run, []domain.Transfer, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	req, err := Normalize(kind, req)
	if err != nil {
		return nil, nil, err
	}
	start := a.now()
	r := &run{
		ctx:      ctx,
		now:      a.now,
		req:      req,
		start:    start,
		deadline: start.Add(time.Duration(req.Limits.TimeBudgetMs) * time.Millisecond),
		edges:    map[string]domain.Transfer{},
		nodes:    map[string]bool{},
	}
	candidates, err := r.candidates(in)
	if err != nil {
		return nil, nil, err
	}
	return r, candidates, r.check()
}

// flag는 잘림 사유를 남긴다. 탐색은 계속한다.
func (r *run) flag(reason string) {
	t := r.status.Truncated
	if t == nil {
		r.status.Truncated = &Truncation{Reason: reason, Reasons: []string{reason}}
		return
	}
	if !slices.Contains(t.Reasons, reason) {
		t.Reasons = append(t.Reasons, reason)
	}
}

// truncate는 잘림 사유를 남기고 탐색을 멈춘다. 멈춘 사유가 대표 사유가 되고,
// 끝까지 찾지 못했으므로 found는 "최소 이만큼"이 된다.
func (r *run) truncate(reason string) {
	r.flag(reason)
	r.status.Truncated.Reason = reason
	r.status.FoundIsLowerBound = true
	r.stopped = true
}

// check는 취소와 시간 예산을 본다. 예산을 다 쓰면 그때까지 찾은 것만 돌려주도록 멈춘다.
func (r *run) check() error {
	if err := r.ctx.Err(); err != nil {
		return err
	}
	if !r.stopped && !r.now().Before(r.deadline) {
		r.truncate(ReasonTimeBudget)
	}
	return nil
}

// nextState는 탐색 상태를 하나 꺼낼 때마다 부른다. false면 더 탐색하지 않는다.
func (r *run) nextState() (bool, error) {
	if err := r.check(); err != nil {
		return false, err
	}
	if r.stopped {
		return false, nil
	}
	if r.status.StatesVisited >= r.req.Limits.MaxStates {
		r.truncate(ReasonStateLimit)
		return false, nil
	}
	r.status.StatesVisited++
	return true, nil
}

// addEvidence는 경로·패턴 하나의 근거 전송을 한꺼번에 결과에 넣는다.
// 노드·엣지 상한을 넘으면 하나도 넣지 않고 탐색을 멈춘다. 그래서 결과의 경로는 늘 근거 전송을 모두 갖는다.
func (r *run) addEvidence(ts ...domain.Transfer) bool {
	if reason := r.evidenceOverflow(ts...); reason != "" {
		r.truncate(reason)
		return false
	}
	r.putEvidence(ts...)
	return true
}

// evidenceOverflow는 근거 전송을 더했을 때 넘치는 상한의 사유를 돌려준다. 넘치지 않으면 빈 문자열이다.
func (r *run) evidenceOverflow(ts ...domain.Transfer) string {
	newEdges := 0
	newNodes := map[string]bool{}
	for _, t := range ts {
		if _, ok := r.edges[t.ID]; !ok {
			newEdges++
		}
		for _, address := range []string{t.From, t.To} {
			if !r.nodes[address] {
				newNodes[address] = true
			}
		}
	}
	switch {
	case len(r.edges)+newEdges > r.req.Limits.MaxEdges:
		return ReasonEdgeLimit
	case len(r.nodes)+len(newNodes) > r.req.Limits.MaxNodes:
		return ReasonNodeLimit
	}
	return ""
}

// putEvidence는 근거 전송과 그 주소를 결과에 넣는다.
func (r *run) putEvidence(ts ...domain.Transfer) {
	for _, t := range ts {
		r.edges[t.ID] = t
		r.nodes[t.From] = true
		r.nodes[t.To] = true
	}
}

// result는 모은 전송·주소를 정렬해 결과로 만든다.
func (r *run) result(found int, paths []Path) Result {
	out := Result{
		Transfers: make([]domain.Transfer, 0, len(r.edges)),
		Nodes:     make([]Node, 0, len(r.nodes)),
		Paths:     paths,
		Patterns:  r.patterns,
	}
	if out.Paths == nil {
		out.Paths = []Path{}
	}
	if out.Patterns == nil {
		out.Patterns = []Pattern{}
	}
	sum := new(big.Int)
	for _, t := range r.edges {
		out.Transfers = append(out.Transfers, t)
		amount, _ := domain.ParseAmount(t.AmountRaw) // candidates에서 이미 검사했다
		sum.Add(sum, amount)
	}
	sort.Slice(out.Transfers, func(i, j int) bool { return domain.Less(out.Transfers[i], out.Transfers[j]) })
	for address := range r.nodes {
		out.Nodes = append(out.Nodes, Node{ID: address})
	}
	sort.Slice(out.Nodes, func(i, j int) bool { return out.Nodes[i].ID < out.Nodes[j].ID })
	out.Summary = Summary{UniqueTransferCount: len(out.Transfers), UniqueAmountRaw: sum.String()}

	r.status.Found = found
	r.status.DurationMs = max(0, r.now().Sub(r.start).Milliseconds())
	out.Limits = r.status
	return out
}
