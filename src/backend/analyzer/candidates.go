package analyzer

import (
	"fmt"
	"math/big"
	"slices"
	"sort"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// candidates는 엔진 입력을 분석 후보로 다듬는다. 원본(in.Transfers)은 바꾸지 않는다.
//   - 위치 순서로 정렬하고, 같은 ID는 한 번만 쓴다.
//   - 블록·시간·최소 금액 필터를 적용한다.
//   - 0 금액, 발행·소각(0 주소), 자기 자신에게 보낸 전송은 뺀다. 주소 사이의 돈 이동이 아니기 때문이다.
//   - 모든 전송이 같은 자산(체인·토큰)이어야 한다. 다른 토큰끼리 경로로 잇지 않도록 섞이면 오류로 본다.
//   - 후보가 maxCandidates를 넘으면 앞쪽(이른 위치)만 쓰고 CANDIDATE_LIMIT을 남긴다. 분석은 계속한다.
//     저장소에서 이미 잘려 왔거나 여기서 자르면, 실제로 본 마지막 위치를 analyzedUntil에 남긴다.
func (r *run) candidates(in Input) ([]domain.Transfer, error) {
	if in.CandidatesTruncated {
		r.flagCandidates()
	}
	f := r.req.Filter
	var minimum *big.Int
	if f.MinAmountRaw != "" {
		minimum, _ = domain.ParseAmount(f.MinAmountRaw) // Normalize에서 이미 검사했다
	}

	sorted := slices.Clone(in.Transfers)
	sort.SliceStable(sorted, func(i, j int) bool { return domain.Less(sorted[i], sorted[j]) })

	out := make([]domain.Transfer, 0, min(len(sorted), r.req.Limits.MaxCandidates))
	seen := map[string]bool{}
	for _, t := range sorted {
		if seen[t.ID] {
			continue
		}
		seen[t.ID] = true

		if !t.Asset.Same(sorted[0].Asset) {
			return nil, fmt.Errorf("transfer %s: asset differs from %s", t.ID, sorted[0].ID)
		}
		amount, err := domain.ParseAmount(t.AmountRaw)
		if err != nil {
			return nil, fmt.Errorf("transfer %s: %w", t.ID, err)
		}
		if !domain.ValidAddress(t.From) || !domain.ValidAddress(t.To) {
			return nil, fmt.Errorf("transfer %s: invalid address", t.ID)
		}
		t.From = domain.NormalizeAddress(t.From)
		t.To = domain.NormalizeAddress(t.To)

		switch {
		case f.StartBlock != nil && t.BlockNumber < *f.StartBlock,
			f.EndBlock != nil && t.BlockNumber > *f.EndBlock,
			f.StartTime != nil && t.Timestamp.Before(*f.StartTime),
			f.EndTime != nil && t.Timestamp.After(*f.EndTime):
			continue
		case amount.Sign() == 0,
			t.From == domain.ZeroAddress,
			t.To == domain.ZeroAddress,
			t.From == t.To:
			continue
		case minimum != nil && amount.Cmp(minimum) < 0:
			continue
		}

		if len(out) == r.req.Limits.MaxCandidates {
			r.flagCandidates()
			r.analyzedUntil(out[len(out)-1])
			break
		}
		out = append(out, t)
	}
	if in.CandidatesTruncated && r.status.AnalyzedUntil == nil && len(sorted) > 0 {
		r.analyzedUntil(sorted[len(sorted)-1])
	}
	r.status.CandidatesConsidered = len(out)
	return out, nil
}

// analyzedUntil은 후보가 잘린 위치를 남긴다. 이 전송 뒤로는 분석하지 않았다.
func (r *run) analyzedUntil(last domain.Transfer) {
	r.status.AnalyzedUntil = &AnalyzedUntil{BlockNumber: last.BlockNumber, Timestamp: last.Timestamp.UTC()}
}

// flagCandidates는 후보가 잘렸다고 표시한다. 일부 전송만 보고 계산하므로 found는 "최소 이만큼"이다.
func (r *run) flagCandidates() {
	r.flag(ReasonCandidateLimit)
	r.status.FoundIsLowerBound = true
}
