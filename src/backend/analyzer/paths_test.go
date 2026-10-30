package analyzer

import (
	"context"
	"reflect"
	"testing"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// 회의록 예시 1: A→B→C 작은 그래프에서 예상 경로가 나오는지.
func TestPathsFindsABC(t *testing.T) {
	in := Input{Transfers: []domain.Transfer{
		transfer("ab", 10, 0, 0, "12:00:00", A, B, "100"),
		transfer("bc", 11, 0, 0, "12:00:02", B, C, "100"),
	}}
	out, err := New().Paths(context.Background(), Request{Address: A, TargetAddress: C}, in)
	if err != nil {
		t.Fatal(err)
	}
	if got := pathIDs(out); !reflect.DeepEqual(got, []string{"ab>bc"}) {
		t.Fatalf("paths = %v", got)
	}
	if out.Paths[0].Hops != 2 || out.Limits.Found != 1 {
		t.Fatalf("path = %+v, limits = %+v", out.Paths[0], out.Limits)
	}
}

// 회의록 예시 2: A→B→A처럼 돌아오는 돈이 있어도 무한 반복하지 않는지.
func TestCycleDoesNotLoopForever(t *testing.T) {
	in := Input{Transfers: []domain.Transfer{
		transfer("ab1", 10, 0, 0, "12:00:00", A, B, "100"),
		transfer("ba", 11, 0, 0, "12:00:02", B, A, "100"),
		transfer("ab2", 12, 0, 0, "12:00:04", A, B, "100"),
		transfer("bc", 13, 0, 0, "12:00:06", B, C, "100"),
	}}
	out, err := New().Trace(context.Background(), Request{Address: A, MaxDepth: 3}, in)
	if err != nil {
		t.Fatal(err)
	}
	// B→A는 A로 되돌아가는 전송이라 경로에 넣지 않는다.
	if got := transferIDs(out.Transfers); got != "ab1,ab2,bc" {
		t.Fatalf("transfers = %s", got)
	}
	if out.Limits.StatesVisited > 10 {
		t.Fatalf("탐색 상태가 너무 많다: %d", out.Limits.StatesVisited)
	}

	paths, err := New().Paths(context.Background(), Request{Address: A, TargetAddress: C, MaxDepth: 3}, in)
	if err != nil {
		t.Fatal(err)
	}
	if got := pathIDs(paths); !reflect.DeepEqual(got, []string{"ab1>bc", "ab2>bc"}) {
		t.Fatalf("paths = %v", got)
	}
}

func TestPathsShareEvidenceWithoutDoubleCounting(t *testing.T) {
	out, err := New().Paths(context.Background(), Request{Address: S, TargetAddress: T, MaxDepth: 3}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if got := pathIDs(out); !reflect.DeepEqual(got, []string{"e1>e4>e6", "e2>e5>e6"}) {
		t.Fatalf("paths = %v", got)
	}
	// e6을 두 경로가 함께 쓰지만 합계에는 한 번만 들어간다.
	if out.Summary.UniqueTransferCount != 5 || out.Summary.UniqueAmountRaw != "1093000" {
		t.Fatalf("summary = %+v", out.Summary)
	}
	if out.Paths[0].ID == out.Paths[1].ID {
		t.Fatal("경로 ID가 겹치면 안 된다")
	}
}

func TestPathsNeedEnoughDepth(t *testing.T) {
	out, err := New().Paths(context.Background(), Request{Address: S, TargetAddress: T, MaxDepth: 2}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Paths) != 0 || out.Limits.Truncated != nil {
		t.Fatalf("2 hop으로는 S에서 T에 닿지 않는다: %v %+v", pathIDs(out), out.Limits)
	}
}

// incoming으로 거꾸로 찾아도 경로는 돈이 흐른 순서로 나오고, outgoing으로 찾은 같은 경로와 ID가 같다.
func TestPathsIncomingFromSelectedTransfer(t *testing.T) {
	req := Request{Address: T, TargetAddress: S, StartTransferID: "e6", Direction: DirectionIncoming, MaxDepth: 3}
	in, err := New().Paths(context.Background(), req, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if got := pathIDs(in); !reflect.DeepEqual(got, []string{"e1>e4>e6", "e2>e5>e6"}) {
		t.Fatalf("paths = %v", got)
	}
	out, err := New().Paths(context.Background(), Request{Address: S, TargetAddress: T, MaxDepth: 3}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(in.Paths, out.Paths) {
		t.Fatalf("incoming = %+v, outgoing = %+v", in.Paths, out.Paths)
	}
}

func TestSamePositionIsNotAHop(t *testing.T) {
	in := Input{Transfers: []domain.Transfer{
		transfer("ab", 10, 1, 0, "12:00:00", A, B, "100"),
		transfer("bc", 10, 1, 1, "12:00:00", B, C, "100"), // 같은 거래 안, 로그 순서가 뒤
	}}
	out, err := New().Paths(context.Background(), Request{Address: A, TargetAddress: C}, in)
	if err != nil || len(out.Paths) != 1 {
		t.Fatalf("같은 거래 안에서도 로그 순서가 뒤면 이어진다: %v %v", pathIDs(out), err)
	}

	in.Transfers[1].LogIndex = 0 // 위치가 완전히 같으면 앞뒤를 알 수 없다
	out, err = New().Paths(context.Background(), Request{Address: A, TargetAddress: C}, in)
	if err != nil || len(out.Paths) != 0 {
		t.Fatalf("위치가 같은 두 전송은 잇지 않는다: %v %v", pathIDs(out), err)
	}
}
