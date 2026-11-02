package indexer

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/indexer/storage"
)

// ManifestSource identifies the public source kind without exposing an RPC endpoint.
type ManifestSource struct {
	Name    string `json:"name"`
	ChainID uint64 `json:"chainId"`
}

// ManifestBoundary records one committed chunk boundary in collection order.
type ManifestBoundary struct {
	BlockNumber domain.BlockNumber `json:"blockNumber"`
	BlockHash   string             `json:"blockHash"`
}

// Manifest is the reproducible public description of one published Snapshot Dataset.
type Manifest struct {
	DatasetID       string             `json:"datasetId"`
	DatasetVersion  string             `json:"datasetVersion"`
	SourceMode      string             `json:"sourceMode"`
	SourceNamespace string             `json:"sourceNamespace"`
	Asset           domain.Asset       `json:"asset"`
	Coverage        domain.Coverage    `json:"coverage"`
	FinalizedBlock  domain.BlockNumber `json:"finalizedBlock"`
	CollectedAt     time.Time          `json:"collectedAt"`
	BoundaryHashes  []ManifestBoundary `json:"boundaryHashes"`
	Source          ManifestSource     `json:"source"`
}

// ManifestReader is the read-only storage surface required to regenerate a Manifest.
type ManifestReader interface {
	GetDataset(context.Context, storage.DatasetKey) (storage.Dataset, error)
	CommittedBoundaries(context.Context, storage.DatasetKey) ([]storage.BoundaryHash, error)
}

// LoadManifest reads a READY Dataset and its ordered committed boundaries without mutation.
func LoadManifest(ctx context.Context, reader ManifestReader, key storage.DatasetKey) (Manifest, error) {
	if reader == nil {
		return Manifest{}, errors.New("manifest reader is required")
	}
	dataset, err := reader.GetDataset(ctx, key)
	if err != nil {
		return Manifest{}, err
	}
	if dataset.Status != domain.StatusReady || dataset.CollectedAt == nil {
		return Manifest{}, errors.New("manifest requires a READY dataset")
	}
	boundaries, err := reader.CommittedBoundaries(ctx, key)
	if err != nil {
		return Manifest{}, err
	}
	return NewManifest(dataset, boundaries)
}

// NewManifest validates persisted publication metadata and builds a public-safe value.
func NewManifest(dataset storage.Dataset, boundaries []storage.BoundaryHash) (Manifest, error) {
	if dataset.Status != domain.StatusReady || dataset.CollectedAt == nil || dataset.CollectedAt.IsZero() {
		return Manifest{}, errors.New("manifest requires a READY dataset with collectedAt")
	}
	if len(boundaries) == 0 {
		return Manifest{}, errors.New("manifest requires committed boundaries")
	}
	result := Manifest{
		DatasetID:       dataset.Spec.Key.ID,
		DatasetVersion:  dataset.Spec.Key.Version,
		SourceMode:      domain.SourceSnapshot,
		SourceNamespace: dataset.Spec.SourceNamespace,
		Asset:           dataset.Spec.Asset,
		Coverage: domain.Coverage{
			StartBlock: dataset.Spec.Coverage.StartBlock,
			EndBlock:   dataset.Spec.Coverage.EndBlock,
			StartTime:  dataset.Spec.Coverage.StartTime.UTC(),
			EndTime:    dataset.Spec.Coverage.EndTime.UTC(),
		},
		FinalizedBlock: dataset.Spec.FinalizedBlock,
		CollectedAt:    dataset.CollectedAt.UTC(),
		BoundaryHashes: make([]ManifestBoundary, len(boundaries)),
		Source:         ManifestSource{Name: "ethereum-json-rpc", ChainID: dataset.Spec.Asset.ChainID},
	}
	var previous domain.BlockNumber
	for i, boundary := range boundaries {
		hash := strings.ToLower(boundary.BlockHash)
		if !domain.ValidHash(hash) || boundary.BlockNumber < dataset.Spec.Coverage.StartBlock || boundary.BlockNumber > dataset.Spec.Coverage.EndBlock || (i > 0 && boundary.BlockNumber <= previous) {
			return Manifest{}, errors.New("manifest boundaries are invalid or unordered")
		}
		result.BoundaryHashes[i] = ManifestBoundary{BlockNumber: boundary.BlockNumber, BlockHash: hash}
		previous = boundary.BlockNumber
	}
	if previous != dataset.Spec.Coverage.EndBlock {
		return Manifest{}, errors.New("manifest boundaries do not cover the dataset end")
	}
	return result, nil
}

// WriteManifest writes exactly one indented JSON document and a trailing newline.
func WriteManifest(writer io.Writer, manifest Manifest) error {
	if writer == nil {
		return errors.New("manifest writer is required")
	}
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(manifest)
}
