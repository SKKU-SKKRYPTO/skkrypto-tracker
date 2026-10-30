package analyzer

import (
	"context"
	"slices"
	"sort"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// 패턴 규칙(flow-v1).
const (
	PatternFanOut = "FAN_OUT" // 한 주소가 짧은 시간에 여러 주소로 보냄(분산)
	PatternFanIn  = "FAN_IN"  // 여러 주소가 짧은 시간에 한 주소로 보냄(합류)

	// PatternWindow는 패턴을 보는 시간 창이다. [첫 전송 시각, 첫 전송 시각 + 600초) 반열린 구간이라
	// 599초 뒤 전송은 들어가고 600초 뒤 전송은 들어가지 않는다.
	PatternWindow = 600 * time.Second
	// PatternThreshold는 창 안에 있어야 하는 서로 다른 상대 주소의 최소 개수다.
	PatternThreshold = 3
)

// Patterns는 시작 주소를 가운데에 둔 분산(FAN_OUT)·합류(FAN_IN) 패턴을 찾는다.
// 패턴은 "규칙에 맞는 모양"이라는 뜻일 뿐, 주인이 같다거나 불법이라는 판단이 아니다.
func (a *Analyzer) Patterns(ctx context.Context, req Request, in Input) (Result, error) {
	r, candidates, err := a.begin(ctx, KindPatterns, req, in)
	if err != nil {
		return Result{}, err
	}
	start, end := r.observed(in.Coverage, candidates)
	for _, rule := range []struct{ kind, direction string }{
		{PatternFanOut, DirectionOutgoing},
		{PatternFanIn, DirectionIncoming},
	} {
		if r.req.Direction != "" && r.req.Direction != rule.direction {
			continue
		}
		if err := r.findPatterns(candidates, rule.kind, rule.direction, start, end); err != nil {
			return Result{}, err
		}
		if r.stopped {
			break
		}
	}
	sort.SliceStable(r.patterns, func(i, j int) bool {
		a, b := r.patterns[i], r.patterns[j]
		if !a.WindowStart.Equal(b.WindowStart) {
			return a.WindowStart.Before(b.WindowStart)
		}
		if a.RuleID != b.RuleID {
			return a.RuleID < b.RuleID
		}
		return a.ID < b.ID
	})
	return r.result(len(r.patterns), nil), nil
}

// window는 패턴 하나와, 그 근거가 rows의 어디부터 어디까지인지([first, end))다.
type window struct {
	first, end int
	pattern    Pattern
}

// findPatterns는 한 규칙(FAN_OUT 또는 FAN_IN)의 창을 두 포인터로 훑는다.
//   - 전송마다 그 시각에서 시작하는 600초 창을 만든다.
//   - 창의 오른쪽 끝이 앞 창과 같으면 앞 창의 부분집합이라 버린다.
//   - 서로 다른 상대 주소가 3개 이상이면 패턴이다. 같은 상대에게 여러 번 보내도 1개로 센다.
//   - 시각은 block.timestamp(초) 기준이라 같은 블록의 전송은 같은 창에 함께 들어간다.
//   - 겹치는 창은 합치지 않고 같은 groupId로 묶는다.
//   - 창이 관측 범위 시작 600초 안에서 시작하거나 범위 끝을 넘으면 incomplete다.
//     범위 밖 거래는 "없음"이 아니라 "모름"이기 때문이다.
func (r *run) findPatterns(candidates []domain.Transfer, kind, direction string, observedStart, observedEnd time.Time) error {
	var rows []domain.Transfer
	for _, t := range candidates {
		if (kind == PatternFanOut && t.From == r.req.Address) || (kind == PatternFanIn && t.To == r.req.Address) {
			rows = append(rows, t)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Timestamp.Before(rows[j].Timestamp) })

	var windows []window
	end, lastEnd := 0, -1
	for first := range rows {
		ok, err := r.nextState()
		if err != nil {
			return err
		}
		if !ok {
			break
		}
		windowStart := rows[first].Timestamp.UTC()
		windowEnd := windowStart.Add(PatternWindow)
		for end < len(rows) && rows[end].Timestamp.Before(windowEnd) {
			end++
		}
		if end == lastEnd {
			continue
		}
		lastEnd = end

		evidence := slices.Clone(rows[first:end])
		others := counterparties(evidence, kind)
		if len(others) < PatternThreshold {
			continue
		}
		if !r.addEvidence(evidence...) {
			break
		}
		sort.Slice(evidence, func(i, j int) bool { return domain.Less(evidence[i], evidence[j]) })
		ids := make([]string, len(evidence))
		for i, t := range evidence {
			ids[i] = t.ID
		}
		windows = append(windows, window{first: first, end: end, pattern: Pattern{
			ID:                   kind + ":" + r.req.Address + ":" + direction + ":" + ids[0],
			RuleID:               kind,
			RuleVersion:          RuleVersion,
			Asset:                evidence[0].Asset,
			Address:              r.req.Address,
			Direction:            direction,
			WindowStart:          windowStart,
			WindowEnd:            windowEnd,
			WindowSeconds:        int(PatternWindow / time.Second),
			Threshold:            PatternThreshold,
			UniqueCounterparties: len(others),
			Counterparties:       others,
			EvidenceIDs:          ids,
			Incomplete:           windowStart.Before(observedStart.Add(PatternWindow)) || windowEnd.After(observedEnd),
		}})
	}

	for i := 0; i < len(windows); {
		j, groupEnd := i+1, windows[i].end
		for j < len(windows) && windows[j].first < groupEnd {
			groupEnd = max(groupEnd, windows[j].end)
			j++
		}
		group := "group:" + windows[i].pattern.ID
		for k := i; k < j; k++ {
			windows[k].pattern.GroupID = group
			r.patterns = append(r.patterns, windows[k].pattern)
		}
		i = j
	}
	return nil
}

// counterparties는 근거 전송의 상대 주소를 중복 없이 정렬해 돌려준다.
func counterparties(evidence []domain.Transfer, kind string) []string {
	seen := map[string]bool{}
	for _, t := range evidence {
		if kind == PatternFanOut {
			seen[t.To] = true
		} else {
			seen[t.From] = true
		}
	}
	out := make([]string, 0, len(seen))
	for address := range seen {
		out = append(out, address)
	}
	sort.Strings(out)
	return out
}

// observed는 실제로 관측한 시간 범위다: 데이터셋 수집 범위와 요청 시간 필터가 겹치는 부분.
// 수집 범위를 모르면(0 값) 끝을 알 수 없으므로 모든 창이 incomplete가 된다.
//
// 블록 필터나 후보 상한으로 범위가 줄면 그 경계 블록의 시각을 정확히 모른다. 그때는 실제로 본
// 첫·마지막 후보의 시각까지만 관측했다고 본다. 범위를 좁게 잡을수록 incomplete가 늘어날 뿐,
// 잘린 창을 완전하다고 잘못 표시하지는 않는다.
func (r *run) observed(c domain.Coverage, candidates []domain.Transfer) (start, end time.Time) {
	f := r.req.Filter
	start, end = c.StartTime, c.EndTime
	if f.StartTime != nil && f.StartTime.After(start) {
		start = *f.StartTime
	}
	if f.EndTime != nil && (end.IsZero() || f.EndTime.Before(end)) {
		end = *f.EndTime
	}
	if len(candidates) == 0 {
		return start, end
	}
	if f.StartBlock != nil && *f.StartBlock > c.StartBlock {
		if first := candidates[0].Timestamp; first.After(start) {
			start = first
		}
	}
	last := candidates[len(candidates)-1].Timestamp
	if r.status.AnalyzedUntil != nil {
		last = r.status.AnalyzedUntil.Timestamp
	}
	if (f.EndBlock != nil && (c.EndBlock == 0 || *f.EndBlock < c.EndBlock)) || r.status.AnalyzedUntil != nil {
		if end.IsZero() || last.Before(end) {
			end = last
		}
	}
	return start, end
}
