package httpapi

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "contracts/samples를 지금 응답으로 다시 쓴다")

const contractsDir = "../contracts"

type sampleRequest struct {
	Sample      string          `json:"sample"`
	Method      string          `json:"method"`
	Path        string          `json:"path"`
	Body        json.RawMessage `json:"body,omitempty"`
	Setup       string          `json:"setup,omitempty"`
	Status      int             `json:"status"`
	Description string          `json:"description"`
}

// 회의록 예시: 응답 형식이 문서와 같은지.
// contracts/sample-requests.json의 요청을 실제 서버에 보내고, 응답이 samples/ 파일과 글자 그대로 같은지 본다.
// 규격을 일부러 바꿨다면 아래 명령으로 샘플을 다시 만들고, 바뀐 샘플을 PR에서 함께 리뷰받는다.
//
//	go -C src/backend test ./api-server/httpapi -run TestResponsesMatchSamples -update
func TestResponsesMatchSamples(t *testing.T) {
	b, err := os.ReadFile(filepath.Join(contractsDir, "sample-requests.json"))
	if err != nil {
		t.Fatal(err)
	}
	var requests []sampleRequest
	if err := json.Unmarshal(b, &requests); err != nil {
		t.Fatal(err)
	}
	for _, sr := range requests {
		t.Run(sr.Sample, func(t *testing.T) {
			h := newServer(t, sr.Setup)
			var body []byte
			if len(sr.Body) > 0 {
				body = sr.Body
			}
			rec := do(h, sr.Method, sr.Path, body)
			if sr.Setup == "rate-limited" {
				rec = do(h, sr.Method, sr.Path, body) // 1분에 1번 제한이라 두 번째가 429다
			}
			if rec.Code != sr.Status {
				t.Fatalf("status = %d, want %d\n%s", rec.Code, sr.Status, rec.Body.String())
			}

			var got bytes.Buffer
			if err := json.Indent(&got, rec.Body.Bytes(), "", "  "); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(contractsDir, "samples", sr.Sample)
			if *update {
				if err := os.WriteFile(file, got.Bytes(), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got.Bytes(), want) {
				t.Fatalf("%s 와 실제 응답이 다릅니다. 의도한 변경이면 -update로 샘플을 다시 만드세요.\n실제 응답:\n%s", sr.Sample, got.String())
			}
		})
	}
}
