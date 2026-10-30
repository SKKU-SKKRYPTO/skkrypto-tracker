package analyzer

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"sort"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

func TestEveryLimitReason(t *testing.T) {
	cases := []struct {
		reason     string
		paths      bool
		limits     Limits
		lowerBound bool // 탐색을 멈췄거나 후보가 잘렸으면 found는 최소값이다
	}{
		{ReasonPathLimit, true, Limits{MaxPaths: 1}, false},
		{ReasonStateLimit, true, Limits{MaxStates: 2}, true},
		{ReasonCandidateLimit, true, Limits{MaxCandidates: 2}, true},
		{ReasonNodeLimit, false, Limits{MaxNodes: 2}, true},
		{ReasonEdgeLimit, false, Limits{MaxEdges: 1}, true},
	}
	for _, c := range cases {
		t.Run(c.reason, func(t *testing.T) {
			req := Request{Address: S, MaxDepth: 3, Limits: c.limits}
			var out Result
			var err error
			if c.paths {
				req.TargetAddress = T // 추적은 대상 주소를 받지 않는다
				out, err = New().Paths(context.Background(), req, flowDemo())
			} else {
				out, err = New().Trace(context.Background(), req, flowDemo())
			}
			if err != nil {
				t.Fatal(err)
			}
			if !onlyReason(out.Limits, c.reason) || out.Limits.FoundIsLowerBound != c.lowerBound {
				t.Fatalf("limits = %+v, truncated = %+v", out.Limits, out.Limits.Truncated)
			}
		})
	}
}

// 기획안: 상태 상한에 걸려도 같은 hop의 짧은 경로는 먼저 남는다.
// 큐가 차도 이미 들어간 B를 처리해서 2 hop 경로 S→B→T를 찾는다. 3 hop을 허용해도 결과가 줄지 않는다.
func TestStateLimitKeepsShortPathsOfSameHop(t *testing.T) {
	in := Input{Transfers: []domain.Transfer{
		transfer("sa", 10, 0, 0, "12:00:00", S, A, "100"),
		transfer("sb", 11, 0, 0, "12:00:02", S, B, "100"),
		transfer("ac", 20, 0, 0, "12:00:04", A, C, "100"),
		transfer("bt", 21, 0, 0, "12:00:06", B, T, "100"),
	}}
	for _, depth := range []int{2, 3} {
		req := Request{Address: S, TargetAddress: T, MaxDepth: depth, Limits: Limits{MaxStates: 3}}
		out, err := New().Paths(context.Background(), req, in)
		if err != nil {
			t.Fatal(err)
		}
		if got := pathIDs(out); !reflect.DeepEqual(got, []string{"sb>bt"}) {
			t.Fatalf("maxDepth %d: paths = %v, limits = %+v", depth, got, out.Limits)
		}
	}
}

