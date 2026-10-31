package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/repository"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// maxBodyBytes는 분석 요청 본문의 최대 크기다. 조건 몇 개면 1KB도 안 된다.
const maxBodyBytes = 64 << 10

// analysisRequest는 POST /api/trace·/api/paths·/api/patterns의 본문이다.
// 엔진 조건(analyzer.Request)에 데이터셋 키와 자산을 붙인 모양이다.
type analysisRequest struct {
	DatasetID      string        `json:"datasetId"`
	DatasetVersion string        `json:"datasetVersion"`
	Asset          *domain.Asset `json:"asset,omitempty"`
	analyzer.Request
}

// analyze는 분석 API 하나를 만든다. 순서: 입력 확인(400) → 데이터셋 상태(404·409)
// → 자산·범위(422) → 저장소에서 후보 읽기 → 엔진 → 데이터셋 재확인 → 응답(기획안 담당 3 처리 순서).
func (s *server) analyze(kind string) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if err := onlyParams(r); err != nil {
			return err
		}
		var req analysisRequest
		if err := decodeJSON(w, r, &req); err != nil {
			return err
		}
		if req.DatasetID == "" || req.DatasetVersion == "" {
			return badInput("datasetId와 datasetVersion이 필요합니다.")
		}
		if req.Asset != nil && (req.Asset.ChainID == 0 || !domain.ValidAddress(req.Asset.TokenAddress)) {
			return badInput("asset에는 chainId와 tokenAddress가 모두 필요합니다.")
		}
		normalized, err := analyzer.Normalize(kind, req.Request)
		if err != nil {
			return err
		}
		req.Request = normalized

		ds, err := s.dataset(r.Context(), req.DatasetID, req.DatasetVersion, true)
		if err != nil {
			return err
		}
		if req.Asset != nil && !req.Asset.Same(ds.Asset) {
			return fail(http.StatusUnprocessableEntity, "UNSUPPORTED_ASSET", fmt.Sprintf(
				"이 데이터셋은 체인 %d의 토큰 %s만 분석합니다.", ds.Asset.ChainID, ds.Asset.TokenAddress))
		}
		req.Asset = &ds.Asset
		if err := checkRange(&req.Filter, ds); err != nil {
			return err
		}
		if req.StartTransferID != "" && !domain.ValidTransferID(ds.SourceMode, ds.SourceNamespace, req.StartTransferID) {
			return badInput("선택한 전송 ID(startTransferId)가 이 데이터셋의 ID 형식과 다릅니다. " +
				"FIXTURE는 fx:{namespace}:{recordId}, SNAPSHOT은 {chainId}:{txHash}:{logIndex}입니다.")
		}

		// 패턴과 1 hop은 시작 주소의 전송만 쓰므로 주소 조건을 넘겨 후보를 줄인다. 그래야 후보 상한에
		// 다른 주소의 전송이 먼저 차서 정작 시작 주소를 못 보는 일이 없다.
		// 2·3 hop은 시작 주소와 상관없는 전송도 지나므로 범위 안 전송을 모두 받는다.
		q := repository.TransferQuery{
			DatasetID:      ds.ID,
			DatasetVersion: ds.Version,
			StartBlock:     req.Filter.StartBlock,
			EndBlock:       req.Filter.EndBlock,
			StartTime:      req.Filter.StartTime,
			EndTime:        req.Filter.EndTime,
			MinAmountRaw:   req.Filter.MinAmountRaw,
			Limit:          req.Limits.MaxCandidates,
		}
		if kind == analyzer.KindPatterns || req.MaxDepth == 1 {
			q.Address, q.Direction = req.Address, req.Direction
		}
		repoStart := time.Now()
		candidates, err := s.repo.ListTransfers(r.Context(), q)
		if err != nil {
			return err
		}
		rows, err := checkRows(candidates.Transfers, ds)
		if err != nil {
			return err
		}
		in := analyzer.Input{Transfers: rows, Coverage: ds.Coverage(), CandidatesTruncated: candidates.HasMore}
		repoTime := time.Since(repoStart)

		engineStart := time.Now()
		var result analyzer.Result
		switch kind {
		case analyzer.KindTrace:
			result, err = s.engine.Trace(r.Context(), req.Request, in)
		case analyzer.KindPaths:
			result, err = s.engine.Paths(r.Context(), req.Request, in)
		case analyzer.KindPatterns:
			result, err = s.engine.Patterns(r.Context(), req.Request, in)
		}
		if err != nil {
			return err
		}
		engineTime := time.Since(engineStart)
		for i := range result.Nodes {
			result.Nodes[i].Label = ds.Labels[result.Nodes[i].ID]
		}
		if err := s.stillReady(r.Context(), ds); err != nil {
			return err
		}

		// 저장소·엔진에 걸린 시간을 나눠 알려 준다(브라우저 개발자 도구 Network 탭의 Timing에서 보인다).
		w.Header().Set("Server-Timing", fmt.Sprintf("repo;dur=%.1f, engine;dur=%.1f", ms(repoTime), ms(engineTime)))
		m := datasetMeta(ds)
		m.Conditions = req
		m.Limits = &result.Limits
		writeData(w, result, m)
		return nil
	}
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }

