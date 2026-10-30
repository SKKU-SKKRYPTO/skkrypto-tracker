package analyzer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// Paths는 시작 주소에서 대상 주소까지 maxDepth hop 안의 시간순 후보 경로를 찾는다.
// found는 찾은 경로 수이고, 결과에는 hop이 적은 순·같으면 전송 위치가 이른 순으로 maxPaths개까지 넣는다.
func (a *Analyzer) Paths(ctx context.Context, req Request, in Input) (Result, error) {
	r, candidates, err := a.begin(ctx, KindPaths, req, in)
	if err != nil {
		return Result{}, err
	}
	if err := r.traverse(candidates, true); err != nil {
		return Result{}, err
	}
	// r.found는 recordPath가 이미 돈이 흐른 순서로 뒤집어 정렬해 두었다.
	// 근거 전송은 남은 경로 것만 이 순서대로 넣고, 노드·간선 상한에 걸리면 그 뒤 경로는 뺀다.
	paths := make([]Path, 0, len(r.found))
	for _, p := range r.found {
		if !r.addEvidence(p...) {
			break
		}
		paths = append(paths, newPath(p))
	}
	return r.result(r.pathCount, paths), nil
}

func lessPath(a, b []domain.Transfer) bool {
	if len(a) != len(b) {
		return len(a) < len(b)
	}
	for k := range a {
		if a[k].ID != b[k].ID {
			return domain.Less(a[k], b[k])
		}
	}
	return false
}

// newPath의 ID는 전송 ID들로 만든 해시다. 같은 경로는 언제 찾아도 같은 ID를 갖는다.
func newPath(ts []domain.Transfer) Path {
	ids := make([]string, len(ts))
	for i, t := range ts {
		ids[i] = t.ID
	}
	sum := sha256.Sum256([]byte(strings.Join(ids, "\n")))
	return Path{ID: "path-" + hex.EncodeToString(sum[:8]), TransferIDs: ids, Hops: len(ids)}
}
