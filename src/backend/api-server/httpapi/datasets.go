package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/repository"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// GET /api/datasets
func (s *server) listDatasets(w http.ResponseWriter, r *http.Request) error {
	if err := onlyParams(r); err != nil {
		return err
	}
	rows, err := s.repo.ListDatasets(r.Context())
	if err != nil {
		return err
	}
	out := make([]domain.Dataset, len(rows))
	for i, ds := range rows {
		out[i] = tidy(ds)
	}
	writeData(w, out, baseMeta())
	return nil
}

// GET /api/datasets/{id}?datasetVersion=
func (s *server) getDataset(w http.ResponseWriter, r *http.Request) error {
	if err := onlyParams(r, "datasetVersion"); err != nil {
		return err
	}
	// 기획안: 지정한 버전의 상태를 돌려준다. 버전 목록은 GET /api/datasets에 있다.
	version := r.URL.Query().Get("datasetVersion")
	if version == "" {
		return badInput("datasetVersion이 필요합니다. 버전 목록은 GET /api/datasets에서 볼 수 있습니다.")
	}
	ds, err := s.dataset(r.Context(), chi.URLParam(r, "id"), version, false)
	if err != nil {
		return err
	}
	writeData(w, ds, datasetMeta(ds))
	return nil
}

// dataset은 데이터셋 한 버전을 읽는다. ready면 분석·조회할 수 있는 상태(READY)인지도 본다.
func (s *server) dataset(ctx context.Context, id, version string, ready bool) (domain.Dataset, error) {
	if id == "" {
		return domain.Dataset{}, badInput("datasetId가 필요합니다.")
	}
	ds, err := s.repo.GetDataset(ctx, id, version)
	if errors.Is(err, repository.ErrNotFound) {
		return ds, fail(http.StatusNotFound, "DATASET_NOT_FOUND", "해당 데이터셋 또는 버전이 없습니다.")
	}
	if err != nil {
		return ds, err
	}
	if ready {
		switch ds.Status {
		case domain.StatusReady:
		case domain.StatusInvalidated:
			return ds, fail(http.StatusConflict, "DATASET_INVALIDATED", "무효화된 데이터셋 버전입니다. 다른 버전을 선택해 주세요.")
		default:
			return ds, fail(http.StatusConflict, "DATASET_NOT_READY", "데이터셋 수집이 끝나지 않았습니다.")
		}
	}
	return tidy(ds), nil
}

// readyDataset은 조회·분석용이다. 결과를 재현할 수 있도록 버전까지 꼭 받는다.
func (s *server) readyDataset(ctx context.Context, id, version string) (domain.Dataset, error) {
	if id == "" || version == "" {
		return domain.Dataset{}, badInput("datasetId와 datasetVersion이 필요합니다.")
	}
	return s.dataset(ctx, id, version, true)
}

// stillReady는 응답 직전에 데이터셋을 다시 확인한다. 처리하는 사이 무효화됐으면 결과를 버린다.
func (s *server) stillReady(ctx context.Context, ds domain.Dataset) error {
	_, err := s.dataset(ctx, ds.ID, ds.Version, true)
	return err
}

// tidy는 빈 map·slice를 null 대신 {}·[]로 내보내고 시각을 UTC로 맞춘다.
func tidy(ds domain.Dataset) domain.Dataset {
	if ds.BoundaryHashes == nil {
		ds.BoundaryHashes = map[string]string{}
	}
	if ds.Labels == nil {
		ds.Labels = map[string]string{}
	}
	if ds.Notes == nil {
		ds.Notes = []string{}
	}
	ds.StartTime = ds.StartTime.UTC()
	ds.EndTime = ds.EndTime.UTC()
	ds.CollectedAt = ds.CollectedAt.UTC()
	return ds
}
