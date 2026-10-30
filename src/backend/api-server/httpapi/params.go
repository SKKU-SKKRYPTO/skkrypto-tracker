package httpapi

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// onlyParams는 허용한 쿼리 이름만 한 번씩 왔는지 본다. 오타 난 조건을 조용히 무시하지 않기 위해서다.
func onlyParams(r *http.Request, allowed ...string) error {
	for name, values := range r.URL.Query() {
		if !slices.Contains(allowed, name) {
			return badInput("지원하지 않는 쿼리 조건입니다: " + name)
		}
		if len(values) != 1 {
			return badInput("같은 쿼리 조건이 두 번 들어왔습니다: " + name)
		}
	}
	return nil
}

func parseBlock(name, value string) (*domain.BlockNumber, error) {
	if value == "" {
		return nil, nil
	}
	n, err := domain.ParseBlockNumber(value)
	if err != nil {
		return nil, badInput(name + "는 0 이상의 십진 정수여야 합니다.")
	}
	return &n, nil
}

func parseTime(name, value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, badInput(name + "는 시간대가 들어간 RFC3339 형식이어야 합니다(예: 2026-10-26T12:00:00Z).")
	}
	return &t, nil
}

// checkRange는 필터가 데이터셋 수집 범위 안인지 보고, 빈 칸을 범위 끝값으로 채운다.
// 범위 밖을 물으면 0건이 아니라 422로 알린다. 수집하지 않은 구간은 "없음"이 아니라 "모름"이기 때문이다.
func checkRange(f *analyzer.Filter, ds domain.Dataset) error {
	c := ds.Coverage()
	if f.StartBlock != nil && f.EndBlock != nil && *f.StartBlock > *f.EndBlock {
		return badInput("블록 범위의 시작이 끝보다 큽니다.")
	}
	if f.StartTime != nil && f.EndTime != nil && f.StartTime.After(*f.EndTime) {
		return badInput("시간 범위의 시작이 끝보다 늦습니다.")
	}
	if f.MinAmountRaw != "" {
		if _, err := domain.ParseAmount(f.MinAmountRaw); err != nil {
			return badInput("최소 금액(minAmountRaw)은 uint256 범위의 십진 문자열이어야 합니다.")
		}
	}

	blockOut := func(b *domain.BlockNumber) bool { return b != nil && (*b < c.StartBlock || *b > c.EndBlock) }
	timeOut := func(t *time.Time) bool { return t != nil && (t.Before(c.StartTime) || t.After(c.EndTime)) }
	if blockOut(f.StartBlock) || blockOut(f.EndBlock) || timeOut(f.StartTime) || timeOut(f.EndTime) {
		return fail(http.StatusUnprocessableEntity, "OUT_OF_RANGE", fmt.Sprintf(
			"요청한 범위가 데이터셋 수집 범위(블록 %s~%s, %s~%s) 밖입니다.",
			c.StartBlock, c.EndBlock, c.StartTime.Format(time.RFC3339), c.EndTime.Format(time.RFC3339)))
	}

	if f.StartBlock == nil {
		f.StartBlock = &c.StartBlock
	}
	if f.EndBlock == nil {
		f.EndBlock = &c.EndBlock
	}
	f.StartTime = utcOr(f.StartTime, c.StartTime)
	f.EndTime = utcOr(f.EndTime, c.EndTime)
	return nil
}

func utcOr(t *time.Time, fallback time.Time) *time.Time {
	v := fallback
	if t != nil {
		v = t.UTC()
	}
	return &v
}

// checkRows는 저장소가 돌려준 전송이 데이터셋과 맞는지 본다.
// 맞지 않으면 다시 시도해도 같으므로 503이지만 retryable은 false다.
func checkRows(rows []domain.Transfer, ds domain.Dataset) ([]domain.Transfer, error) {
	out := make([]domain.Transfer, len(rows))
	for i, t := range rows {
		_, amountErr := domain.ParseAmount(t.AmountRaw)
		if !t.Asset.Same(ds.Asset) || !domain.ValidTransferID(ds.SourceMode, ds.SourceNamespace, t.ID) ||
			amountErr != nil || !domain.ValidAddress(t.From) || !domain.ValidAddress(t.To) {
			return nil, &failure{status: http.StatusServiceUnavailable, code: "INVALID_DATA", message: "저장소의 전송 데이터가 규격과 맞지 않습니다. 담당자에게 알려 주세요."}
		}
		t.From = domain.NormalizeAddress(t.From)
		t.To = domain.NormalizeAddress(t.To)
		t.TxHash = strings.ToLower(t.TxHash)
		t.Timestamp = t.Timestamp.UTC()
		out[i] = t
	}
	return out, nil
}
