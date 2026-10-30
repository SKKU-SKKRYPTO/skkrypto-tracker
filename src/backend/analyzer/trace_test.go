package analyzer

import (
	"context"
	"testing"
)

func TestTraceOneHop(t *testing.T) {
	out, err := New().Trace(context.Background(), Request{Address: S, MaxDepth: 1}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if got := transferIDs(out.Transfers); got != "e1,e2,e3" {
		t.Fatalf("transfers = %s", got)
	}
	if len(out.Nodes) != 4 || out.Limits.Found != 3 || out.Limits.Truncated != nil {
		t.Fatalf("nodes = %v, limits = %+v", out.Nodes, out.Limits)
	}
	if out.Summary.UniqueTransferCount != 3 || out.Summary.UniqueAmountRaw != "460000" {
		t.Fatalf("summary = %+v", out.Summary)
	}
}

func TestTraceIncomingOneHop(t *testing.T) {
	req := Request{Address: D, Direction: DirectionIncoming, MaxDepth: 1}
	out, err := New().Trace(context.Background(), req, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if got := transferIDs(out.Transfers); got != "e4,e5" {
		t.Fatalf("transfers = %s", got)
	}
}

func TestTraceEmptyResultIsNotAnError(t *testing.T) {
	out, err := New().Trace(context.Background(), Request{Address: T, MaxDepth: 1}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Transfers) != 0 || len(out.Nodes) != 0 || out.Summary.UniqueAmountRaw != "0" || out.Limits.Truncated != nil {
		t.Fatalf("빈 결과는 빈 배열과 0으로 채워야 한다: %+v", out)
	}
}

func TestTraceStopsAtEdgeLimit(t *testing.T) {
	out, err := New().Trace(context.Background(), Request{Address: S, MaxDepth: 1, Limits: Limits{MaxEdges: 2}}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	if got := transferIDs(out.Transfers); got != "e1,e2" {
		t.Fatalf("transfers = %s", got)
	}
	if !onlyReason(out.Limits, ReasonEdgeLimit) || !out.Limits.FoundIsLowerBound {
		t.Fatalf("limits = %+v", out.Limits)
	}
}

func TestTraceFollowsTimeOrder(t *testing.T) {
	out, err := New().Trace(context.Background(), Request{Address: S, MaxDepth: 3}, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	// e8(E→T)은 e7(C→E)보다 먼저 일어났으므로 S에서 시간순으로 닿을 수 없다.
	if got := transferIDs(out.Transfers); got != "e1,e2,e3,e4,e5,e6,e7" {
		t.Fatalf("transfers = %s", got)
	}
}

func TestTraceFromSelectedTransfer(t *testing.T) {
	req := Request{Address: S, StartTransferID: "e2", MaxDepth: 2}
	out, err := New().Trace(context.Background(), req, flowDemo())
	if err != nil {
		t.Fatal(err)
	}
	// 선택한 전송(e2)이 1 hop이라 2 hop까지 가면 e5에서 멈춘다.
	if got := transferIDs(out.Transfers); got != "e2,e5" {
		t.Fatalf("transfers = %s", got)
	}

	req.StartTransferID = "e4" // A→D라서 S에서 시작하는 전송이 아니다
	if _, err := New().Trace(context.Background(), req, flowDemo()); err == nil {
		t.Fatal("시작 주소와 맞지 않는 전송은 오류여야 한다")
	}
}
