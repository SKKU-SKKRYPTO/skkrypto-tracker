package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/repository"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

const (
	defaultPageSize = 100
	maxPageSize     = 1000
)

// transferConditions는 전송 목록 조건이다. 응답 meta.conditions에 그대로 실린다.
type transferConditions struct {
	Address   string          `json:"address,omitempty"`
	Direction string          `json:"direction"` // any | incoming | outgoing
	Filter    analyzer.Filter `json:"filter"`
	Limit     int             `json:"limit"`
}

// GET /api/transfers
func (s *server) listTransfers(w http.ResponseWriter, r *http.Request) error {
	if err := onlyParams(r, "datasetId", "datasetVersion", "address", "direction",
		"startBlock", "endBlock", "startTime", "endTime", "minAmountRaw", "limit", "cursor"); err != nil {
		return err
	}
	q := r.URL.Query()
	c, err := parseTransferConditions(q)
	if err != nil {
		return err
	}
	ds, err := s.readyDataset(r.Context(), q.Get("datasetId"), q.Get("datasetVersion"))
	if err != nil {
		return err
	}
	if err := checkRange(&c.Filter, ds); err != nil {
		return err
	}

	query := repository.TransferQuery{
		DatasetID:      ds.ID,
		DatasetVersion: ds.Version,
		Address:        c.Address,
		StartBlock:     c.Filter.StartBlock,
		EndBlock:       c.Filter.EndBlock,
		StartTime:      c.Filter.StartTime,
		EndTime:        c.Filter.EndTime,
		MinAmountRaw:   c.Filter.MinAmountRaw,
		Limit:          c.Limit,
	}
	if c.Direction != "any" {
		query.Direction = c.Direction
	}
	if raw := q.Get("cursor"); raw != "" {
		if query.After, err = decodeCursor(raw, ds, c); err != nil {
			return err
		}
	}

	result, err := s.repo.ListTransfers(r.Context(), query)
	if err != nil {
		return err
	}
	rows, err := checkRows(result.Transfers, ds)
	if err != nil {
		return err
	}
	if err := s.stillReady(r.Context(), ds); err != nil {
		return err
	}

	m := datasetMeta(ds)
	m.Conditions = c
	m.Page = &page{Limit: c.Limit}
	if result.HasMore && len(rows) > 0 {
		next := encodeCursor(ds, c, rows[len(rows)-1])
		m.Page.NextCursor = &next
	}
	writeData(w, rows, m)
	return nil
}

func parseTransferConditions(q url.Values) (transferConditions, error) {
	c := transferConditions{Direction: "any", Limit: defaultPageSize}
	if v := q.Get("address"); v != "" {
		if !domain.ValidAddress(v) {
			return c, badInput("주소(address)는 0x로 시작하는 16진수 40자리여야 합니다.")
		}
		c.Address = domain.NormalizeAddress(v)
	}
	if v := q.Get("direction"); v != "" {
		c.Direction = v
	}
	switch c.Direction {
	case "any":
	case repository.DirectionIncoming, repository.DirectionOutgoing:
		if c.Address == "" {
			return c, badInput("방향(direction)을 쓰려면 주소(address)가 필요합니다.")
		}
	default:
		return c, badInput("방향(direction)은 any, incoming, outgoing 중 하나여야 합니다.")
	}

	var err error
	if c.Filter.StartBlock, err = parseBlock("startBlock", q.Get("startBlock")); err != nil {
		return c, err
	}
	if c.Filter.EndBlock, err = parseBlock("endBlock", q.Get("endBlock")); err != nil {
		return c, err
	}
	if c.Filter.StartTime, err = parseTime("startTime", q.Get("startTime")); err != nil {
		return c, err
	}
	if c.Filter.EndTime, err = parseTime("endTime", q.Get("endTime")); err != nil {
		return c, err
	}
	c.Filter.MinAmountRaw = q.Get("minAmountRaw")

	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxPageSize {
			return c, badInput("limit은 1~1000 사이의 정수여야 합니다.")
		}
		c.Limit = n
	}
	return c, nil
}

