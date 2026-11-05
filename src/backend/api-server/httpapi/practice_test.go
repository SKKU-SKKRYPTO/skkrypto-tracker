package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// 테스트용 정답. 공개 예시 데이터(flow-demo)의 ID만 쓴다(실제 실습 정답은 저장소에 넣지 않는다).
const practiceAnswersJSON = `{
  "version": 2,
  "answers": [
    {"challenge": "P1", "datasetId": "flow-demo", "datasetVersion": "v1", "points": 10,
     "paths": [["fx:flow-demo-v1:e1", "fx:flow-demo-v1:e4", "fx:flow-demo-v1:e6"], ["fx:flow-demo-v1:e2", "fx:flow-demo-v1:e5", "fx:flow-demo-v1:e6"]]}
  ]
}`

func writePracticeFile(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "answers.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func practiceServer(t *testing.T) http.Handler {
	t.Helper()
	answers, err := LoadPracticeAnswers(writePracticeFile(t, practiceAnswersJSON))
	if err != nil {
		t.Fatal(err)
	}
	cfg := testConfig(t, "")
	cfg.PracticeAnswers = answers
	return New(cfg)
}

func gradeOK(t *testing.T, h http.Handler, body string) (practiceGradeResult, string) {
	t.Helper()
	rec := do(h, http.MethodPost, "/api/practice/grade", []byte(body))
	r := decode(t, rec)
	if rec.Code != http.StatusOK || r.Error != nil {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var result practiceGradeResult
	if err := json.Unmarshal(r.Data, &result); err != nil {
		t.Fatal(err)
	}
	return result, rec.Body.String()
}

func TestPracticeGradePassesOnlyExactAnswer(t *testing.T) {
	h := practiceServer(t)
	cases := []struct {
		name            string
		body            string
		matches, passed bool
	}{
		{"정답 경로 모두", `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[["fx:flow-demo-v1:e2","fx:flow-demo-v1:e5","fx:flow-demo-v1:e6"],["fx:flow-demo-v1:e1","fx:flow-demo-v1:e4","fx:flow-demo-v1:e6"]]}`,
			true, true},
		{"짧은 ID·대문자·같은 경로 두 번", `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[[" E1","e4","e6 "],["e1","e4","e6"],["e2","e5","e6"]]}`,
			true, true},
		{"하나만 맞힘", `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[["e1","e4","e6"]]}`,
			true, false},
		{"정답에 틀린 경로를 더함", `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[["e1","e4","e6"],["e2","e5","e6"],["e3","e7","e8"]]}`,
			true, false},
		{"순서가 틀리면 틀린 경로", `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[["e4","e1","e6"],["e2","e5","e6"]]}`,
			true, false},
		{"경로 없음(빈 배열)", `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[]}`,
			true, false},
		{"paths 빠짐", `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1"}`,
			true, false},
		{"데이터셋이 다르면 통과 못 함", `{"challenge":"P1","datasetId":"patterns-demo","datasetVersion":"v1","paths":[["fx:flow-demo-v1:e1","fx:flow-demo-v1:e4","fx:flow-demo-v1:e6"],["fx:flow-demo-v1:e2","fx:flow-demo-v1:e5","fx:flow-demo-v1:e6"]]}`,
			false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, raw := gradeOK(t, h, tc.body)
			if got.Challenge != "P1" || got.DatasetMatches != tc.matches || got.Passed != tc.passed {
				t.Fatalf("got %+v", got)
			}
			// 통과 여부만 돌려준다. 점수·개수·정답 송금 ID는 응답에 싣지 않는다.
			for _, leak := range []string{"score", "hit", "wrong", "answerCount", "total", "e5", "fx:"} {
				if strings.Contains(raw, leak) {
					t.Fatalf("응답에 %q가 들어 있다: %s", leak, raw)
				}
			}
		})
	}
}

func TestPracticeGradeIsOffWithoutAnswers(t *testing.T) {
	rec := do(newServer(t, ""), http.MethodPost, "/api/practice/grade", []byte(`{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1"}`))
	expectError(t, rec, http.StatusNotFound, "NOT_FOUND")
	if !strings.Contains(decode(t, rec).Error.Message, "실습 채점이 꺼져") {
		t.Fatalf("message = %s", rec.Body.String())
	}
}

func TestPracticeGradeRejectsBadInput(t *testing.T) {
	h := practiceServer(t)
	four := `["e1","e2","e3","e4"]`
	eleven := strings.Repeat(`["e1"],`, 10) + `["e1"]`
	for name, body := range map[string]string{
		"모르는 문제":    `{"challenge":"P9","datasetId":"flow-demo","datasetVersion":"v1"}`,
		"데이터셋 없음":   `{"challenge":"P1"}`,
		"경로가 너무 김":  `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[` + four + `]}`,
		"빈 경로":      `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[[]]}`,
		"빈 송금 ID":   `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[[" "]]}`,
		"경로가 너무 많음": `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":[` + eleven + `]}`,
		"패턴은 받지 않음": `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","patterns":[]}`,
		"null":      `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1","paths":null}`,
		"쿼리":        "",
	} {
		t.Run(name, func(t *testing.T) {
			path := "/api/practice/grade"
			if name == "쿼리" {
				path += "?debug=1"
				body = `{"challenge":"P1","datasetId":"flow-demo","datasetVersion":"v1"}`
			}
			expectError(t, do(h, http.MethodPost, path, []byte(body)), http.StatusBadRequest, "INVALID_INPUT")
		})
	}
}

