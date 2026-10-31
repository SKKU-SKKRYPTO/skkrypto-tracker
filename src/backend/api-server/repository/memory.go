package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"math/big"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// Fixture는 데이터셋 한 버전과 그 전송을 담은 JSON 파일 모양이다(testdata/fixtures/*.json).
type Fixture struct {
	Dataset   domain.Dataset    `json:"dataset"`
	Transfers []domain.Transfer `json:"transfers"`
}

// Memory는 Fixture를 메모리에 올린 Repository다. 담당 1의 DB 저장소가 나오기 전 개발·테스트용이다.
type Memory struct {
	mu        sync.RWMutex
	datasets  []domain.Dataset
	transfers map[string][]domain.Transfer // datasetId@version → 위치 순 전송
}

var _ Repository = (*Memory)(nil)

// NewMemory는 Fixture를 검사한 뒤 메모리 저장소를 만든다.
// 형식이 틀린 데이터는 처음부터 받지 않아서, API가 이상한 값을 내보내지 않게 한다.
func NewMemory(fixtures ...Fixture) (*Memory, error) {
	m := &Memory{transfers: map[string][]domain.Transfer{}}
	for _, f := range fixtures {
		ds := f.Dataset
		k := key(ds.ID, ds.Version)
		if ds.ID == "" || ds.Version == "" {
			return nil, fmt.Errorf("fixture: datasetId and datasetVersion are required")
		}
		if _, dup := m.transfers[k]; dup {
			return nil, fmt.Errorf("fixture %s: duplicate dataset version", k)
		}
		rows := make([]domain.Transfer, len(f.Transfers))
		seen := map[string]bool{}
		for i, t := range f.Transfers {
			if err := checkTransfer(ds, t); err != nil {
				return nil, fmt.Errorf("fixture %s: transfer %q: %w", k, t.ID, err)
			}
			if seen[t.ID] {
				return nil, fmt.Errorf("fixture %s: duplicate transfer id %q", k, t.ID)
			}
			seen[t.ID] = true
			t.From = domain.NormalizeAddress(t.From)
			t.To = domain.NormalizeAddress(t.To)
			t.TxHash = strings.ToLower(t.TxHash)
			t.Timestamp = t.Timestamp.UTC()
			rows[i] = t
		}
		sort.Slice(rows, func(i, j int) bool { return domain.Less(rows[i], rows[j]) })
		m.datasets = append(m.datasets, ds)
		m.transfers[k] = rows
	}
	sort.Slice(m.datasets, func(i, j int) bool {
		a, b := m.datasets[i], m.datasets[j]
		if a.ID != b.ID {
			return a.ID < b.ID
		}
		return a.Version < b.Version
	})
	return m, nil
}

// LoadFixtureDir는 폴더 안의 *.json Fixture를 모두 읽는다.
func LoadFixtureDir(dir string) (*Memory, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no fixture files in %s", dir)
	}
	sort.Strings(files)
	fixtures := make([]Fixture, 0, len(files))
	for _, file := range files {
		b, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		var f Fixture
		if err := json.Unmarshal(b, &f); err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.Base(file), err)
		}
		fixtures = append(fixtures, f)
	}
	return NewMemory(fixtures...)
}

func checkTransfer(ds domain.Dataset, t domain.Transfer) error {
	switch {
	case !domain.ValidTransferID(ds.SourceMode, ds.SourceNamespace, t.ID):
		return fmt.Errorf("id does not match %s format", ds.SourceMode)
	case !t.Asset.Same(ds.Asset):
		return fmt.Errorf("asset differs from dataset")
	case !domain.ValidAddress(t.From) || !domain.ValidAddress(t.To):
		return fmt.Errorf("invalid address")
	case !domain.ValidHash(t.TxHash) || !domain.ValidHash(t.BlockHash):
		return fmt.Errorf("invalid hash")
	case t.TransferType != domain.TransferTypeOf(t.From, t.To):
		return fmt.Errorf("transferType does not match from/to")
	case t.BlockNumber < ds.StartBlock || t.BlockNumber > ds.EndBlock:
		return fmt.Errorf("block outside dataset range")
	}
	_, err := domain.ParseAmount(t.AmountRaw)
	return err
}

func key(id, version string) string { return id + "@" + version }

// SetStatus는 데이터셋 상태를 바꾼다. 분석 도중 무효화되는 상황을 테스트할 때 쓴다.
func (m *Memory) SetStatus(id, version, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.datasets {
		if m.datasets[i].ID == id && m.datasets[i].Version == version {
			m.datasets[i].Status = status
			return nil
		}
	}
	return ErrNotFound
}

func (m *Memory) ListDatasets(ctx context.Context) ([]domain.Dataset, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]domain.Dataset, len(m.datasets))
	for i, ds := range m.datasets {
		out[i] = clone(ds)
	}
	return out, nil
}

func (m *Memory) GetDataset(ctx context.Context, id, version string) (domain.Dataset, error) {
	if err := ctx.Err(); err != nil {
		return domain.Dataset{}, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, ds := range m.datasets {
		if ds.ID == id && ds.Version == version {
			return clone(ds), nil
		}
	}
	return domain.Dataset{}, ErrNotFound
}

func (m *Memory) ListTransfers(ctx context.Context, q TransferQuery) (TransferPage, error) {
	if err := ctx.Err(); err != nil {
		return TransferPage{}, err
	}
	m.mu.RLock()
	rows, ok := m.transfers[key(q.DatasetID, q.DatasetVersion)]
	m.mu.RUnlock()
	if !ok {
		return TransferPage{}, ErrNotFound
	}
	var minimum *big.Int
	if q.MinAmountRaw != "" {
		n, err := domain.ParseAmount(q.MinAmountRaw)
		if err != nil {
			return TransferPage{}, err
		}
		minimum = n
	}

	page := TransferPage{Transfers: []domain.Transfer{}}
	for _, t := range rows {
		if !matches(q, t, minimum) {
			continue
		}
		if len(page.Transfers) == q.Limit {
			page.HasMore = true
			break
		}
		page.Transfers = append(page.Transfers, t)
	}
	return page, ctx.Err()
}

func matches(q TransferQuery, t domain.Transfer, minimum *big.Int) bool {
	switch {
	case q.Address != "" && q.Direction == DirectionOutgoing && t.From != q.Address,
		q.Address != "" && q.Direction == DirectionIncoming && t.To != q.Address,
		q.Address != "" && q.Direction == "" && t.From != q.Address && t.To != q.Address,
		q.TxHash != "" && t.TxHash != q.TxHash,
		q.StartBlock != nil && t.BlockNumber < *q.StartBlock,
		q.EndBlock != nil && t.BlockNumber > *q.EndBlock,
		q.StartTime != nil && t.Timestamp.Before(*q.StartTime),
		q.EndTime != nil && t.Timestamp.After(*q.EndTime):
		return false
	}
	if q.After != nil {
		c := domain.ComparePosition(t.Position(), q.After.Position)
		if c < 0 || (c == 0 && t.ID <= q.After.ID) {
			return false
		}
	}
	if minimum != nil {
		amount, _ := domain.ParseAmount(t.AmountRaw) // NewMemory에서 이미 검사했다
		return amount.Cmp(minimum) >= 0
	}
	return true
}

// clone은 map·slice까지 복사한다. 호출한 쪽이 고쳐도 저장소 안의 값은 그대로다.
func clone(ds domain.Dataset) domain.Dataset {
	ds.BoundaryHashes = maps.Clone(ds.BoundaryHashes)
	ds.Labels = maps.Clone(ds.Labels)
	ds.Notes = slices.Clone(ds.Notes)
	return ds
}
