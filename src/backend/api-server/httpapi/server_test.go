package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/repository"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

const flowQuery = "/api/transfers?datasetId=flow-demo&datasetVersion=v1"

// 회의록 예시: 잘못된 주소 형식을 보내면 에러를 돌려주는지.
func TestInvalidAddressReturns400(t *testing.T) {
	h := newServer(t, "")
	expectError(t, do(h, http.MethodGet, flowQuery+"&address=0x123", nil), http.StatusBadRequest, "INVALID_INPUT")
	expectError(t, do(h, http.MethodGet, flowQuery+"&address=0x000000000000000000000000000000000000000g", nil), http.StatusBadRequest, "INVALID_INPUT")
}

func TestUnknownOrRepeatedQueryIsRejected(t *testing.T) {
	h := newServer(t, "")
	expectError(t, do(h, http.MethodGet, "/api/datasets?foo=1", nil), http.StatusBadRequest, "INVALID_INPUT")
	expectError(t, do(h, http.MethodGet, flowQuery+"&limit=1&limit=2", nil), http.StatusBadRequest, "INVALID_INPUT")
}

// 세미콜론이나 잘못된 %가 든 조건은 r.URL.Query()가 말없이 버린다. 조건이 빠진 채 더 넓은 결과를 주지 않게 막는다.
func TestMalformedQueryIsRejected(t *testing.T) {
	h := newServer(t, "")
	expectError(t, do(h, http.MethodGet, flowQuery+"&address="+addrT+";limit=5", nil), http.StatusBadRequest, "INVALID_INPUT")
	expectError(t, do(h, http.MethodGet, flowQuery+"&address=%zz", nil), http.StatusBadRequest, "INVALID_INPUT")
}

func TestTransfersNeedDatasetVersion(t *testing.T) {
	h := newServer(t, "")
	expectError(t, do(h, http.MethodGet, "/api/transfers?datasetId=flow-demo", nil), http.StatusBadRequest, "INVALID_INPUT")
	expectError(t, do(h, http.MethodGet, "/api/datasets/flow-demo", nil), http.StatusBadRequest, "INVALID_INPUT")
}

func TestTransfersCursorWalksAllPages(t *testing.T) {
	h := newServer(t, "")
	path := flowQuery + "&limit=3"
	var labels []string
	for pages := 0; ; pages++ {
		if pages > 5 {
			t.Fatal("커서가 끝나지 않는다")
		}
		rec := do(h, http.MethodGet, path, nil)
		r := decode(t, rec)
		var rows []domain.Transfer
		if err := json.Unmarshal(r.Data, &rows); err != nil || rec.Code != http.StatusOK {
			t.Fatalf("status = %d, %v", rec.Code, err)
		}
		for _, row := range rows {
			labels = append(labels, row.Label)
		}
		if r.Meta.Page.NextCursor == nil {
			break
		}
		path = flowQuery + "&limit=3&cursor=" + url.QueryEscape(*r.Meta.Page.NextCursor)
	}
	if got := strings.Join(labels, ","); got != "e1,e2,e3,e4,e5,e8,e6,e7" {
		t.Fatalf("labels = %s", got)
	}
}

func TestCursorFromOtherConditionsIsRejected(t *testing.T) {
	h := newServer(t, "")
	r := decode(t, do(h, http.MethodGet, flowQuery+"&address="+addrS+"&limit=1", nil))
	cursor := url.QueryEscape(*r.Meta.Page.NextCursor)
	expectError(t, do(h, http.MethodGet, flowQuery+"&limit=1&cursor="+cursor, nil), http.StatusBadRequest, "INVALID_CURSOR")
	expectError(t, do(h, http.MethodGet, flowQuery+"&cursor=not-a-cursor", nil), http.StatusBadRequest, "INVALID_CURSOR")

	// 같은 커서를 다른 데이터셋 버전에 쓰면 버전 불일치(409)다.
	other := "/api/transfers?datasetId=patterns-demo&datasetVersion=v1&address=" + addrS + "&limit=1&cursor=" + cursor
	expectError(t, do(h, http.MethodGet, other, nil), http.StatusConflict, "VERSION_MISMATCH")

	// 쪽 크기(limit)만 바꾸는 것은 괜찮다.
	if rec := do(h, http.MethodGet, flowQuery+"&address="+addrS+"&limit=5&cursor="+cursor, nil); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, %s", rec.Code, rec.Body.String())
	}
}