// 정답이 있는 데이터셋은 PRACTICE_DATASETS에 없어도 경로 찾기를 막고(403), 추적과 다른 데이터셋의 경로 찾기는 그대로 둔다.
func TestPracticeBlocksPathsOnPracticeDatasets(t *testing.T) {
	h := practiceServer(t)
	rec := do(h, http.MethodPost, "/api/paths", []byte(pathsBody("")))
	expectError(t, rec, http.StatusForbidden, "PATHS_DISABLED")
	if !strings.Contains(decode(t, rec).Error.Message, "실습 데이터셋에서는 경로 찾기") {
		t.Fatalf("message = %s", rec.Body.String())
	}
	upper := strings.Replace(pathsBody(""), `"flow-demo"`, `"FLOW-DEMO"`, 1)
	if rec := do(h, http.MethodPost, "/api/paths", []byte(upper)); rec.Code == http.StatusOK {
		t.Fatalf("대문자 데이터셋 이름으로 경로 찾기가 열렸다: %s", rec.Body.String())
	}
	if rec := do(h, http.MethodPost, "/api/trace", []byte(traceBody(""))); rec.Code != http.StatusOK {
		t.Fatalf("trace status = %d, body = %s", rec.Code, rec.Body.String())
	}
	other := strings.Replace(pathsBody(""), `"flow-demo"`, `"patterns-demo"`, 1)
	if rec := do(h, http.MethodPost, "/api/paths", []byte(other)); rec.Code != http.StatusOK {
		t.Fatalf("other dataset status = %d, body = %s", rec.Code, rec.Body.String())
	}
	// 채점이 꺼져 있으면 경로 찾기는 막지 않는다.
	if rec := do(newServer(t, ""), http.MethodPost, "/api/paths", []byte(pathsBody(""))); rec.Code != http.StatusOK {
		t.Fatalf("practice off status = %d", rec.Code)
	}
}

func TestLoadPracticeAnswersRejectsBadFiles(t *testing.T) {
	for name, body := range map[string]string{
		"JSON 아님":   `{`,
		"모르는 항목":    `{"version":2,"answers":[{"challenge":"P1","datasetId":"d","datasetVersion":"v1","points":1,"paths":[["a"]],"rubric":{}}]}`,
		"모르는 버전":    `{"version":4,"answers":[{"challenge":"P1","datasetId":"d","datasetVersion":"v1","points":1,"paths":[["a"]]}]}`,
		"중복 문제":     `{"version":2,"answers":[{"challenge":"P1","datasetId":"d","datasetVersion":"v1","points":1,"paths":[["a"]]},{"challenge":"P1","datasetId":"d","datasetVersion":"v1","points":1,"paths":[["a"]]}]}`,
		"배점 없음":     `{"version":2,"answers":[{"challenge":"P1","datasetId":"d","datasetVersion":"v1","paths":[["a"]]}]}`,
		"경로 없음":     `{"version":2,"answers":[{"challenge":"P1","datasetId":"d","datasetVersion":"v1","points":1,"paths":[]}]}`,
		"같은 경로 두 번": `{"version":2,"answers":[{"challenge":"P1","datasetId":"d","datasetVersion":"v1","points":1,"paths":[["a"],["A"]]}]}`,
		"패턴 항목":     `{"version":2,"answers":[{"challenge":"P1","datasetId":"d","datasetVersion":"v1","points":1,"paths":[["a"]],"patterns":[]}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := LoadPracticeAnswers(writePracticeFile(t, body)); err == nil {
				t.Fatal("잘못된 정답 파일을 받아들였다")
			}
		})
	}
	if _, err := LoadPracticeAnswers(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("없는 파일을 받아들였다")
	}
}

// 실제 거래판 정답(version 3, Snapshot 송금 ID)은 파일 없이 값으로도 받는다(Railway 비밀 변수).
func TestParsePracticeAnswersAcceptsSnapshotVersion(t *testing.T) {
	id := "84532:0x" + strings.Repeat("ab", 32) + ":3"
	answers, err := ParsePracticeAnswers([]byte(`{"version":3,"answers":[{"challenge":"ch1","datasetId":"snap-demo","datasetVersion":"v1","points":10,"paths":[["` + strings.ToUpper(id[:6]) + id[6:] + `"]]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if answers.Len() != 1 || !slices.Equal(answers.DatasetIDs(), []string{"snap-demo"}) {
		t.Fatalf("answers = %d, datasets = %v", answers.Len(), answers.DatasetIDs())
	}
	paths, err := normalizePracticePaths([][]string{{id}}, "snap-demo", "v1")
	if err != nil {
		t.Fatal(err)
	}
	if got := gradePracticeAnswer(answers.byChallenge["ch1"], "snap-demo", "v1", paths); !got.Passed {
		t.Fatalf("got %+v", got)
	}
}
