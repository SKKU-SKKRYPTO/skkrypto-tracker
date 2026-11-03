# API 가이드

웹에서 API를 부르는 순서와 응답을 화면에 보여 줄 때 지킬 점을 정리했습니다. 필드 하나하나의 정의는 `openapi.json`, 실제 응답 예시는 `contracts/samples/`를 봅니다.

## 1. 기본 모양

모든 응답은 같은 모양입니다.

```json
{ "data": { }, "meta": { }, "error": null }
```

- 정상이면 `error: null`, 오류면 `data: null`과 `error: { code, message, retryable }`.
- `error.message`는 화면에 그대로 보여 줘도 되는 한국어 문장입니다.
- `meta.limitations`(해석 한계 문구)는 결과 화면에 함께 보여 줍니다.

## 2. 부르는 순서

1. `GET /api/datasets` → `status`가 `READY`인 데이터셋을 고릅니다. `datasetId`와 `datasetVersion`을 함께 기억합니다.
2. 사용자가 주소를 넣으면 `POST /api/trace`(어디로 이어지나) 또는 `POST /api/paths`(두 주소 사이)를 부릅니다.
3. 그래프의 선(전송)을 누르면 `GET /api/transactions/{txHash}`로 같은 거래의 전송을 보여 줍니다.
4. 표 화면은 `GET /api/transfers`로 쪽을 넘깁니다. 다음 쪽은 `meta.page.nextCursor`를 `cursor`로 그대로 넘깁니다.

```bash
curl -s -X POST localhost:8080/api/trace \
  -H 'Content-Type: application/json' \
  -d '{"datasetId":"flow-demo","datasetVersion":"v1","address":"0x0000000000000000000000000000000000000001","maxDepth":2}'
```

## 3. 숫자와 시각

- `amountRaw`, `blockNumber`, `startBlock` 같은 큰 정수는 **문자열**입니다. 자바스크립트 `Number`로 바꾸지 말고, 계산이 필요하면 `BigInt`를 씁니다.
- 화면 금액 = `amountRaw ÷ 10^decimals`. 예: `"120000"`, decimals 2 → 1,200.00 SKK.
- 시각은 UTC(`Z`)입니다. 화면에서 한국 시각으로 바꿔 보여 줍니다.
- 데이터셋의 `finalizedBlock`은 FIXTURE면, `collectedAt`은 READY가 아니면 `null`일 수 있습니다.

## 4. 결과 그리기

- `data.nodes`가 점, `data.transfers`가 선입니다. 선은 `from` → `to`.
- `data.paths[].transferIds`의 순서가 경로 순서입니다. 같은 전송이 여러 경로에 나올 수 있습니다.
- 노드 `label`이 있으면 이름을, 없으면 주소 앞뒤 몇 자리를 보여 줍니다.
- 합계는 `data.summary`를 씁니다. 경로마다 더하면 같은 전송을 두 번 셀 수 있습니다. 합계 `uniqueAmountRaw`는 여러 전송을 더한 값이라 uint256 최대값을 넘을 수 있으니 `BigInt`로 다룹니다.

## 5. 0건과 부분 결과

| 상황 | 응답 | 화면에서 |
|---|---|---|
| 0건 | 200, 빈 배열 | "선택한 수집 범위에서 관측되지 않음" (없다고 단정하지 않기) |
| 부분 결과 | 200, `meta.limits.truncated.reason` | "상한에 걸려 일부만 표시" + 사유 설명. `foundIsLowerBound`가 true면 "최소 N건", false면 "전체 N건 중 일부" |
| 후보 잘림 `CANDIDATE_LIMIT` | 200, `meta.limits.analyzedUntil` | "블록 N(시각)까지만 분석함" + 범위를 좁혀 다시 보기 |
| 패턴 `incomplete: true` | 200 | "관측 범위 경계라 일부 거래를 모를 수 있음" |

`truncated.reason` 뜻: `PATH_LIMIT` 경로 수, `NODE_LIMIT` 주소 수, `EDGE_LIMIT` 전송 수, `STATE_LIMIT` 탐색량, `CANDIDATE_LIMIT` 후보 수, `TIME_BUDGET` 시간.

## 6. 오류 처리

| 상태 | 코드 | 화면에서 |
|---|---|---|
| 400 | `INVALID_INPUT`, `INVALID_CURSOR` | 입력칸 옆에 `message` 표시. 커서 오류는 첫 쪽부터 다시 |
| 404 | `DATASET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `NOT_FOUND` | 목록으로 돌아가기. `NOT_FOUND`는 없는 API 주소라 웹의 요청 경로를 확인 |
| 405 | `METHOD_NOT_ALLOWED` | 웹의 요청 방식(GET·POST)을 확인 |
| 409 | `DATASET_NOT_READY`, `DATASET_INVALIDATED`, `VERSION_MISMATCH` | 다른 버전 선택 안내, 커서는 첫 쪽부터 다시 |
| 422 | `OUT_OF_RANGE`, `UNSUPPORTED_ASSET` | 수집 범위(`message`에 있음)를 보여 주고 다시 입력 |
| 429 | `RATE_LIMITED` | `Retry-After` 초만큼 기다렸다가 다시 |
| 503 | `UNAVAILABLE`, `REQUEST_TIMEOUT`, `INVALID_DATA` | `retryable`이 true면 "다시 시도" 버튼 |

## 7. 붙여 보기

- `make run-api`로 API를 띄우면 `http://localhost:5173`(Vite 기본 주소)에서 바로 부를 수 있습니다(CORS 허용).
- 다른 주소를 쓰면 `CORS_ALLOWED_ORIGINS`에 추가합니다.
- 레포 루트에서 `docker compose up --build -d`로 띄우면 `http://localhost:8081`의 Swagger UI에서 Try it out으로 요청해 볼 수 있습니다.
- 배포된 API는 `https://api-production-965fc.up.railway.app`입니다. 웹에서는 `VITE_API_BASE_URL`에 이 주소를 넣습니다. CORS는 위 두 localhost 주소만 열려 있어서, 웹을 배포하면 그 주소를 추가해야 합니다.
