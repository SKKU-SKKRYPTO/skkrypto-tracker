package repository

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

const fixtureDir = "../testdata/fixtures"

func load(t *testing.T) *Memory {
	t.Helper()
	m, err := LoadFixtureDir(fixtureDir)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func ids(page TransferPage) string {
	out := make([]string, len(page.Transfers))
	for i, t := range page.Transfers {
		out[i] = t.Label
	}
	return strings.Join(out, ",")
}

func TestLoadFixtures(t *testing.T) {
	m := load(t)
	rows, err := m.ListDatasets(context.Background())
	if err != nil || len(rows) != 4 {
		t.Fatalf("datasets = %d, err = %v", len(rows), err)
	}
	ds, err := m.GetDataset(context.Background(), "flow-demo", "v1")
	if err != nil || ds.Version != "v1" || ds.Status != domain.StatusReady {
		t.Fatalf("dataset = %+v, err = %v", ds, err)
	}
	for _, version := range []string{"v9", ""} {
		if _, err := m.GetDataset(context.Background(), "flow-demo", version); !errors.Is(err, ErrNotFound) {
			t.Fatalf("version %q: err = %v", version, err)
		}
	}
}

func TestListTransfersInPositionOrder(t *testing.T) {
	page, err := load(t).ListTransfers(context.Background(), TransferQuery{DatasetID: "flow-demo", DatasetVersion: "v1", Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	// e8은 e7보다 위치(블록)가 앞이다.
	if got := ids(page); got != "e1,e2,e3,e4,e5,e8,e6,e7" || page.HasMore {
		t.Fatalf("transfers = %s, hasMore = %v", got, page.HasMore)
	}
}

func TestListTransfersByAddressAndDirection(t *testing.T) {
	m := load(t)
	d := "0x0000000000000000000000000000000000000005"
	cases := map[string]string{"": "e4,e5,e6", DirectionIncoming: "e4,e5", DirectionOutgoing: "e6"}
	for direction, want := range cases {
		page, err := m.ListTransfers(context.Background(), TransferQuery{DatasetID: "flow-demo", DatasetVersion: "v1", Address: d, Direction: direction, Limit: 100})
		if err != nil || ids(page) != want {
			t.Errorf("direction %q: %s, %v", direction, ids(page), err)
		}
	}
}

func TestListTransfersPagesWithCursor(t *testing.T) {
	m := load(t)
	q := TransferQuery{DatasetID: "flow-demo", DatasetVersion: "v1", Limit: 3}
	var all []string
	for {
		page, err := m.ListTransfers(context.Background(), q)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, ids(page))
		if !page.HasMore {
			break
		}
		last := page.Transfers[len(page.Transfers)-1]
		q.After = &Cursor{Position: last.Position(), ID: last.ID}
	}
	if got := strings.Join(all, "|"); got != "e1,e2,e3|e4,e5,e8|e6,e7" {
		t.Fatalf("pages = %s", got)
	}
}

func TestListTransfersByTxAndAmount(t *testing.T) {
	m := load(t)
	tx := "0x00000000000000000000000000000000000000000000000000000000000003ed"
	page, err := m.ListTransfers(context.Background(), TransferQuery{DatasetID: "patterns-demo", DatasetVersion: "v1", TxHash: tx, Limit: 10})
	if err != nil || ids(page) != "p5,p6" {
		t.Fatalf("tx = %s, %v", ids(page), err)
	}
	page, err = m.ListTransfers(context.Background(), TransferQuery{DatasetID: "patterns-demo", DatasetVersion: "v1", MinAmountRaw: "300", Limit: 10})
	if err != nil || ids(page) != "p3,p4,p7" {
		t.Fatalf("min amount = %s, %v", ids(page), err)
	}
}

func TestRejectsBrokenFixture(t *testing.T) {
	base, err := LoadFixtureDir(fixtureDir)
	if err != nil {
		t.Fatal(err)
	}
	ds, _ := base.GetDataset(context.Background(), "flow-demo", "v1")
	page, _ := base.ListTransfers(context.Background(), TransferQuery{DatasetID: "flow-demo", DatasetVersion: "v1", Limit: 1})
	good := page.Transfers[0]

	broken := map[string]func(*domain.Transfer){
		"ID 형식":   func(t *domain.Transfer) { t.ID = "84532:0x1:0" },
		"다른 자산":   func(t *domain.Transfer) { t.Asset.TokenAddress = "0x0000000000000000000000000000000000002000" },
		"금액 형식":   func(t *domain.Transfer) { t.AmountRaw = "1.5" },
		"범위 밖 블록": func(t *domain.Transfer) { t.BlockNumber = 1 },
		"전송 유형":   func(t *domain.Transfer) { t.TransferType = domain.TransferTypeMint },
	}
	for name, breakIt := range broken {
		t.Run(name, func(t *testing.T) {
			bad := good
			breakIt(&bad)
			if _, err := NewMemory(Fixture{Dataset: ds, Transfers: []domain.Transfer{bad}}); err == nil {
				t.Fatal("형식이 틀린 Fixture를 받아들이면 안 된다")
			}
		})
	}
}

func TestReturnedDatasetIsACopy(t *testing.T) {
	m := load(t)
	ds, _ := m.GetDataset(context.Background(), "flow-demo", "v1")
	ds.Labels["0x0000000000000000000000000000000000000001"] = "changed"
	collectedAt := *ds.CollectedAt
	*ds.CollectedAt = collectedAt.Add(time.Hour)
	again, _ := m.GetDataset(context.Background(), "flow-demo", "v1")
	if again.Labels["0x0000000000000000000000000000000000000001"] != "S" {
		t.Fatal("저장소 안의 값이 바뀌면 안 된다")
	}
	if !again.CollectedAt.Equal(collectedAt) {
		t.Fatal("저장소 안의 collectedAt이 바뀌면 안 된다")
	}
}
