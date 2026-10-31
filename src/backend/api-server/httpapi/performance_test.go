package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/repository"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// 기획안 성능 기준: 전송 1만 건, 3 hop, 노드 200·엣지 500 상한에서 API가 2초 안에 응답한다.
func TestTenThousandTransfersAnswerWithinTwoSeconds(t *testing.T) {
	h := New(Config{Repo: performanceRepo(t), Engine: analyzer.New()})
	from := fmt.Sprintf("0x%040x", 1)
	to := fmt.Sprintf("0x%040x", 200)
	for _, c := range []struct{ path, body string }{
		{"/api/trace", `{"datasetId":"perf","datasetVersion":"seed-42","address":"` + from + `","maxDepth":3}`},
		{"/api/paths", `{"datasetId":"perf","datasetVersion":"seed-42","address":"` + from + `","targetAddress":"` + to + `","maxDepth":3}`},
		{"/api/patterns", `{"datasetId":"perf","datasetVersion":"seed-42","address":"` + from + `"}`},
	} {
		t.Run(c.path, func(t *testing.T) {
			start := time.Now()
			rec := do(h, http.MethodPost, c.path, []byte(c.body))
			elapsed := time.Since(start)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, %s", rec.Code, rec.Body.String())
			}
			if elapsed > 2*time.Second {
				t.Fatalf("2초를 넘었다: %s", elapsed)
			}
			var result analyzer.Result
			if err := json.Unmarshal(decode(t, rec).Data, &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Nodes) > 200 || len(result.Transfers) > 500 || len(result.Paths) > 10 {
				t.Fatalf("상한을 넘었다: nodes=%d edges=%d paths=%d", len(result.Nodes), len(result.Transfers), len(result.Paths))
			}
			t.Logf("%s: %s (%s), found=%d, truncated=%+v", c.path, elapsed, rec.Header().Get("Server-Timing"), result.Limits.Found, result.Limits.Truncated)
		})
	}
}

// performanceRepo는 주소 200개 사이의 전송 1만 건을 시드 42로 만든다. 매번 같은 데이터다.
func performanceRepo(t testing.TB) repository.Repository {
	asset := domain.Asset{ChainID: domain.ChainID, TokenAddress: fmt.Sprintf("0x%040x", 0x1000), Symbol: "SKK", Decimals: 2}
	base := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	const n = 10000
	collectedAt := base.Add(3 * n * time.Second)
	ds := domain.Dataset{
		ID: "perf", Version: "seed-42", SourceMode: domain.SourceFixture, SourceNamespace: "perf-seed-42",
		Status: domain.StatusReady, Asset: asset, StartBlock: 1, EndBlock: n,
		StartTime: base, EndTime: base.Add(2 * n * time.Second), CollectedAt: &collectedAt,
	}
	seed := uint64(42)
	next := func() int {
		seed = seed*6364136223846793005 + 1442695040888963407
		return int((seed>>33)%200) + 1
	}
	rows := make([]domain.Transfer, n)
	for i := range rows {
		from, to := next(), next()
		if from == to {
			to = to%200 + 1
		}
		rows[i] = domain.Transfer{
			ID:           domain.FixtureTransferID(ds.SourceNamespace, fmt.Sprintf("r%05d", i)),
			Asset:        asset,
			TransferType: domain.TransferTypeTransfer,
			TxHash:       fmt.Sprintf("0x%064x", i+1),
			BlockHash:    fmt.Sprintf("0x%064x", i+1),
			BlockNumber:  domain.BlockNumber(i + 1),
			Timestamp:    base.Add(time.Duration(2*i) * time.Second),
			From:         fmt.Sprintf("0x%040x", from),
			To:           fmt.Sprintf("0x%040x", to),
			AmountRaw:    fmt.Sprint(i + 1),
		}
	}
	repo, err := repository.NewMemory(repository.Fixture{Dataset: ds, Transfers: rows})
	if err != nil {
		t.Fatal(err)
	}
	return repo
}
