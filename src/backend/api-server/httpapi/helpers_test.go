package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/repository"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

const (
	fixtureDir = "../testdata/fixtures"
	addrS      = "0x0000000000000000000000000000000000000001"
	addrT      = "0x0000000000000000000000000000000000000007"
)

// fixedNow로 엔진 시계를 멈춰 두면 durationMs가 늘 0이라 응답을 샘플과 글자 그대로 비교할 수 있다.
var fixedNow = time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC)

func loadRepo(t testing.TB) *repository.Memory {
	t.Helper()
	repo, err := repository.LoadFixtureDir(fixtureDir)
	if err != nil {
		t.Fatal(err)
	}
	return repo
}

// testConfig는 setup 이름에 맞는 서버 설정을 만든다(sample-requests.json의 setup).
func testConfig(t testing.TB, setup string) Config {
	cfg := Config{Repo: loadRepo(t), Engine: analyzer.NewWithClock(func() time.Time { return fixedNow })}
	switch setup {
	case "":
	case "slow-clock":
		now := fixedNow
		cfg.Engine = analyzer.NewWithClock(func() time.Time { now = now.Add(100 * time.Millisecond); return now })
	case "rate-limited":
		cfg.RateLimitPerMinute = 1
	case "repo-down":
		cfg.Repo = downRepo{}
	case "labeled":
		cfg.Repo = labeledRepo{loadRepo(t)}
	case "practice":
		cfg.PracticeDatasets = []string{"flow-demo"}
	case "practice-grade":
		answers, err := ParsePracticeAnswers([]byte(practiceAnswersJSON))
		if err != nil {
			t.Fatal(err)
		}
		cfg.PracticeAnswers = answers
	default:
		t.Fatalf("모르는 setup: %s", setup)
	}
	return cfg
}

func newServer(t testing.TB, setup string) http.Handler { return New(testConfig(t, setup)) }

// downRepo는 연결이 끊긴 저장소를 흉내 낸다.
type downRepo struct{}

var errDown = errors.New("connection refused")

func (downRepo) ListDatasets(context.Context) ([]domain.Dataset, error) { return nil, errDown }
func (downRepo) GetDataset(context.Context, string, string) (domain.Dataset, error) {
	return domain.Dataset{}, errDown
}
func (downRepo) ListTransfers(context.Context, repository.TransferQuery) (repository.TransferPage, error) {
	return repository.TransferPage{}, errDown
}

// labeledRepo는 DB에 블록·거래·전송 이름표와 메모, 주소 메모가 들어 있을 때를 흉내 낸다.
// 공개 Fixture와 DB Seed에는 이 값이 없어서, 응답 모양을 보여 주는 샘플에서만 쓴다.
// patterns-demo 블록 20005의 거래 0x…03ed(전송 p5·p6)에 값을 넣고, 전송 메모는 p5에만 넣는다.
// 주소 메모는 patterns-demo의 X(0x…65)에만 넣는다.
type labeledRepo struct{ *repository.Memory }

func (r labeledRepo) GetDataset(ctx context.Context, id, version string) (domain.Dataset, error) {
	ds, err := r.Memory.GetDataset(ctx, id, version)
	if ds.ID == "patterns-demo" {
		ds.AddressNotes = map[string]string{labeledAddress: "주소 메모 예시"}
	}
	return ds, err
}

const (
	labeledBlock    = domain.BlockNumber(20005)
	labeledTx       = "0x00000000000000000000000000000000000000000000000000000000000003ed"
	labeledTransfer = "fx:patterns-demo-v1:p5"
	labeledAddress  = "0x0000000000000000000000000000000000000065"
)

func (r labeledRepo) ListTransfers(ctx context.Context, q repository.TransferQuery) (repository.TransferPage, error) {
	page, err := r.Memory.ListTransfers(ctx, q)
	for i := range page.Transfers {
		t := &page.Transfers[i]
		if t.BlockNumber == labeledBlock {
			t.BlockLabel, t.BlockNote = "예시 블록", "블록 메모 예시"
		}
		if t.TxHash == labeledTx {
			t.TxLabel, t.TxNote = "예시 거래", "거래 메모 예시"
		}
		if t.ID == labeledTransfer {
			t.Note = "전송 메모 예시"
		}
	}
	return page, err
}

func do(h http.Handler, method, path string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return serve(h, req)
}

func serve(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// response는 테스트에서 응답을 읽기 위한 모양이다.
type response struct {
	Data  json.RawMessage `json:"data"`
	Meta  meta            `json:"meta"`
	Error *apiError       `json:"error"`
}

func decode(t testing.TB, rec *httptest.ResponseRecorder) response {
	t.Helper()
	var r response
	if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
		t.Fatalf("응답이 JSON이 아니다: %v\n%s", err, rec.Body.String())
	}
	return r
}

func expectError(t testing.TB, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	r := decode(t, rec)
	if rec.Code != status || r.Error == nil || r.Error.Code != code || string(r.Data) != "null" {
		t.Fatalf("status = %d, body = %s; want %d %s", rec.Code, rec.Body.String(), status, code)
	}
}
