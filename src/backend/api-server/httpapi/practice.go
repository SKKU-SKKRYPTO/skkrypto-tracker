package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strings"
)

// 실습 채점 POST /api/practice/grade.
//
// 정답은 서버만 가진다. PRACTICE_ANSWERS_JSON(값) 또는 PRACTICE_ANSWERS_FILE(파일)로 받은 정답을 시작할 때 한 번 읽고,
// 화면에는 통과 여부(passed)만 돌려준다. 점수·맞힌 개수·어떤 경로가 맞았는지는 알려 주지 않는다(개수를 주면 경로를 하나씩
// 넣어 보며 정답을 맞출 수 있다). 다시 내는 횟수는 막지 않는다(배우는 실습이라 고쳐서 다시 채점해 보게 둔다).
//
// 실습 정답은 출발→도착 경로 찾기(/api/paths) 결과에서 나온다. 그래서 정답이 있는 데이터셋은 실습 데이터셋
// (PRACTICE_DATASETS)에 더해 /api/paths를 403으로 막는다(cmd/api-server). 추적(/api/trace)·패턴·송금 조회는 그대로 쓴다.

const (
	maxPracticePaths    = 10
	maxPracticeHops     = 3
	maxPracticeIDLength = 256
)

// PracticeAnswers는 실습 정답 묶음이다. 비어 있으면(nil) 실습 채점은 꺼져 있다.
type PracticeAnswers struct {
	byChallenge map[string]practiceAnswer
}

// Len은 정답이 있는 문제 수다. 로그에는 개수만 남기고 정답 내용은 남기지 않는다.
func (a *PracticeAnswers) Len() int { return len(a.byChallenge) }

// DatasetIDs는 정답이 있는 데이터셋 ID다. 이 데이터셋들은 경로 찾기를 막는다(정답이 바로 보이므로).
func (a *PracticeAnswers) DatasetIDs() []string {
	if a == nil {
		return nil
	}
	var ids []string
	for _, answer := range a.byChallenge {
		if !slices.Contains(ids, answer.DatasetID) {
			ids = append(ids, answer.DatasetID)
		}
	}
	slices.Sort(ids)
	return ids
}

type practiceAnswer struct {
	Challenge      string     `json:"challenge"`
	DatasetID      string     `json:"datasetId"`
	DatasetVersion string     `json:"datasetVersion"`
	Points         float64    `json:"points"` // 배점 기록용. 채점 응답에는 싣지 않는다
	Paths          [][]string `json:"paths"`
}

// LoadPracticeAnswers는 정답 파일을 읽고 확인한다. 형식이 틀리면 서버가 뜨기 전에 실패한다.
// 오류 문구에는 파일 위치와 문제 ID까지만 넣고 정답 값은 넣지 않는다.
func LoadPracticeAnswers(path string) (*PracticeAnswers, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("실습 정답 파일을 읽지 못했습니다(%s): %w", path, err)
	}
	answers, err := ParsePracticeAnswers(body)
	if err != nil {
		return nil, fmt.Errorf("%w (%s)", err, path)
	}
	return answers, nil
}

// ParsePracticeAnswers는 정답 JSON(labs answers.json 내용)을 확인한다. version 2(합성 데이터판)와 3(실제 거래판)을 받는다.
func ParsePracticeAnswers(body []byte) (*PracticeAnswers, error) {
	var file struct {
		Version int              `json:"version"`
		Answers []practiceAnswer `json:"answers"`
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&file); err != nil {
		return nil, errors.New("실습 정답 형식이 잘못됐습니다")
	}
	if (file.Version != 2 && file.Version != 3) || len(file.Answers) == 0 {
		return nil, errors.New("실습 정답에는 version 2 또는 3과 answers 목록이 필요합니다")
	}
	answers := &PracticeAnswers{byChallenge: map[string]practiceAnswer{}}
	for i, a := range file.Answers {
		if a.Challenge = strings.TrimSpace(a.Challenge); a.Challenge == "" {
			return nil, fmt.Errorf("실습 정답 %d번째에 challenge가 없습니다", i+1)
		}
		if _, dup := answers.byChallenge[a.Challenge]; dup {
			return nil, fmt.Errorf("실습 정답에 %s가 두 번 있습니다", a.Challenge)
		}
		a.DatasetID, a.DatasetVersion = strings.TrimSpace(a.DatasetID), strings.TrimSpace(a.DatasetVersion)
		if a.DatasetID == "" || a.DatasetVersion == "" {
			return nil, fmt.Errorf("실습 정답 %s에 datasetId·datasetVersion이 없습니다", a.Challenge)
		}
		if a.Points <= 0 {
			return nil, fmt.Errorf("실습 정답 %s의 배점은 0보다 커야 합니다", a.Challenge)
		}
		// 제출 쪽과 같은 상한을 둔다. 정답 경로가 더 많으면 아무도 전부 낼 수 없다.
		if len(a.Paths) == 0 || len(a.Paths) > maxPracticePaths {
			return nil, fmt.Errorf("실습 정답 %s의 경로는 1~%d개여야 합니다", a.Challenge, maxPracticePaths)
		}
		seen := map[string]bool{}
		for j, path := range a.Paths {
			if len(path) == 0 || len(path) > maxPracticeHops {
				return nil, fmt.Errorf("실습 정답 %s의 %d번째 경로는 송금 1~%d개여야 합니다", a.Challenge, j+1, maxPracticeHops)
			}
			for k, id := range path {
				if id = strings.TrimSpace(id); id == "" || len(id) > maxPracticeIDLength {
					return nil, fmt.Errorf("실습 정답 %s의 %d번째 경로에 올바르지 않은 송금 ID가 있습니다", a.Challenge, j+1)
				}
				a.Paths[j][k] = practiceID(id, a.DatasetID, a.DatasetVersion)
			}
			key := pathKey(a.Paths[j])
			if seen[key] {
				return nil, fmt.Errorf("실습 정답 %s에 같은 경로가 두 번 있습니다", a.Challenge)
			}
			seen[key] = true
		}
		answers.byChallenge[a.Challenge] = a
	}
	return answers, nil
}

