package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

func pathsBody(extra string) string {
	return `{"datasetId":"flow-demo","datasetVersion":"v1","address":"` + addrS + `","targetAddress":"` + addrT + `","maxDepth":3` + extra + `}`
}

func traceBody(extra string) string {
	return `{"datasetId":"flow-demo","datasetVersion":"v1","address":"` + addrS + `","maxDepth":3` + extra + `}`
}

func TestAnalysisRejectsBadInput(t *testing.T) {
	h := newServer(t, "")
	cases := map[string]string{
		"잘못된 주소":          `{"datasetId":"flow-demo","datasetVersion":"v1","address":"0x123","targetAddress":"` + addrT + `"}`,
		"모르는 항목":          pathsBody(`,"maxdepth":2`),
		"null":            pathsBody(`,"filter":null`),
		"JSON 두 개":        pathsBody(``) + `{}`,
		"배열":              `[` + pathsBody(``) + `]`,
		"숫자 블록 번호":        pathsBody(`,"filter":{"startBlock":18204211}`),
		"버전 없음":           `{"datasetId":"flow-demo","address":"` + addrS + `","targetAddress":"` + addrT + `"}`,
		"깊이 4":            pathsBody(`,"maxDepth":4`),
		"상한 초과":           pathsBody(`,"limits":{"maxNodes":1000}`),
		"자산 토큰 없음":        pathsBody(`,"asset":{"chainId":84532}`),
		"모드와 다른 시작 전송 ID": pathsBody(`,"startTransferId":"84532:0x01:0"`),
		"64KB 넘는 본문":      pathsBody(`,"startTransferId":"` + strings.Repeat("x", 70<<10) + `"`),
		"같은 항목 두 번":       pathsBody(`,"maxDepth":1`),
		"안쪽 항목 두 번":       pathsBody(`,"filter":{"minAmountRaw":"1","minAmountRaw":"2"}`),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			expectError(t, do(h, http.MethodPost, "/api/paths", []byte(body)), http.StatusBadRequest, "INVALID_INPUT")
		})
	}
}

func TestNodesGetDatasetLabels(t *testing.T) {
	rec := do(newServer(t, ""), http.MethodPost, "/api/paths", []byte(pathsBody("")))
	var result analyzer.Result
	if err := json.Unmarshal(decode(t, rec).Data, &result); err != nil {
		t.Fatal(err)
	}
	var labels []string
	for _, n := range result.Nodes {
		labels = append(labels, n.Label)
	}
	if got := strings.Join(labels, ","); got != "S,A,B,D,T" {
		t.Fatalf("labels = %s", got)
	}
}

func TestCandidateOverflowIsReported(t *testing.T) {
	rec := do(newServer(t, ""), http.MethodPost, "/api/trace", []byte(traceBody(`,"limits":{"maxCandidates":2}`)))
	r := decode(t, rec)
	if rec.Code != http.StatusOK || r.Meta.Limits.Truncated == nil || !slices.Contains(r.Meta.Limits.Truncated.Reasons, analyzer.ReasonCandidateLimit) || !r.Meta.Limits.FoundIsLowerBound {
		t.Fatalf("status = %d, limits = %+v", rec.Code, r.Meta.Limits)
	}
	if r.Meta.Limits.AnalyzedUntil == nil {
		t.Fatal("후보가 잘리면 실제로 분석한 마지막 위치(analyzedUntil)를 알려 줘야 한다")
	}
}

// 패턴에 경로 전용 항목을 보내면 조용히 버리지 않고 400으로 알려 준다.
func TestPatternsRejectPathOnlyFields(t *testing.T) {
	h := newServer(t, "")
	base := `{"datasetId":"patterns-demo","datasetVersion":"v1","address":"` + addrS + `"`
	for _, extra := range []string{`,"maxDepth":2`, `,"targetAddress":"` + addrT + `"`, `,"startTransferId":"fx:patterns-demo:p1"`} {
		expectError(t, do(h, http.MethodPost, "/api/patterns", []byte(base+extra+`}`)), http.StatusBadRequest, "INVALID_INPUT")
	}
}

// 추적도 대상 주소를 쓰지 않으니, 보내면 조용히 버리지 않고 400으로 알려 준다.
func TestTraceRejectsTargetAddress(t *testing.T) {
	expectError(t, do(newServer(t, ""), http.MethodPost, "/api/trace", []byte(pathsBody(""))), http.StatusBadRequest, "INVALID_INPUT")
}

// invalidating은 분석하는 동안 데이터셋이 무효화되는 상황을 만든다.
type invalidating struct {
	analyzer.Engine
	invalidate func()
}

func (e invalidating) Trace(ctx context.Context, req analyzer.Request, in analyzer.Input) (analyzer.Result, error) {
	e.invalidate()
	return e.Engine.Trace(ctx, req, in)
}

func TestDatasetInvalidatedDuringAnalysisReturns409(t *testing.T) {
	cfg := testConfig(t, "")
	repo := loadRepo(t)
	cfg.Repo = repo
	cfg.Engine = invalidating{Engine: analyzer.New(), invalidate: func() {
		_ = repo.SetStatus("flow-demo", "v1", domain.StatusInvalidated)
	}}
	rec := do(New(cfg), http.MethodPost, "/api/trace", []byte(traceBody("")))
	expectError(t, rec, http.StatusConflict, "DATASET_INVALIDATED")
}

func TestRateLimitSetsRetryAfter(t *testing.T) {
	h := newServer(t, "rate-limited")
	if rec := do(h, http.MethodGet, "/api/datasets", nil); rec.Code != http.StatusOK {
		t.Fatalf("첫 요청 = %d", rec.Code)
	}
	rec := do(h, http.MethodGet, "/api/datasets", nil)
	expectError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
	if rec.Header().Get("Retry-After") == "" || !decode(t, rec).Error.Retryable {
		t.Fatal("Retry-After 헤더와 retryable=true가 필요하다")
	}
	if rec := do(h, http.MethodGet, "/healthz", nil); rec.Code != http.StatusOK {
		t.Fatal("상태 확인(/healthz)은 요청 제한에 걸리지 않는다")
	}
}

// stuck은 취소될 때까지 끝나지 않는 엔진이다.
type stuck struct{ analyzer.Engine }

func (stuck) Paths(ctx context.Context, _ analyzer.Request, _ analyzer.Input) (analyzer.Result, error) {
	<-ctx.Done()
	return analyzer.Result{}, ctx.Err()
}

func TestTimeoutReturns503Retryable(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.Engine = stuck{}
	cfg.RequestTimeout = 50 * time.Millisecond
	rec := do(New(cfg), http.MethodPost, "/api/paths", []byte(pathsBody("")))
	expectError(t, rec, http.StatusServiceUnavailable, "REQUEST_TIMEOUT")
	if !decode(t, rec).Error.Retryable {
		t.Fatal("시간 초과는 다시 시도할 수 있다")
	}
}

func TestAnalysisReportsServerTiming(t *testing.T) {
	rec := do(newServer(t, ""), http.MethodPost, "/api/paths", []byte(pathsBody("")))
	if got := rec.Header().Get("Server-Timing"); !strings.HasPrefix(got, "repo;dur=") || !strings.Contains(got, "engine;dur=") {
		t.Fatalf("Server-Timing = %q", got)
	}
}
