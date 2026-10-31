package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// 기획안 담당 3 검증 항목: Fixture → 검색 → 1 hop → 상세 흐름을 실제 저장소(메모리)·엔진으로 확인한다.
// 화면에서 사용자가 하는 순서와 같다. DB·웹을 붙인 통합은 담당 1·4 구현이 들어온 뒤 이 흐름을 그대로 돌린다.
func TestFixtureFlowSearchOneHopDetail(t *testing.T) {
	h := newServer(t, "")

	// 1. 데이터셋을 고른다.
	var datasets []domain.Dataset
	readData(t, do(h, http.MethodGet, "/api/datasets", nil), &datasets)
	var ds domain.Dataset
	for _, d := range datasets {
		if d.ID == "flow-demo" && d.Status == domain.StatusReady {
			ds = d
		}
	}
	if ds.ID == "" {
		t.Fatal("READY 데이터셋 flow-demo가 없다")
	}
	key := "datasetId=" + ds.ID + "&datasetVersion=" + ds.Version

	// 2. 주소로 검색한다.
	var sent []domain.Transfer
	readData(t, do(h, http.MethodGet, "/api/transfers?"+key+"&address="+addrS+"&direction=outgoing", nil), &sent)
	if len(sent) != 3 {
		t.Fatalf("S가 보낸 전송 = %d건", len(sent))
	}

	// 3. 1 hop 그래프를 그린다.
	body := `{"datasetId":"` + ds.ID + `","datasetVersion":"` + ds.Version + `","address":"` + addrS + `","maxDepth":1}`
	var graph analyzer.Result
	readData(t, do(h, http.MethodPost, "/api/trace", []byte(body)), &graph)
	if len(graph.Transfers) != len(sent) {
		t.Fatalf("1 hop 전송 %d건, 검색 %d건", len(graph.Transfers), len(sent))
	}

	// 4. 선 하나를 눌러 같은 거래의 상세를 본다. 그래프·표·상세가 같은 전송 ID를 쓴다.
	edge := graph.Transfers[0]
	var detail []domain.Transfer
	readData(t, do(h, http.MethodGet, "/api/transactions/"+edge.TxHash+"?"+key, nil), &detail)
	if len(detail) != 1 || detail[0].ID != edge.ID || detail[0].ID != sent[0].ID {
		t.Fatalf("상세 = %+v, 그래프 = %s", detail, edge.ID)
	}
}

func readData(t *testing.T, rec interface{ Result() *http.Response }, dest any) {
	t.Helper()
	res := rec.Result()
	defer res.Body.Close()
	var r struct {
		Data  json.RawMessage `json:"data"`
		Error *apiError       `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil || res.StatusCode != http.StatusOK || r.Error != nil {
		t.Fatalf("status = %d, error = %+v, decode = %v", res.StatusCode, r.Error, err)
	}
	if err := json.Unmarshal(r.Data, dest); err != nil {
		t.Fatal(err)
	}
}