// 기획안: 경로가 10개를 넘으면 정렬 순서의 상위 10개를 돌려준다. 개수(found)는 끝까지 센다.
func TestPathLimitReturnsTopPathsAndExactCount(t *testing.T) {
	out, err := New().Paths(context.Background(), Request{Address: S, TargetAddress: T, MaxDepth: 3, Limits: Limits{MaxPaths: 1}}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if got := pathIDs(out); !reflect.DeepEqual(got, []string{"e1>e4>e6"}) || out.Limits.Found != 2 || out.Limits.FoundIsLowerBound {
		t.Fatalf("paths = %v, limits = %+v", got, out.Limits)
	}
	// 결과에 넣은 경로의 근거 전송만 들어 있다.
	if got := transferIDs(out.Transfers); got != "e1,e4,e6" {
		t.Fatalf("transfers = %s", got)
	}
}

// 경로가 12개인 데이터에서 상위 10개가 매번 같은 순서로 나오는지.
func TestTopTenPathsAreFixed(t *testing.T) {
	var rows []domain.Transfer
	for i := 0; i < 12; i++ {
		middle := addr(100 + i)
		rows = append(rows,
			transfer(fmt.Sprintf("a%02d", i), uint64(10+i), 0, 0, "12:00:00", A, middle, "1"),
			transfer(fmt.Sprintf("b%02d", i), uint64(100+i), 0, 0, "12:10:00", middle, B, "1"),
		)
	}
	// 입력 순서를 뒤집어도 결과 순서는 같아야 한다.
	reversed := slices.Clone(rows)
	slices.Reverse(reversed)

	first, err := New().Paths(context.Background(), Request{Address: A, TargetAddress: B}, Input{Transfers: rows})
	if err != nil {
		t.Fatal(err)
	}
	second, err := New().Paths(context.Background(), Request{Address: A, TargetAddress: B}, Input{Transfers: reversed})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(pathIDs(first), pathIDs(second)) {
		t.Fatalf("순서가 다르다:\n%v\n%v", pathIDs(first), pathIDs(second))
	}
	if len(first.Paths) != 10 || first.Paths[0].TransferIDs[0] != "a00" || first.Paths[9].TransferIDs[0] != "a09" {
		t.Fatalf("paths = %v", pathIDs(first))
	}
	if first.Limits.Found != 12 || !onlyReason(first.Limits, ReasonPathLimit) || first.Limits.FoundIsLowerBound {
		t.Fatalf("limits = %+v", first.Limits)
	}
}

// 이슈 #13: incoming은 대상 쪽부터 거꾸로 찾아서 찾는 순서가 정렬 순서와 다르다.
// A→X @10→T @40, A→Y @20→T @30에서 maxPaths=1이면 두 방향 모두 첫 전송이 이른 A→X→T가 남아야 한다.
func TestIncomingPathLimitKeepsSortedTopPaths(t *testing.T) {
	X, Y := B, C
	in := Input{Transfers: []domain.Transfer{
		transfer("ax", 10, 0, 0, "12:00:10", A, X, "1"),
		transfer("ay", 20, 0, 0, "12:00:20", A, Y, "1"),
		transfer("yt", 30, 0, 0, "12:00:30", Y, T, "1"),
		transfer("xt", 40, 0, 0, "12:00:40", X, T, "1"),
	}}
	reqs := map[string]Request{
		"outgoing": {Address: A, TargetAddress: T, Limits: Limits{MaxPaths: 1}},
		"incoming": {Address: T, TargetAddress: A, Direction: DirectionIncoming, Limits: Limits{MaxPaths: 1}},
	}
	for name, req := range reqs {
		out, err := New().Paths(context.Background(), req, in)
		if err != nil {
			t.Fatal(err)
		}
		if got := pathIDs(out); !reflect.DeepEqual(got, []string{"ax>xt"}) || out.Limits.Found != 2 || !onlyReason(out.Limits, ReasonPathLimit) {
			t.Fatalf("%s: paths = %v, limits = %+v", name, got, out.Limits)
		}
		// 밀려난 경로(ay>yt)의 전송은 결과에 남지 않는다.
		if got := transferIDs(out.Transfers); got != "ax,xt" {
			t.Fatalf("%s: transfers = %s", name, got)
		}
	}
}

// 작은 무작위 데이터의 모든 (시작, 대상) 쌍에서 결과가 '가능한 경로를 전부 나열해 정렬한 앞 maxPaths개'와 같은지 본다.
// outgoing과 incoming 모두 같아야 하고, found와 근거 전송도 맞아야 한다.
func TestPathsMatchSortedAllPaths(t *testing.T) {
	const addresses = 6
	for seed := uint64(1); seed <= 40; seed++ {
		in := randomInput(20, addresses, seed)
		for a := 1; a <= addresses; a++ {
			for b := 1; b <= addresses; b++ {
				if a == b {
					continue
				}
				all := allPaths(in.Transfers, addr(a), addr(b), 3)
				for _, maxPaths := range []int{1, 2, 10} {
					top := all[:min(maxPaths, len(all))]
					want := make([]Path, len(top))
					for i, p := range top {
						want[i] = newPath(p)
					}
					reqs := map[string]Request{
						"outgoing": {Address: addr(a), TargetAddress: addr(b), MaxDepth: 3, Limits: Limits{MaxPaths: maxPaths}},
						"incoming": {Address: addr(b), TargetAddress: addr(a), Direction: DirectionIncoming, MaxDepth: 3, Limits: Limits{MaxPaths: maxPaths}},
					}
					for name, req := range reqs {
						out, err := New().Paths(context.Background(), req, in)
						if err != nil {
							t.Fatal(err)
						}
						if !reflect.DeepEqual(out.Paths, want) || out.Limits.Found != len(all) || transferIDs(out.Transfers) != transferIDs(evidenceOf(top)) {
							t.Fatalf("seed %d, %s, maxPaths %d: paths = %v, found = %d, 전부 나열한 경로 %d개 중 앞부분 = %v",
								seed, name, maxPaths, pathIDs(out), out.Limits.Found, len(all), pathIDs(Result{Paths: want}))
						}
					}
				}
			}
		}
	}
}

// allPaths는 엔진과 따로, 같은 규칙(시간 엄격 증가·같은 주소 다시 지나지 않기·대상에 닿으면 멈춤·maxDepth)으로
// 시작→대상 경로를 깊이 우선으로 전부 나열하고 정렬 순서대로 돌려준다.
func allPaths(transfers []domain.Transfer, start, target string, maxDepth int) [][]domain.Transfer {
	var all [][]domain.Transfer
	visited := map[string]bool{start: true}
	var walk func(at string, path []domain.Transfer)
	walk = func(at string, path []domain.Transfer) {
		if len(path) == maxDepth {
			return
		}
		for _, t := range transfers {
			if t.From != at || visited[t.To] {
				continue
			}
			if len(path) > 0 && domain.ComparePosition(t.Position(), path[len(path)-1].Position()) <= 0 {
				continue
			}
			next := append(slices.Clone(path), t)
			if t.To == target {
				all = append(all, next)
				continue
			}
			visited[t.To] = true
			walk(t.To, next)
			delete(visited, t.To)
		}
	}
	walk(start, nil)
	sort.Slice(all, func(i, j int) bool { return lessPath(all[i], all[j]) })
	return all
}

// evidenceOf는 경로들의 전송을 한 번씩 위치 순으로 모은다.
func evidenceOf(paths [][]domain.Transfer) []domain.Transfer {
	seen := map[string]bool{}
	var out []domain.Transfer
	for _, p := range paths {
		for _, t := range p {
			if !seen[t.ID] {
				seen[t.ID] = true
				out = append(out, t)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return domain.Less(out[i], out[j]) })
	return out
}

func TestTimeBudgetReturnsPartialResult(t *testing.T) {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	tick := func() time.Time { now = now.Add(100 * time.Millisecond); return now }
	out, err := NewWithClock(tick).Paths(context.Background(), Request{Address: S, TargetAddress: T, MaxDepth: 3}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if !onlyReason(out.Limits, ReasonTimeBudget) || !out.Limits.FoundIsLowerBound {
		t.Fatalf("limits = %+v", out.Limits)
	}
}

func TestCancelStopsAnalysis(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := New().Paths(ctx, Request{Address: S, TargetAddress: T}, flowDemo())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
}

func TestInvalidRequests(t *testing.T) {
	cases := map[string]Request{
		"잘못된 주소":   {Address: "0x123"},
		"방향":       {Address: S, Direction: "sideways"},
		"깊이":       {Address: S, MaxDepth: 4},
		"상한":       {Address: S, Limits: Limits{MaxNodes: 201}},
		"뒤집힌 시간":   {Address: S, Filter: Filter{StartTime: ptr(at("13:00:00")), EndTime: ptr(at("12:00:00"))}},
		"소수점 금액":   {Address: S, Filter: Filter{MinAmountRaw: "1.5"}},
		"대상 주소 없음": {Address: S},
	}
	t.Run("추적에 대상 주소", func(t *testing.T) {
		var reqErr *RequestError
		if _, err := New().Trace(context.Background(), Request{Address: S, TargetAddress: T}, flowDemo()); !errors.As(err, &reqErr) {
			t.Fatalf("err = %v", err)
		}
	})
	for name, req := range map[string]Request{
		"패턴에 대상 주소": {Address: S, TargetAddress: T},
		"패턴에 깊이":    {Address: S, MaxDepth: 2},
	} {
		t.Run(name, func(t *testing.T) {
			var reqErr *RequestError
			if _, err := New().Patterns(context.Background(), req, flowDemo()); !errors.As(err, &reqErr) {
				t.Fatalf("err = %v", err)
			}
		})
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			var reqErr *RequestError
			_, err := New().Paths(context.Background(), req, flowDemo())
			if !errors.As(err, &reqErr) {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

// 기획안 성능 기준: 전송 1만 건, 주소 200개, 3 hop에서도 상한 안에서 끝나야 한다.
func TestTenThousandTransfersStayWithinLimits(t *testing.T) {
	in := randomInput(10000, 200, 42)
	start := time.Now()
	out, err := New().Paths(context.Background(), Request{Address: addr(1), TargetAddress: addr(200), MaxDepth: 3}, in)
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("2초를 넘었다: %s", elapsed)
	}
	if len(out.Nodes) > 200 || len(out.Transfers) > 500 || len(out.Paths) > 10 || out.Limits.StatesVisited > 10000 {
		t.Fatalf("상한을 넘었다: nodes=%d edges=%d paths=%d %+v", len(out.Nodes), len(out.Transfers), len(out.Paths), out.Limits)
	}
	if out.Limits.FoundIsLowerBound && out.Limits.Truncated == nil {
		t.Fatalf("멈춘 결과에는 잘림 사유가 있어야 한다: %+v", out.Limits)
	}
}

// randomInput은 시드를 고정한 난수로 같은 데이터를 매번 똑같이 만든다.
func randomInput(n, addresses int, seed uint64) Input {
	next := func() int {
		seed = seed*6364136223846793005 + 1442695040888963407
		return int((seed>>33)%uint64(addresses)) + 1
	}
	base := at("12:00:00")
	rows := make([]domain.Transfer, n)
	for i := range rows {
		from, to := next(), next()
		if from == to {
			to = to%addresses + 1
		}
		rows[i] = transfer(fmt.Sprintf("r%05d", i), uint64(i+1), 0, 0, "12:00:00", addr(from), addr(to), fmt.Sprint(i+1))
		rows[i].Timestamp = base.Add(time.Duration(i) * 2 * time.Second)
	}
	return Input{Transfers: rows}
}
