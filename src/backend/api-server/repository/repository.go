// Package repository는 API 서버가 데이터를 읽는 창구(Repository)를 정한다.
//
// 인터페이스는 담당 3이 정하고, 실제 DB 구현은 담당 1이 만든다.
// DB 구현이 나오기 전까지는 Fixture 파일을 메모리에 올리는 Memory로 개발·테스트한다.
// API 서버는 요청마다 체인(RPC)에 묻지 않고, 이미 수집된 데이터만 읽는다.
package repository

import (
	"context"
	"errors"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// ErrNotFound는 데이터셋이나 버전이 없을 때 돌려준다.
var ErrNotFound = errors.New("dataset not found")

// 주소 기준 방향(TransferQuery.Direction). 비우면 보낸 것·받은 것 모두다.
const (
	DirectionIncoming = "incoming" // Address가 받은 전송
	DirectionOutgoing = "outgoing" // Address가 보낸 전송
)

// Repository는 읽기 전용 저장소다. 모든 메서드는 ctx가 취소되면 바로 멈춰야 한다.
type Repository interface {
	// ListDatasets는 게시된 모든 데이터셋 버전을 돌려준다.
	ListDatasets(ctx context.Context) ([]domain.Dataset, error)
	// GetDataset은 id와 version이 모두 같은 한 버전을 돌려준다. 없으면 ErrNotFound를 돌려준다.
	GetDataset(ctx context.Context, id, version string) (domain.Dataset, error)
	// ListTransfers는 조건에 맞는 전송을 위치 순서로 Limit개까지 돌려준다.
	ListTransfers(ctx context.Context, q TransferQuery) (TransferPage, error)
}

// TransferQuery는 전송 목록 조건이다. 주소·해시는 소문자로 넘긴다.
type TransferQuery struct {
	DatasetID      string
	DatasetVersion string
	Address        string // 비우면 모든 주소
	Direction      string // Address가 있을 때만 쓴다. 비우면 양쪽 모두
	TxHash         string // 비우면 모든 거래
	StartBlock     *domain.BlockNumber
	EndBlock       *domain.BlockNumber
	StartTime      *time.Time
	EndTime        *time.Time
	MinAmountRaw   string
	After          *Cursor // 이 위치 다음부터 돌려준다(페이지 넘기기)
	Limit          int
}

// Cursor는 페이지를 이어 받을 위치다. 위치가 같은 전송은 ID로 순서를 정한다(domain.Less와 같은 규칙).
type Cursor struct {
	Position domain.Position
	ID       string
}

// TransferPage는 전송 목록 한 쪽이다. HasMore가 true면 조건에 맞는 전송이 더 있다.
type TransferPage struct {
	Transfers []domain.Transfer
	HasMore   bool
}
