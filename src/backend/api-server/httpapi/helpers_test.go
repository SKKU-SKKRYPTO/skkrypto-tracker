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
