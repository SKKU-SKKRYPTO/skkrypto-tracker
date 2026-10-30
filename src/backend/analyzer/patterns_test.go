package analyzer

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// spaced는 center를 가운데 둔 전송을 seconds 간격(첫 전송 기준 초)으로 만든다.
func spaced(center string, incoming bool, seconds []int, others []string) Input {
	base := at("12:00:00")
	rows := make([]domain.Transfer, len(seconds))
	for i, s := range seconds {
		from, to := center, others[i]
		if incoming {
			from, to = others[i], center
		}
		rows[i] = transfer(string(rune('a'+i)), uint64(100+i), 0, 0, "12:00:00", from, to, "1")
		rows[i].Timestamp = base.Add(time.Duration(s) * time.Second)
	}
	return Input{Transfers: rows, Coverage: domain.Coverage{StartTime: base.Add(-time.Hour), EndTime: base.Add(time.Hour)}}
}

func TestFanOutInFlowDemo(t *testing.T) {
	out, err := New().Patterns(context.Background(), Request{Address: S}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Patterns) != 1 {
		t.Fatalf("patterns = %+v", out.Patterns)
	}
	p := out.Patterns[0]
	if p.RuleID != PatternFanOut || strings.Join(p.EvidenceIDs, ",") != "e1,e2,e3" || p.Incomplete {
		t.Fatalf("pattern = %+v", p)
	}
	if p.UniqueCounterparties != 3 || p.Asset != testAsset || p.Direction != DirectionOutgoing || p.Threshold != 3 || p.WindowSeconds != 600 {
		t.Fatalf("pattern fields = %+v", p)
	}
	if p.ID != "FAN_OUT:"+S+":outgoing:e1" || p.GroupID != "group:"+p.ID {
		t.Fatalf("id = %s, group = %s", p.ID, p.GroupID)
	}

	// D와 T는 받은 상대가 2개뿐이라 합류 패턴이 아니다.
	for _, center := range []string{D, T} {
		out, err := New().Patterns(context.Background(), Request{Address: center}, flowDemo())
		if err != nil || len(out.Patterns) != 0 {
			t.Fatalf("%s: patterns = %+v, err = %v", center, out.Patterns, err)
		}
	}
}

// 600초 창은 반열린 구간이다: 599초 뒤는 들어가고 600초 뒤는 안 들어간다.
func TestWindowBoundaryIs599Not600(t *testing.T) {
	in := spaced(A, true, []int{0, 200, 599, 600}, []string{B, C, D, E})
	out, err := New().Patterns(context.Background(), Request{Address: A}, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Patterns) != 2 {
		t.Fatalf("patterns = %+v", out.Patterns)
	}
	first, second := out.Patterns[0], out.Patterns[1]
	if strings.Join(first.EvidenceIDs, ",") != "a,b,c" || strings.Join(second.EvidenceIDs, ",") != "b,c,d" {
		t.Fatalf("evidence = %v / %v", first.EvidenceIDs, second.EvidenceIDs)
	}
	// 두 창은 겹치므로 따로 남기되 같은 묶음(groupId)이다.
	if first.RuleID != PatternFanIn || first.GroupID != second.GroupID || first.ID == second.ID {
		t.Fatalf("group = %s / %s", first.GroupID, second.GroupID)
	}
	if out.Summary.UniqueTransferCount != 4 {
		t.Fatalf("summary = %+v", out.Summary)
	}
}

func TestSubsetWindowIsDroppedAndRepeatsCountOnce(t *testing.T) {
	in := spaced(A, false, []int{0, 100, 200, 300}, []string{B, B, C, D})
	out, err := New().Patterns(context.Background(), Request{Address: A}, in)
	if err != nil {
		t.Fatal(err)
	}
	// 두 번째 창(b,c,d)은 첫 창(a,b,c,d)의 부분집합이라 버린다.
	if len(out.Patterns) != 1 || len(out.Patterns[0].EvidenceIDs) != 4 || !reflect.DeepEqual(out.Patterns[0].Counterparties, []string{B, C, D}) {
		t.Fatalf("patterns = %+v", out.Patterns)
	}

	in = spaced(A, false, []int{0, 100, 200, 300}, []string{B, B, C, C})
	out, err = New().Patterns(context.Background(), Request{Address: A}, in)
	if err != nil || len(out.Patterns) != 0 {
		t.Fatalf("같은 상대에게 여러 번 보내도 1개로 센다: %+v %v", out.Patterns, err)
	}
}