// GET /api/transactions/{txHash}
func (s *server) getTransaction(w http.ResponseWriter, r *http.Request) error {
	if err := onlyParams(r, "datasetId", "datasetVersion"); err != nil {
		return err
	}
	hash := chi.URLParam(r, "txHash")
	if !domain.ValidHash(hash) {
		return badInput("거래 해시(txHash)는 0x로 시작하는 16진수 64자리여야 합니다.")
	}
	hash = strings.ToLower(hash)
	q := r.URL.Query()
	ds, err := s.readyDataset(r.Context(), q.Get("datasetId"), q.Get("datasetVersion"))
	if err != nil {
		return err
	}
	// 거래 하나의 전송은 보통 몇 건이지만, 에어드랍처럼 한 쪽(1000건)을 넘을 수 있어 끝까지 받는다.
	query := repository.TransferQuery{DatasetID: ds.ID, DatasetVersion: ds.Version, TxHash: hash, Limit: maxPageSize}
	var all []domain.Transfer
	for {
		page, err := s.repo.ListTransfers(r.Context(), query)
		if err != nil {
			return err
		}
		all = append(all, page.Transfers...)
		if !page.HasMore || len(page.Transfers) == 0 {
			break
		}
		last := page.Transfers[len(page.Transfers)-1]
		query.After = &repository.Cursor{Position: last.Position(), ID: last.ID}
	}
	rows, err := checkRows(all, ds)
	if err != nil {
		return err
	}
	// 찾지 못했다는 답도 데이터셋이 그대로일 때만 맞으므로 상태를 먼저 다시 본다.
	if err := s.stillReady(r.Context(), ds); err != nil {
		return err
	}
	if len(rows) == 0 {
		return fail(http.StatusNotFound, "TRANSACTION_NOT_FOUND", "이 데이터셋 범위에서 해당 거래를 찾지 못했습니다.")
	}
	m := datasetMeta(ds)
	m.Conditions = struct {
		TxHash string `json:"txHash"`
	}{hash}
	writeData(w, rows, m)
	return nil
}

// cursor는 "어디까지 받았는지"를 담은 값이다. 클라이언트는 내용을 몰라도 되고 그대로 돌려보내면 된다.
// 데이터셋·버전·조건 지문을 함께 넣어서, 다른 버전에 쓰면 409, 다른 조건에 쓰면 400으로 막는다.
type cursor struct {
	DatasetID string             `json:"d"`
	Version   string             `json:"v"`
	Query     string             `json:"q"`
	Block     domain.BlockNumber `json:"b"`
	Tx        uint32             `json:"t"`
	Log       uint32             `json:"l"`
	ID        string             `json:"i"`
}

// queryKey는 조건의 지문이다. 쪽 크기(limit)는 바꿔도 되므로 뺀다.
func queryKey(c transferConditions) string {
	c.Limit = 0
	b, _ := json.Marshal(c)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:8])
}

func encodeCursor(ds domain.Dataset, c transferConditions, last domain.Transfer) string {
	b, _ := json.Marshal(cursor{
		DatasetID: ds.ID, Version: ds.Version, Query: queryKey(c),
		Block: last.BlockNumber, Tx: last.TransactionIndex, Log: last.LogIndex, ID: last.ID,
	})
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw string, ds domain.Dataset, c transferConditions) (*repository.Cursor, error) {
	invalid := fail(http.StatusBadRequest, "INVALID_CURSOR", "커서 형식이 올바르지 않습니다. 첫 쪽부터 다시 요청해 주세요.")
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, invalid
	}
	var cur cursor
	if err := json.Unmarshal(b, &cur); err != nil || cur.ID == "" {
		return nil, invalid
	}
	if cur.DatasetID != ds.ID || cur.Version != ds.Version {
		return nil, fail(http.StatusConflict, "VERSION_MISMATCH", "다른 데이터셋 버전에서 받은 커서입니다. 첫 쪽부터 다시 요청해 주세요.")
	}
	if cur.Query != queryKey(c) {
		return nil, fail(http.StatusBadRequest, "INVALID_CURSOR", "다른 조건에서 받은 커서입니다. 첫 쪽부터 다시 요청해 주세요.")
	}
	return &repository.Cursor{
		Position: domain.Position{BlockNumber: cur.Block, TransactionIndex: cur.Tx, LogIndex: cur.Log},
		ID:       cur.ID,
	}, nil
}
