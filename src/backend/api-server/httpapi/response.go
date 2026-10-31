package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// ContractVersion은 API 규격 버전이다. 응답의 meta.contractVersion에 그대로 실린다.
// 규격(contracts/openapi.json)의 info.version과 같아야 한다.
const ContractVersion = "v1"

// limitations는 모든 응답 meta에 싣는 해석 한계 문구다. 화면에도 함께 보여 준다.
var limitations = []string{
	"후보 연결은 동일 자금의 귀속을 확정하지 않습니다.",
	"패턴은 규칙 일치이며 소유자나 위법성을 판정하지 않습니다.",
	"지정 데이터셋의 고정 범위만 분석합니다.",
}

// envelope는 모든 응답의 바깥 모양이다. 정상이면 error가 null, 오류면 data가 null이다.
type envelope struct {
	Data  any       `json:"data"`
	Meta  meta      `json:"meta"`
	Error *apiError `json:"error"`
}

type meta struct {
	ContractVersion string                `json:"contractVersion"`
	RuleVersion     string                `json:"ruleVersion"`
	DatasetID       string                `json:"datasetId,omitempty"`
	DatasetVersion  string                `json:"datasetVersion,omitempty"`
	SourceMode      string                `json:"sourceMode,omitempty"`
	Coverage        *domain.Coverage      `json:"coverage,omitempty"`
	Conditions      any                   `json:"conditions,omitempty"`
	Limits          *analyzer.LimitStatus `json:"limits,omitempty"`
	Page            *page                 `json:"page,omitempty"`
	Limitations     []string              `json:"limitations"`
}

// page는 목록 API의 페이지 정보다. nextCursor가 null이면 마지막 쪽이다.
type page struct {
	Limit      int     `json:"limit"`
	NextCursor *string `json:"nextCursor"`
}

type apiError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"` // true면 잠시 뒤 같은 요청을 다시 보내도 된다
}

func baseMeta() meta {
	return meta{ContractVersion: ContractVersion, RuleVersion: analyzer.RuleVersion, Limitations: limitations}
}

func datasetMeta(ds domain.Dataset) meta {
	m := baseMeta()
	m.DatasetID = ds.ID
	m.DatasetVersion = ds.Version
	m.SourceMode = ds.SourceMode
	coverage := ds.Coverage()
	m.Coverage = &coverage
	return m
}

func writeJSON(w http.ResponseWriter, status int, body envelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("응답 쓰기 실패: %v", err)
	}
}

func writeData(w http.ResponseWriter, data any, m meta) {
	writeJSON(w, http.StatusOK, envelope{Data: data, Meta: m})
}

// failure는 HTTP 상태와 오류 본문을 함께 담은 오류다.
type failure struct {
	status    int
	code      string
	message   string
	retryable bool
}

func (f *failure) Error() string { return f.code + ": " + f.message }

func fail(status int, code, message string) *failure {
	return &failure{status: status, code: code, message: message}
}

func badInput(message string) *failure {
	return fail(http.StatusBadRequest, "INVALID_INPUT", message)
}

// writeError는 오류를 HTTP 상태로 바꿔 쓴다.
//   - 400 입력 오류, 404 없음, 409 데이터셋 상태, 422 지원 범위 밖, 429 요청 제한
//   - 그 밖의 오류(저장소 장애·시간 초과)는 503이고 retryable이 true다. 원인은 서버 로그에만 남긴다.
func writeError(w http.ResponseWriter, err error) {
	var f *failure
	var reqErr *analyzer.RequestError
	switch {
	case errors.As(err, &f):
	case errors.As(err, &reqErr):
		f = badInput(reqErr.Message)
	case errors.Is(err, context.DeadlineExceeded):
		f = &failure{status: http.StatusServiceUnavailable, code: "REQUEST_TIMEOUT", message: "요청 처리 시간이 초과됐습니다. 조건을 줄이거나 잠시 뒤 다시 시도해 주세요.", retryable: true}
	default:
		log.Printf("요청 처리 실패: %v", err)
		f = &failure{status: http.StatusServiceUnavailable, code: "UNAVAILABLE", message: "일시적으로 요청을 처리할 수 없습니다. 잠시 뒤 다시 시도해 주세요.", retryable: true}
	}
	writeJSON(w, f.status, envelope{Meta: baseMeta(), Error: &apiError{Code: f.code, Message: f.message, Retryable: f.retryable}})
}