func TestPatternNearCoverageEdgeIsIncomplete(t *testing.T) {
	in := spaced(A, false, []int{0, 100, 200}, []string{B, C, D})
	in.Coverage.StartTime = at("11:55:00") // 첫 전송이 범위 시작 5분 뒤 → 그 전 거래를 모른다
	out, err := New().Patterns(context.Background(), Request{Address: A}, in)
	if err != nil || len(out.Patterns) != 1 || !out.Patterns[0].Incomplete {
		t.Fatalf("patterns = %+v, err = %v", out.Patterns, err)
	}

	in = spaced(A, false, []int{0, 100, 200}, []string{B, C, D})
	end := at("12:05:00") // 창 끝(12:10:00)이 시간 필터 끝을 넘는다
	out, err = New().Patterns(context.Background(), Request{Address: A, Filter: Filter{EndTime: &end}}, in)
	if err != nil || len(out.Patterns) != 1 || !out.Patterns[0].Incomplete {
		t.Fatalf("patterns = %+v, err = %v", out.Patterns, err)
	}
}

// 블록 필터나 후보 상한으로 잘린 창은 완전하다고 표시하지 않는다.
// 12:03의 E가 잘려 나갔으니 [12:00, 12:10) 창의 상대는 3개가 아니라 4개일 수 있다.
func TestPatternCutByBlockFilterOrCandidateLimitIsIncomplete(t *testing.T) {
	in := spaced(A, false, []int{0, 60, 120, 180}, []string{B, C, D, E})
	in.Coverage.StartBlock, in.Coverage.EndBlock = 1, 1000
	end := domain.BlockNumber(102)
	for name, req := range map[string]Request{
		"블록 필터": {Address: A, Filter: Filter{EndBlock: &end}},
		"후보 상한": {Address: A, Limits: Limits{MaxCandidates: 3}},
	} {
		t.Run(name, func(t *testing.T) {
			out, err := New().Patterns(context.Background(), req, in)
			if err != nil || len(out.Patterns) != 1 || !out.Patterns[0].Incomplete {
				t.Fatalf("patterns = %+v, err = %v", out.Patterns, err)
			}
		})
	}
	out, err := New().Patterns(context.Background(), Request{Address: A}, in)
	if err != nil || len(out.Patterns) != 1 || out.Patterns[0].Incomplete || out.Patterns[0].UniqueCounterparties != 4 {
		t.Fatalf("자르지 않으면 상대 4개의 완전한 창이다: %+v, err = %v", out.Patterns, err)
	}
}

func TestExcludedTransfersDoNotMakePatterns(t *testing.T) {
	in := spaced(A, false, []int{0, 100, 200, 300}, []string{B, C, domain.ZeroAddress, A})
	in.Transfers[1].AmountRaw = "0"
	out, err := New().Patterns(context.Background(), Request{Address: A}, in)
	if err != nil || len(out.Patterns) != 0 {
		t.Fatalf("0 금액·소각·자기 전송으로 패턴을 만들면 안 된다: %+v %v", out.Patterns, err)
	}
}

func TestPatternsFollowRequestedDirection(t *testing.T) {
	// A가 B·C·D로 보내고(분산) E·T·S에게서 받는다(합류).
	in := spaced(A, false, []int{0, 100, 200}, []string{B, C, D})
	incoming := spaced(A, true, []int{300, 400, 500}, []string{E, T, S})
	in.Transfers = append(in.Transfers, incoming.Transfers...)
	for i := range in.Transfers {
		in.Transfers[i].ID = fmt.Sprintf("t%d", i)
		in.Transfers[i].BlockNumber = domain.BlockNumber(100 + i)
	}

	cases := map[string]string{"": "FAN_OUT,FAN_IN", DirectionOutgoing: "FAN_OUT", DirectionIncoming: "FAN_IN"}
	for direction, want := range cases {
		out, err := New().Patterns(context.Background(), Request{Address: A, Direction: direction}, in)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for _, p := range out.Patterns {
			got = append(got, p.RuleID)
		}
		if strings.Join(got, ",") != want {
			t.Errorf("direction %q: %v, want %s", direction, got, want)
		}
	}
}

// 같은 블록(같은 시각)의 전송은 같은 창에 함께 들어가고, 같은 시각에서 시작하는 창은 하나만 남는다.
func TestSameTimestampTransfersShareWindow(t *testing.T) {
	in := spaced(A, false, []int{0, 0, 0, 0}, []string{B, C, D, E})
	out, err := New().Patterns(context.Background(), Request{Address: A}, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Patterns) != 1 || len(out.Patterns[0].EvidenceIDs) != 4 || out.Patterns[0].UniqueCounterparties != 4 {
		t.Fatalf("patterns = %+v", out.Patterns)
	}
}