// practiceGradeRequest는 화면이 보내는 답안이다. 경로가 없다고 답할 때는 paths를 빈 배열로 보낸다.
type practiceGradeRequest struct {
	Challenge      string     `json:"challenge"`
	DatasetID      string     `json:"datasetId"`
	DatasetVersion string     `json:"datasetVersion"`
	Paths          [][]string `json:"paths"`
}

type practiceGradeResult struct {
	Challenge      string `json:"challenge"`
	DatasetMatches bool   `json:"datasetMatches"`
	Passed         bool   `json:"passed"` // 정답 경로를 모두 내고 틀린 경로가 없을 때만 true
}

func (s *server) gradePractice(w http.ResponseWriter, r *http.Request) error {
	if s.answers == nil {
		return fail(http.StatusNotFound, "NOT_FOUND", "실습 채점이 꺼져 있습니다.")
	}
	if err := onlyParams(r); err != nil {
		return err
	}
	var req practiceGradeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	answer, ok := s.answers.byChallenge[strings.TrimSpace(req.Challenge)]
	if !ok {
		return badInput("모르는 실습 문제입니다: " + req.Challenge)
	}
	datasetID, version := strings.TrimSpace(req.DatasetID), strings.TrimSpace(req.DatasetVersion)
	if datasetID == "" || version == "" {
		return badInput("datasetId와 datasetVersion이 필요합니다.")
	}
	paths, err := normalizePracticePaths(req.Paths, datasetID, version)
	if err != nil {
		return err
	}
	// 분석 API처럼 채점 전과 응답 전에 데이터셋이 있고 READY인지 본다(없으면 404, 수집 중·무효화면 409).
	ds, err := s.readyDataset(r.Context(), datasetID, version)
	if err != nil {
		return err
	}
	result := gradePracticeAnswer(answer, datasetID, version, paths)
	if err := s.stillReady(r.Context(), ds); err != nil {
		return err
	}
	writeData(w, result, datasetMeta(ds))
	return nil
}

// normalizePracticePaths는 제출 경로를 정답과 같은 모양으로 바꾼다. 송금 ID는 소문자로, 뒷부분만 적은 ID(t01)는
// fx:{datasetId}-{datasetVersion}:t01로 늘린다. 같은 경로를 두 번 내도 한 번으로 센다.
func normalizePracticePaths(rows [][]string, datasetID, version string) (map[string]bool, error) {
	if len(rows) > maxPracticePaths {
		return nil, badInput(fmt.Sprintf("경로는 최대 %d개까지 낼 수 있습니다.", maxPracticePaths))
	}
	paths := map[string]bool{}
	for _, path := range rows {
		if len(path) == 0 || len(path) > maxPracticeHops {
			return nil, badInput(fmt.Sprintf("경로 하나에는 송금 1~%d개를 넣어 주세요.", maxPracticeHops))
		}
		ids := make([]string, len(path))
		for i, id := range path {
			if id = strings.TrimSpace(id); id == "" || len(id) > maxPracticeIDLength {
				return nil, badInput(fmt.Sprintf("송금 ID는 1~%d자여야 합니다.", maxPracticeIDLength))
			}
			ids[i] = practiceID(id, datasetID, version)
		}
		paths[pathKey(ids)] = true
	}
	return paths, nil
}

// gradePracticeAnswer는 낸 경로 묶음이 정답 경로 묶음과 똑같을 때만(빠진 것도, 정답이 아닌 것도 없을 때) 통과로 본다.
// 데이터셋이 다르면 통과하지 않는다.
func gradePracticeAnswer(answer practiceAnswer, datasetID, version string, paths map[string]bool) practiceGradeResult {
	result := practiceGradeResult{
		Challenge:      answer.Challenge,
		DatasetMatches: strings.EqualFold(datasetID, answer.DatasetID) && strings.EqualFold(version, answer.DatasetVersion),
	}
	if !result.DatasetMatches || len(paths) != len(answer.Paths) {
		return result
	}
	for _, path := range answer.Paths {
		if !paths[pathKey(path)] {
			return result
		}
	}
	result.Passed = true
	return result
}

func practiceID(id, datasetID, version string) string {
	id = strings.ToLower(strings.TrimSpace(id))
	if strings.Contains(id, ":") {
		return id
	}
	return "fx:" + strings.ToLower(datasetID+"-"+version) + ":" + id
}

// pathKey는 경로 안의 송금 순서를 지킨 채 비교하려고 만드는 키다(경로끼리의 순서는 따지지 않는다).
// 구분 문자로 잇지 않고 JSON 배열로 만들어, ID 안에 어떤 문자가 있어도 서로 다른 경로가 같은 키가 되지 않게 한다.
func pathKey(ids []string) string {
	key, _ := json.Marshal(ids)
	return string(key)
}
