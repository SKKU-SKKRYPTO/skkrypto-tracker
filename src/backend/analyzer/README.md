# 분석 엔진 (담당 2)

API 서버가 넘겨준 전송 목록만 보고 **시간순 연결(Trace·Paths)** 과 **분산·합류 패턴(Patterns)** 을 계산합니다. 엔진은 DB·RPC·HTTP를 모릅니다. 그래서 같은 입력이면 언제 돌려도 같은 결과가 나오고, 작은 가짜 데이터만으로 테스트할 수 있습니다.

```go
type Engine interface {
	Trace(ctx, Request, Input) (Result, error)    // 시작 주소에서 1~3 hop 안에 닿는 전송
	Paths(ctx, Request, Input) (Result, error)    // 시작 주소 → 대상 주소 후보 경로
	Patterns(ctx, Request, Input) (Result, error) // 분산(FAN_OUT)·합류(FAN_IN)
}
```

| 파일 | 내용 |
|---|---|
| `engine.go` | 인터페이스와 입출력 타입 |
| `request.go` | 조건 확인·기본값(`Normalize`), 상한 |
| `candidates.go` | 입력을 분석 후보로 다듬기 |
| `run.go` | 상한 세기, 근거 모으기, 결과 만들기 |
| `trace.go` | BFS 탐색(Trace·Paths 공통) |
| `paths.go` | 경로 정렬·ID |
| `patterns.go` | 600초 창 패턴 |

## 1. 후보 다듬기

- 위치 순서 `(blockNumber, transactionIndex, logIndex)`로 정렬하고, 같은 ID는 한 번만 씁니다.
- 블록·시간·최소 금액 필터를 적용합니다.
- **빼는 것:** 0 금액, 발행(from이 0 주소)·소각(to가 0 주소), 자기 자신에게 보낸 전송. 주소 사이의 돈 이동이 아니기 때문입니다. 원본 조회 API(`/api/transfers`)에는 그대로 나옵니다.
- 모든 전송이 같은 자산(체인·토큰)이어야 합니다. 다른 토큰끼리 경로로 이어지지 않도록, 섞여 들어오면 오류로 돌려줍니다.
- 후보가 `maxCandidates`(기본·최대 10,000)를 넘으면 이른 위치부터 쓰고 `CANDIDATE_LIMIT`을 남깁니다. 실제로 분석한 마지막 전송의 블록·시각은 `analyzedUntil`에 적습니다.

## 2. 시간순 연결 규칙(Trace·Paths)

- 주소에서 시작하면 0 hop, **선택한 전송에서 시작하면 그 전송이 1 hop**입니다.
- `outgoing`은 다음 전송이 앞 전송보다 **엄격히 뒤**, `incoming`은 **엄격히 앞**이어야 합니다. 위치가 완전히 같으면 앞뒤를 알 수 없어서 잇지 않습니다. 같은 거래 안에서는 로그 순서(logIndex)로 앞뒤를 정합니다.
- **한 경로 안에서 같은 주소를 두 번 지나지 않습니다.** A→B→A처럼 되돌아오는 전송은 그 경로에 넣지 않습니다. 방문 표시는 경로마다 따로 해서, 다른 경로가 지난 주소는 다시 지날 수 있습니다.
- Paths는 대상 주소에 닿는 순간 경로로 기록하고 더 가지 않습니다.
- 결과 정렬: hop이 적은 순, 같으면 전송 위치가 이른 순. 경로 ID는 전송 ID들의 해시라 같은 경로는 언제나 같은 ID입니다. `maxPaths`를 넘으면 이 순서의 앞 경로를 남깁니다(incoming으로 찾을 때도 같습니다).
- 경로의 `transferIds`는 방향과 상관없이 **돈이 흐른 시간순**입니다. `incoming`은 시작 주소에서 거꾸로 찾지만 결과는 뒤집어서 주므로, 같은 경로는 어느 방향으로 찾아도 ID가 같습니다.
- 합계(`summary`)는 근거 전송을 한 번씩만 셉니다. 두 경로가 같은 전송을 지나도 두 번 더하지 않습니다.