func TestDirectionNeedsAddress(t *testing.T) {
	h := newServer(t, "")
	expectError(t, do(h, http.MethodGet, flowQuery+"&direction=incoming", nil), http.StatusBadRequest, "INVALID_INPUT")
	expectError(t, do(h, http.MethodGet, flowQuery+"&address="+addrS+"&direction=up", nil), http.StatusBadRequest, "INVALID_INPUT")
}

func TestTransfersOutsideCoverageReturn422(t *testing.T) {
	expectError(t, do(newServer(t, ""), http.MethodGet, flowQuery+"&endBlock=99999999", nil), http.StatusUnprocessableEntity, "OUT_OF_RANGE")
}

// onePerPage는 저장소가 한 번에 1건씩만 주는 상황을 만든다.
type onePerPage struct{ repository.Repository }

func (p onePerPage) ListTransfers(ctx context.Context, q repository.TransferQuery) (repository.TransferPage, error) {
	q.Limit = 1
	return p.Repository.ListTransfers(ctx, q)
}

// 거래 상세는 저장소가 여러 쪽으로 나눠 줘도 끝까지 이어 받아 전송을 모두 보여 준다.
func TestTransactionDetailReadsEveryPage(t *testing.T) {
	path := "/api/transactions/0x" + strings.Repeat("0", 61) + "3ed?datasetId=patterns-demo&datasetVersion=v1"
	want := do(newServer(t, ""), http.MethodGet, path, nil)
	cfg := testConfig(t, "")
	cfg.Repo = onePerPage{cfg.Repo}
	got := do(New(cfg), http.MethodGet, path, nil)
	var rows []domain.Transfer
	if err := json.Unmarshal(decode(t, want).Data, &rows); err != nil || len(rows) != 2 || got.Body.String() != want.Body.String() {
		t.Fatalf("want %d %s\ngot %d %s", want.Code, want.Body, got.Code, got.Body)
	}
}

func TestTransactionNotFound(t *testing.T) {
	h := newServer(t, "")
	missing := "/api/transactions/0x" + strings.Repeat("ab", 32) + "?datasetId=flow-demo&datasetVersion=v1"
	expectError(t, do(h, http.MethodGet, missing, nil), http.StatusNotFound, "TRANSACTION_NOT_FOUND")
	expectError(t, do(h, http.MethodGet, "/api/transactions/0x12?datasetId=flow-demo&datasetVersion=v1", nil), http.StatusBadRequest, "INVALID_INPUT")
}

// 찾는 사이 데이터셋이 무효화되면 "거래 없음"(404)보다 데이터셋 상태(409)를 먼저 알린다.
func TestTransactionLookupInvalidatedReturns409(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.Repo = invalidateOnList{loadRepo(t)}
	missing := "/api/transactions/0x" + strings.Repeat("ab", 32) + "?datasetId=flow-demo&datasetVersion=v1"
	expectError(t, do(New(cfg), http.MethodGet, missing, nil), http.StatusConflict, "DATASET_INVALIDATED")
}

// invalidateOnList는 전송을 읽는 순간 데이터셋이 무효화되는 상황을 만든다.
type invalidateOnList struct{ *repository.Memory }

func (r invalidateOnList) ListTransfers(ctx context.Context, q repository.TransferQuery) (repository.TransferPage, error) {
	_ = r.SetStatus(q.DatasetID, q.DatasetVersion, domain.StatusInvalidated)
	return r.Memory.ListTransfers(ctx, q)
}

func TestUnknownRouteAndMethod(t *testing.T) {
	h := newServer(t, "")
	expectError(t, do(h, http.MethodGet, "/api/nope", nil), http.StatusNotFound, "NOT_FOUND")
	expectError(t, do(h, http.MethodDelete, "/api/datasets", nil), http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
}

func TestCommonHeaders(t *testing.T) {
	rec := do(newServer(t, ""), http.MethodGet, "/api/datasets", nil)
	for name, want := range map[string]string{
		"Content-Type":           "application/json; charset=utf-8",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "no-store",
	} {
		if got := rec.Header().Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
}

func TestCORSAllowsOnlyConfiguredOrigin(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.AllowedOrigins = []string{"http://localhost:5173"}
	h := New(cfg)

	req := func(origin string) *http.Request {
		r, _ := http.NewRequest(http.MethodOptions, "/api/paths", nil)
		r.Header.Set("Origin", origin)
		return r
	}
	rec := serve(h, req("http://localhost:5173"))
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("preflight = %d %v", rec.Code, rec.Header())
	}
	rec = serve(h, req("https://evil.example"))
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("등록하지 않은 웹 주소에는 허용 헤더를 주면 안 된다")
	}
}
