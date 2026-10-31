package analyzer

import (
	"context"
	"slices"
	"sort"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// Trace는 시작 주소에서 maxDepth hop 안에 시간순으로 닿는 전송을 모두 모은다.
// found는 결과 전송 수다.
func (a *Analyzer) Trace(ctx context.Context, req Request, in Input) (Result, error) {
	r, candidates, err := a.begin(ctx, KindTrace, req, in)
	if err != nil {
		return Result{}, err
	}
	if err := r.traverse(candidates, false); err != nil {
		return Result{}, err
	}
	return r.result(len(r.edges), nil), nil
}

// step은 BFS 큐에 들어가는 탐색 상태 하나다: 지금 도착한 주소와 거기까지 지나온 전송.
type step struct {
	address string
	path    []domain.Transfer
}

// traverse는 시작 주소에서 너비 우선 탐색(BFS)으로 hop을 하나씩 늘려 간다.
//
// BFS를 쓰는 이유: 1 hop을 모두 본 다음 2 hop, 그다음 3 hop을 본다. 그래서 상한에 걸려
// 중간에 멈춰도 가까운 연결이 먼저 남는다. DFS는 한 갈래를 끝까지 파고들어서, 멈추는
// 시점에 따라 먼 경로만 남고 가까운 경로가 빠질 수 있다.
//
// 규칙
//   - 주소에서 시작하면 0 hop, 선택한 전송에서 시작하면 그 전송이 1 hop이다.
//   - outgoing은 다음 전송이 앞 전송보다 엄격히 뒤(위치 비교)여야 하고, incoming은 엄격히 앞이어야 한다.
//   - 한 경로 안에서 같은 주소를 두 번 지나지 않는다(A→B→A 같은 되돌아오기 금지).
//     방문 표시는 경로마다 따로 한다. 다른 경로가 지난 주소는 다시 지나도 된다.
//   - findPaths면 대상 주소에 닿는 순간 경로로 기록하고, 닿은 뒤에는 더 가지 않는다.
//   - 같은 hop 안에서는 위치 순으로 넓힌다. 예산에 걸려 멈춰도 짧고 이른 경로가 먼저 남는다.
//   - 마지막 hop에 닿은 상태는 더 갈 곳이 없으니 큐에 넣지 않는다(상태 상한을 아낀다).
//   - 큐가 maxStates개로 차면 새 상태만 더 넣지 않는다. 이미 큐에 있는 상태는 끝까지 처리해서
//     같은 hop의 남은 짧은 경로를 잃지 않고, 다 처리한 뒤 STATE_LIMIT으로 멈춘다.
func (r *run) traverse(candidates []domain.Transfer, findPaths bool) error {
	incoming := r.req.Direction == DirectionIncoming
	next := map[string][]domain.Transfer{} // 주소 → 그 주소에서 이어지는 전송(위치 순)
	for _, t := range candidates {
		from, _ := ends(t, incoming)
		next[from] = append(next[from], t)
	}

	queue := []step{{address: r.req.Address}}
	if r.req.StartTransferID != "" {
		i := slices.IndexFunc(candidates, func(t domain.Transfer) bool { return t.ID == r.req.StartTransferID })
		if i < 0 {
			if r.status.Truncated != nil {
				return nil // 후보가 잘려서 빠졌을 수 있다. 없다고 단정하지 않는다
			}
			return invalid("선택한 시작 전송(startTransferId)이 분석 범위에 없습니다.")
		}
		seed := candidates[i]
		from, to := ends(seed, incoming)
		if from != r.req.Address {
			return invalid("선택한 시작 전송이 시작 주소와 방향에 맞지 않습니다.")
		}
		seedPath := []domain.Transfer{seed}
		switch {
		case findPaths && to == r.req.TargetAddress:
			r.recordPath(seedPath)
			return nil
		case !findPaths && !r.addEvidence(seed):
			return nil
		}
		queue = []step{{address: to, path: seedPath}}
	}

	full := false // 큐가 상태 상한에 찼다
	for i := 0; i < len(queue); i++ {
		ok, err := r.nextState()
		if err != nil {
			return err
		}
		if !ok {
			break
		}
		s := queue[i]
		if len(s.path) == r.req.MaxDepth {
			continue
		}
		for _, t := range next[s.address] {
			if err := r.check(); err != nil {
				return err
			}
			if r.stopped {
				break
			}
			if len(s.path) > 0 && !inOrder(s.path[len(s.path)-1], t, incoming) {
				continue
			}
			_, to := ends(t, incoming)
			if onPath(r.req.Address, s.path, to, incoming) {
				continue
			}
			path := append(slices.Clone(s.path), t)
			if findPaths && to == r.req.TargetAddress {
				r.recordPath(path)
				continue
			}
			if !findPaths && !r.addEvidence(t) {
				break
			}
			if len(path) == r.req.MaxDepth {
				continue
			}
			if len(queue) == r.req.Limits.MaxStates {
				full = true
				continue
			}
			queue = append(queue, step{address: to, path: path})
		}
		if r.stopped {
			break
		}
	}
	if full && !r.stopped {
		r.truncate(ReasonStateLimit)
	}
	return nil
}

// recordPath는 대상에 닿은 경로를 센다. 정렬 순서(lessPath)로 앞선 maxPaths개만 남기고,
// 나머지는 개수만 세서 found를 정확하게 한다.
// incoming은 대상 쪽부터 거꾸로 찾아서 찾는 순서가 정렬 순서와 다르다. 그래서 찾은 순서로 자르지 않고,
// 돈이 흐른 순서로 뒤집은 경로를 정렬 위치에 넣은 뒤 넘치면 맨 뒤를 뺀다.
// 근거 전송은 탐색이 끝난 뒤 Paths에서 남은 경로 것만 넣는다. 중간에 밀려난 경로의 전송이 섞이지 않게 하려는 것이다.
func (r *run) recordPath(path []domain.Transfer) {
	r.pathCount++
	if r.req.Direction == DirectionIncoming {
		path = slices.Clone(path)
		slices.Reverse(path)
	}
	i := sort.Search(len(r.found), func(k int) bool { return lessPath(path, r.found[k]) })
	if len(r.found) == r.req.Limits.MaxPaths {
		r.flag(ReasonPathLimit)
		if i == len(r.found) {
			return
		}
		r.found = r.found[:len(r.found)-1]
	}
	r.found = slices.Insert(r.found, i, path)
}

// ends는 탐색 방향 기준으로 전송의 출발·도착 주소를 돌려준다.
func ends(t domain.Transfer, incoming bool) (from, to string) {
	if incoming {
		return t.To, t.From
	}
	return t.From, t.To
}

// inOrder는 prev 다음 hop으로 t를 이을 수 있는지 본다. 위치가 같으면 잇지 않는다.
func inOrder(prev, t domain.Transfer, incoming bool) bool {
	c := domain.ComparePosition(t.Position(), prev.Position())
	if incoming {
		return c < 0
	}
	return c > 0
}

// onPath는 주소가 이미 이 경로에 있는지 본다.
func onPath(start string, path []domain.Transfer, address string, incoming bool) bool {
	if address == start {
		return true
	}
	for _, t := range path {
		if _, to := ends(t, incoming); to == address {
			return true
		}
	}
	return false
}