### 왜 DFS가 아니라 BFS인가

1차 회의에서는 DFS(깊이 우선)를 예로 들었지만, 기획안대로 BFS(너비 우선)로 만들었습니다.

| | BFS(사용) | DFS |
|---|---|---|
| 순서 | 1 hop을 모두 본 뒤 2 hop, 그다음 3 hop | 한 갈래를 3 hop까지 파고든 뒤 되돌아옴 |
| 상한에 걸려 멈추면 | 가까운 연결이 먼저 남는다 | 멈춘 시점에 따라 먼 경로만 남고 가까운 경로가 빠질 수 있다 |
| "몇 hop 만에 닿나" | 찾은 순서가 곧 짧은 순서 | 다 찾은 뒤 다시 정렬해야 함 |

무한 반복은 두 규칙으로 막습니다. ① 다음 전송은 시간상 엄격히 뒤여야 하고 ② 한 경로에서 같은 주소를 다시 지나지 않습니다. 여기에 `maxDepth`(최대 3)와 `maxStates`(최대 10,000)가 한 번 더 막습니다.

## 3. 상한과 잘림

| 상한 | 기본·최대 | 넘으면 |
|---|---|---|
| `maxNodes` | 200 | `NODE_LIMIT` |
| `maxEdges` | 500 | `EDGE_LIMIT` |
| `maxPaths` | 10 | `PATH_LIMIT` |
| `maxStates` | 10,000 | `STATE_LIMIT` |
| `maxCandidates` | 10,000 | `CANDIDATE_LIMIT`(멈추지 않고 앞쪽 후보로 계속 분석) |
| `timeBudgetMs` | 기본 1,500 / 최대 2,000 | `TIME_BUDGET` |

- 잘리면 오류가 아니라 **부분 결과**입니다. `truncated.reason`에 대표 사유(탐색을 멈춘 사유), `truncated.reasons`에 함께 생긴 사유가 있습니다. 상한에 걸리지 않았으면 `truncated: null`입니다.
- **found:** 탐색을 중간에 멈췄거나(`STATE_LIMIT`·`TIME_BUDGET`, Trace·Patterns의 `NODE_LIMIT`·`EDGE_LIMIT`) 후보가 잘렸으면(`CANDIDATE_LIMIT`) `foundIsLowerBound: true`, 즉 "최소 이만큼"입니다. 경로가 `maxPaths`보다 많기만 하면(`PATH_LIMIT`) 정렬 순서의 앞 10개만 돌려주고 나머지는 끝까지 세서 found가 정확합니다.
- **Paths의 근거 상한:** Paths는 경로를 끝까지 찾은 뒤 정렬 순서대로 근거 전송을 넣습니다. 근거가 노드·엣지 상한에 걸리면 그 뒤 경로를 결과에서 빼고 사유(`NODE_LIMIT`·`EDGE_LIMIT`)를 남기지만, 탐색은 끝났으므로 found는 정확합니다(`foundIsLowerBound: false`).
- 큐가 `maxStates`로 차면 새 상태만 더 넣지 않고, 이미 큐에 있는 상태는 끝까지 처리한 뒤 `STATE_LIMIT`으로 멈춥니다. 그래서 상한에 걸려도 같은 hop의 짧은 경로를 잃지 않고, `maxDepth` 3이 2보다 결과가 적게 나오는 일이 없습니다.
- 요청 취소는 잘림이 아니라 오류입니다.
- 경로·패턴 하나의 근거 전송은 **한꺼번에** 넣습니다. 노드·엣지 상한을 넘으면 하나도 넣지 않아서, 결과의 경로는 늘 근거 전송을 모두 갖고 있습니다.
- 성능 기준: 전송 1만 건·주소 200개·3 hop에서 Paths·Trace·Patterns가 모두 수십 ms 안에 끝납니다(`TestTenThousandTransfersStayWithinLimits`).

