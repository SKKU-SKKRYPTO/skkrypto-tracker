package analyzer

import (
	"context"
	"testing"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

func TestCandidatesSkipTransfersThatAreNotMovements(t *testing.T) {
	in := Input{Transfers: []domain.Transfer{
		transfer("ok", 10, 0, 0, "12:00:00", S, A, "5"),
		transfer("zero", 11, 0, 0, "12:00:01", S, B, "0"),
		transfer("mint", 12, 0, 0, "12:00:02", domain.ZeroAddress, S, "5"),
		transfer("burn", 13, 0, 0, "12:00:03", S, domain.ZeroAddress, "5"),
		transfer("self", 14, 0, 0, "12:00:04", S, S, "5"),
	}}
	out, err := New().Trace(context.Background(), Request{Address: S, MaxDepth: 1}, in)
	if err != nil {
		t.Fatal(err)
	}
	if got := transferIDs(out.Transfers); got != "ok" {
		t.Fatalf("transfers = %s, want ok", got)
	}
	if out.Limits.CandidatesConsidered != 1 {
		t.Fatalf("candidatesConsidered = %d", out.Limits.CandidatesConsidered)
	}
}

func TestCandidatesApplyFilterAndDropDuplicates(t *testing.T) {
	in := flowDemo()
	in.Transfers = append(in.Transfers, in.Transfers[0]) // 같은 ID가 두 번 와도 한 번만 쓴다
	from, to := domain.BlockNumber(18204511), domain.BlockNumber(18204566)
	req := Request{Address: S, MaxDepth: 1, Filter: Filter{StartBlock: &from, EndBlock: &to, MinAmountRaw: "200000"}}

	out, err := New().Trace(context.Background(), req, in)
	if err != nil {
		t.Fatal(err)
	}
	if got := transferIDs(out.Transfers); got != "e2" {
		t.Fatalf("transfers = %s, want e2", got)
	}
}

func TestCandidateLimitKeepsEarliestAndMarksLowerBound(t *testing.T) {
	req := Request{Address: S, MaxDepth: 1, Limits: Limits{MaxCandidates: 2}}
	out, err := New().Trace(context.Background(), req, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if got := transferIDs(out.Transfers); got != "e1,e2" {
		t.Fatalf("transfers = %s", got)
	}
	if out.Limits.Truncated == nil || out.Limits.Truncated.Reason != ReasonCandidateLimit || !out.Limits.FoundIsLowerBound {
		t.Fatalf("limits = %+v", out.Limits)
	}
	// 실제로 본 마지막 후보(e2)의 위치를 알려 준다.
	if u := out.Limits.AnalyzedUntil; u == nil || u.BlockNumber != 18204566 || !u.Timestamp.Equal(at("12:01:54")) {
		t.Fatalf("analyzedUntil = %+v", u)
	}
}

// 저장소에서 이미 잘려 온 후보면, 받은 것 중 마지막 위치까지 분석했다고 알려 준다.
func TestTruncatedInputReportsAnalyzedUntil(t *testing.T) {
	in := flowDemo()
	in.CandidatesTruncated = true
	out, err := New().Trace(context.Background(), Request{Address: S}, in)
	if err != nil {
		t.Fatal(err)
	}
	if u := out.Limits.AnalyzedUntil; u == nil || u.BlockNumber != 18206300 || !out.Limits.FoundIsLowerBound {
		t.Fatalf("limits = %+v", out.Limits)
	}
	full, _ := New().Trace(context.Background(), Request{Address: S}, flowDemo())
	if full.Limits.AnalyzedUntil != nil {
		t.Fatalf("잘리지 않았으면 analyzedUntil은 null이다: %+v", full.Limits.AnalyzedUntil)
	}
}

// 기획안: 다른 토큰 전송끼리 경로로 잇지 않는다. 섞여 들어오면 저장소 쪽 실수이므로 오류다.
func TestMixedAssetsAreRejected(t *testing.T) {
	in := flowDemo()
	in.Transfers[3].Asset.TokenAddress = addr(0x2000)
	if _, err := New().Trace(context.Background(), Request{Address: S}, in); err == nil {
		t.Fatal("다른 토큰이 섞이면 오류여야 한다")
	}
}

func TestInputIsNotModified(t *testing.T) {
	in := flowDemo()
	in.Transfers[0].From = "0x00000000000000000000000000000000000000AA"
	before := transferIDs(in.Transfers)
	if _, err := New().Trace(context.Background(), Request{Address: S, MaxDepth: 1}, in); err != nil {
		t.Fatal(err)
	}
	if transferIDs(in.Transfers) != before || in.Transfers[0].From != "0x00000000000000000000000000000000000000AA" {
		t.Fatal("엔진이 입력 슬라이스를 바꾸면 안 된다")
	}
}
