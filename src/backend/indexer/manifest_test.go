package indexer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

type manifestReaderStub struct {
	dataset    storage.Dataset
	boundaries []storage.BoundaryHash
	err        error
	gets       int
	reads      int
}

// GetDataset returns the configured publication row and records the read.
func (s *manifestReaderStub) GetDataset(context.Context, storage.DatasetKey) (storage.Dataset, error) {
	s.gets++
	if s.err != nil {
		return storage.Dataset{}, s.err
	}
	return s.dataset, nil
}

func (s *manifestReaderStub) CommittedBoundaries(context.Context, storage.DatasetKey) ([]storage.BoundaryHash, error) {
	s.reads++
	return append([]storage.BoundaryHash(nil), s.boundaries...), s.err
}

func readyManifestDataset() storage.Dataset {
	at := time.Date(2026, 10, 31, 4, 5, 6, 0, time.FixedZone("test", 9*60*60))
	return storage.Dataset{
		Spec: storage.DatasetSpec{
			Key:             storage.DatasetKey{ID: "base-usdc", Version: "v1"},
			SourceNamespace: "base-sepolia",
			Asset:           domain.Asset{ChainID: domain.ChainID, TokenAddress: "0x1111111111111111111111111111111111111111", Symbol: "USDC", Decimals: 6},
			Coverage:        domain.Coverage{StartBlock: 10, EndBlock: 20, StartTime: at.Add(-time.Hour), EndTime: at.Add(-time.Minute)},
			FinalizedBlock:  25,
		},
		Status:      domain.StatusReady,
		CollectedAt: &at,
	}
}

// TestManifestRoundTrip verifies required fields, decimal-string blocks, UTC timestamps and sanitized source.
func TestManifestRoundTrip(t *testing.T) {
	dataset := readyManifestDataset()
	boundaries := []storage.BoundaryHash{{BlockNumber: 15, BlockHash: "0x" + strings.Repeat("a", 64)}, {BlockNumber: 20, BlockHash: "0x" + strings.Repeat("b", 64)}}
	manifest, err := NewManifest(dataset, boundaries)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := WriteManifest(&output, manifest); err != nil {
		t.Fatal(err)
	}
	text := output.String()
	for _, forbidden := range []string{"http://", "https://", "password", "apiKey"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("manifest leaked %q: %s", forbidden, text)
		}
	}
	if !strings.Contains(text, `"finalizedBlock": "25"`) || !strings.Contains(text, `"blockNumber": "15"`) || !strings.Contains(text, `"name": "ethereum-json-rpc"`) {
		t.Fatalf("manifest JSON = %s", text)
	}
	var roundTrip Manifest
	if err := json.Unmarshal(output.Bytes(), &roundTrip); err != nil {
		t.Fatal(err)
	}
	if roundTrip.DatasetID != dataset.Spec.Key.ID || roundTrip.CollectedAt.Location() != time.UTC || len(roundTrip.BoundaryHashes) != 2 {
		t.Fatalf("round trip = %+v", roundTrip)
	}
}

// TestLoadManifestIsReadOnlyAndDeterministic verifies repeated READY exports use only read methods.
func TestLoadManifestIsReadOnlyAndDeterministic(t *testing.T) {
	dataset := readyManifestDataset()
	reader := &manifestReaderStub{dataset: dataset, boundaries: []storage.BoundaryHash{{BlockNumber: 20, BlockHash: "0x" + strings.Repeat("c", 64)}}}
	first, err := LoadManifest(context.Background(), reader, dataset.Spec.Key)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadManifest(context.Background(), reader, dataset.Spec.Key)
	if err != nil {
		t.Fatal(err)
	}
	var one, two bytes.Buffer
	_ = WriteManifest(&one, first)
	_ = WriteManifest(&two, second)
	if one.String() != two.String() || reader.gets != 2 || reader.reads != 2 {
		t.Fatalf("outputs differ or calls unexpected: gets=%d reads=%d", reader.gets, reader.reads)
	}
}

// TestLoadManifestRejectsMissingAndNonReadyDatasets covers publication prerequisites.
func TestLoadManifestRejectsMissingAndNonReadyDatasets(t *testing.T) {
	reader := &manifestReaderStub{err: storage.ErrNotFound}
	if _, err := LoadManifest(context.Background(), reader, storage.DatasetKey{}); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("missing error = %v", err)
	}
	dataset := readyManifestDataset()
	dataset.Status = domain.StatusFailed
	reader = &manifestReaderStub{dataset: dataset}
	if _, err := LoadManifest(context.Background(), reader, dataset.Spec.Key); err == nil || reader.reads != 0 {
		t.Fatalf("non-READY result = %v, reads=%d", err, reader.reads)
	}
}