// decodeJSON은 요청 본문을 엄격하게 읽는다.
//   - 64KB를 넘으면 받지 않는다.
//   - null은 받지 않는다. Go는 null을 0값으로 바꿔서 "안 보냄"과 구분이 안 되기 때문이다.
//   - 모르는 항목(오타), 같은 항목 두 번, JSON 두 개 이어 붙이기도 받지 않는다.
func decodeJSON(w http.ResponseWriter, r *http.Request, dest any) error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return badInput("요청 본문은 64KB 이하여야 합니다.")
		}
		return badInput("요청 본문을 읽지 못했습니다.")
	}

	var raw any
	dec := json.NewDecoder(bytes.NewReader(body))
	if err := dec.Decode(&raw); err != nil {
		return badInput("요청 본문은 JSON 객체여야 합니다.")
	}
	if _, ok := raw.(map[string]any); !ok {
		return badInput("요청 본문은 JSON 객체여야 합니다.")
	}
	if _, err := dec.Token(); err != io.EOF {
		return badInput("JSON 객체 하나만 보내 주세요.")
	}
	if key, ok := duplicateKey(body); ok {
		return badInput("같은 항목이 두 번 있습니다: " + key)
	}
	if hasNull(raw) {
		return badInput("null 값은 쓸 수 없습니다. 항목을 빼거나 올바른 값을 넣어 주세요.")
	}
	if err := checkKeys(raw, reflect.TypeOf(dest)); err != nil {
		return err
	}

	strict := json.NewDecoder(bytes.NewReader(body))
	strict.DisallowUnknownFields()
	if err := strict.Decode(dest); err != nil {
		if field, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			return badInput("알 수 없는 항목입니다: " + strings.Trim(field, `"`))
		}
		return badInput("요청 값의 형식을 확인해 주세요. 금액·블록 번호는 문자열, 시각은 RFC3339 형식입니다.")
	}
	return nil
}

// checkKeys는 JSON 항목 이름이 대소문자까지 정확한지 본다.
// Go의 json 패키지는 "maxdepth"도 MaxDepth에 넣어 버려서, 오타가 조용히 통과할 수 있다.
func checkKeys(raw any, t reflect.Type) error {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	object, ok := raw.(map[string]any)
	if !ok || t.Kind() != reflect.Struct {
		return nil
	}
	fields := jsonFields(t)
	for name, value := range object {
		field, ok := fields[name]
		if !ok {
			return badInput("알 수 없는 항목입니다: " + name)
		}
		if err := checkKeys(value, field); err != nil {
			return err
		}
	}
	return nil
}

// jsonFields는 구조체의 JSON 항목 이름과 타입을 모은다. 이름 없이 끼워 넣은 구조체(analyzer.Request)는 펼친다.
func jsonFields(t reflect.Type) map[string]reflect.Type {
	out := map[string]reflect.Type{}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		switch {
		case f.Anonymous && name == "":
			maps.Copy(out, jsonFields(f.Type))
		case f.IsExported() && name != "" && name != "-":
			out[name] = f.Type
		}
	}
	return out
}

// duplicateKey는 한 객체 안에 같은 항목 이름이 두 번 있는지 본다.
// Go의 json 패키지는 뒤의 값으로 조용히 덮어써서, 보낸 사람이 어느 값이 쓰였는지 모르게 된다.
func duplicateKey(body []byte) (string, bool) {
	dec := json.NewDecoder(bytes.NewReader(body))
	var open []map[string]bool // 열린 객체마다 본 항목 이름. 배열 자리는 nil
	expectKey := false
	for {
		tok, err := dec.Token()
		if err != nil {
			return "", false
		}
		switch tok {
		case json.Delim('{'):
			open = append(open, map[string]bool{})
			expectKey = true
			continue
		case json.Delim('['):
			open = append(open, nil)
			expectKey = false
			continue
		case json.Delim('}'), json.Delim(']'):
			open = open[:len(open)-1]
		default:
			if key, ok := tok.(string); ok && expectKey {
				seen := open[len(open)-1]
				if seen[key] {
					return key, true
				}
				seen[key] = true
				expectKey = false
				continue
			}
		}
		// 값 하나가 끝났다. 객체 안이면 다음 토큰은 항목 이름이다.
		expectKey = len(open) > 0 && open[len(open)-1] != nil
	}
}

func hasNull(v any) bool {
	switch v := v.(type) {
	case nil:
		return true
	case map[string]any:
		for _, child := range v {
			if hasNull(child) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if hasNull(child) {
				return true
			}
		}
	}
	return false
}