## 4. 패턴 규칙(flow-v1)

- **FAN_OUT(분산):** 시작 주소가 짧은 시간에 여러 주소로 보냄. **FAN_IN(합류):** 여러 주소가 시작 주소로 보냄. 요청에 `direction`을 주면 그 방향의 규칙만(outgoing → FAN_OUT, incoming → FAN_IN), 비우면 둘 다 봅니다.
- 시각은 `block.timestamp`(초) 기준입니다. 같은 블록의 전송은 같은 시각이라 같은 창에 함께 들어갑니다.
- 전송마다 그 시각에서 시작하는 **600초 반열린 창** `[t, t+600초)`을 만듭니다. 599초 뒤 전송은 들어가고 600초 뒤 전송은 들어가지 않습니다.
- 창 안에 **서로 다른 상대 주소가 3개 이상**이면 패턴입니다. 같은 상대에게 여러 번 보내도 1개로 셉니다.
- 앞 창의 부분집합인 창은 버립니다. 겹치는 창은 합치지 않고 같은 `groupId`로 묶습니다.
- 결과 필드: `patternId` = `{ruleId}:{address}:{direction}:{첫 근거 전송 ID}`, `ruleId`·`ruleVersion`, `asset`, 창(`windowStart`·`windowEnd`·`windowSeconds`), `threshold`, 고유 상대 수(`uniqueCounterparties`)와 목록, 근거 전송 ID, `groupId`, `incomplete`.
- **incomplete:** 창이 관측 범위 시작 600초 안에서 시작하거나, 창 끝이 관측 범위 끝을 넘으면 true입니다. 범위 밖 거래는 "없음"이 아니라 "모름"이기 때문입니다.
  - 관측 범위 = 데이터셋 수집 범위 ∩ 시간 필터. 블록 필터나 후보 상한으로 범위가 줄었으면 경계 블록의 시각을 모르므로, 실제로 본 첫·마지막 전송 시각까지로 좁혀 잡습니다(잘린 창을 완전하다고 표시하지 않는 쪽).

## 5. 결과를 어떻게 읽어야 하나(한계)

- 후보 경로는 "시간 순서로 이어질 수 있는 전송"일 뿐, **같은 돈이라는 확정이 아닙니다.** 토큰은 섞이면 구분할 수 없습니다.
- 패턴은 **규칙에 맞는 모양**일 뿐, 주인이 같다거나 불법이라는 판단이 아닙니다.
- 지정한 데이터셋의 고정 범위만 봅니다. 범위 밖이나 다른 토큰·체인의 이동은 보이지 않습니다.
- 이 문장들은 API 응답 `meta.limitations`에도 실려 화면에 함께 나옵니다.

## 테스트

```bash
go -C src/backend test ./analyzer/...
```

1차 회의에서 정한 예시가 그대로 들어 있습니다.

| 회의록 예시 | 테스트 |
|---|---|
| 작은 가짜 그래프(A→B→C)에서 예상 경로가 나오는지 | `TestPathsFindsABC` |
| A→B→A처럼 돌아오는 경우 무한 반복하지 않는지 | `TestCycleDoesNotLoopForever` |

그 밖에 시간 역순 미끼(e8), 같은 위치 전송, 상한 6종, 상태 상한에서도 짧은 경로 유지, 경로 12개 중 상위 10개 고정·반복 실행 순서, incoming 경로의 시간순, incoming 경로 상한에서도 정렬 순서 앞 경로 유지, 근거만 잘린 Paths의 정확한 found, 다른 토큰 거부, 후보 잘림 위치(analyzedUntil), 시간 예산, 취소, 600초 경계(599/600), 같은 시각 전송, 부분집합 창, 방향별 패턴, incomplete(수집 범위·블록 필터·후보 상한)를 확인합니다.
