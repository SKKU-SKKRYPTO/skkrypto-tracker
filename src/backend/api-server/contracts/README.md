# API 규격 v1

웹(담당 4)·엔진(담당 2)·수집/DB(담당 1)가 같은 데이터 모양을 보고 개발할 수 있도록, 담당 3이 API 규격과 샘플 응답을 모아 두는 곳입니다. 기획안 「공통 개발 기준」 3절(입출력 규격)을 따릅니다.

- **기준은 `openapi.json` 하나입니다.** 위키·README는 설명이고, 내용이 다르면 `openapi.json`이 맞습니다.
- 규격을 바꾸려면 PR에서 `openapi.json`과 샘플을 함께 고치고 담당 1·4에게 리뷰를 받습니다.
- [Swagger Editor](https://editor.swagger.io/)에 `openapi.json` 내용을 붙여 넣으면 클릭해 가며 볼 수 있습니다.

## 파일

| 파일 | 내용 |
|---|---|
| `openapi.json` | API 7개의 요청·응답 규격(OpenAPI 3.1) |
| `sample-requests.json` | 샘플마다 "어떤 요청을 보내면 이 응답이 오는지" |
| `samples/*.json` | 응답 샘플 20개. 서버 테스트가 실제 응답과 글자 그대로 같은지 확인합니다 |

샘플 데이터는 모두 합성 Fixture(`fx:` ID)이고 실제 체인 데이터가 아닙니다.

## API 7개

| API | 하는 일 | 샘플 |
|---|---|---|
| `GET /api/datasets` | 데이터셋 목록(모드·버전·범위·상태) | `datasets-list.json` |
| `GET /api/datasets/{id}` | 한 버전의 상태·자산·범위·주소 이름표 | `dataset-detail.json` |
| `GET /api/transfers` | 전송 목록(주소·방향·범위 필터, 위치 기반 커서) | `transfers-page.json` |
| `GET /api/transactions/{txHash}` | 한 거래 안의 전송 | `transaction-multiple.json`, `large-amount.json` |
| `POST /api/trace` | 시작 주소에서 1~3 hop 시간순 추적 | `trace-success.json`, `trace-ready-empty.json`, `trace-candidate-limit.json` |
| `POST /api/paths` | 두 주소 사이 시간순 후보 경로 | `paths-success.json`, `paths-path-limit.json`, `paths-time-budget.json` |
| `POST /api/patterns` | 분산(FAN_OUT)·합류(FAN_IN) 패턴 | `patterns-success.json` |

오류 샘플: `error-bad-input`(400) · `error-not-found`(404) · `error-not-ready`·`error-invalidated`(409) · `error-out-of-range`·`error-unsupported-asset`(422) · `error-rate-limited`(429) · `error-unavailable`(503)

## 공통 규칙

- **응답 구조:** 항상 `{ "data": ..., "meta": ..., "error": ... }`. 정상이면 `error: null`, 오류면 `data: null`.
- **meta:** 규격·규칙 버전(`contractVersion`·`ruleVersion`), 데이터셋 ID·버전·모드, 수집 범위(`coverage`), 실제로 쓴 조건(`conditions`, 빈 칸은 기본값으로 채움), 상한·잘림(`limits`), 해석 한계 문구(`limitations`).
- **0건과 부분 결과도 200:** 결과가 0건이면 빈 배열입니다. 상한에 걸리지 않았으면 `limits.truncated: null`, 걸렸으면 `limits.truncated.reason`에 대표 사유(`PATH_LIMIT`·`STATE_LIMIT`·`CANDIDATE_LIMIT`·`NODE_LIMIT`·`EDGE_LIMIT`·`TIME_BUDGET` 중 하나), `reasons`에 함께 생긴 사유가 있습니다. 탐색을 중간에 멈췄거나 후보가 잘렸으면 `foundIsLowerBound: true`(found는 "최소 이만큼")입니다. 경로가 많기만 한 경우(`PATH_LIMIT`)는 앞 10개만 주고 found에 전체 개수를 줍니다.
- **숫자:** 금액(`amountRaw`)과 블록 번호는 **십진 문자열**입니다. 자바스크립트 숫자는 2^53을 넘으면 정확하지 않기 때문입니다. 거래·로그 순서(`transactionIndex`·`logIndex`)처럼 작은 정수만 JSON 숫자입니다.
- **시각:** UTC ISO-8601 문자열(예: `2026-10-26T12:00:04Z`).
- **주소:** 응답은 항상 소문자. 요청은 대소문자 모두 받습니다.
- **전송 ID:** Snapshot `{chainId}:{txHash}:{logIndex}`, Fixture `fx:{namespace}:{recordId}`. 그래프·표·상세·JSON이 모두 이 값을 씁니다.
- **요청 본문:** 항목 이름은 대소문자까지 정확해야 하고, 모르는 항목·`null`·64KB 초과는 400입니다. `startTransferId`는 데이터셋 모드의 ID 형식이어야 합니다.
- **HTTP 상태:**

| 상태 | 코드 | 언제 | 다시 시도 |
|---|---|---|---|
| 200 | | 정상·0건·부분 결과 | |
| 400 | `INVALID_INPUT`, `INVALID_CURSOR` | 입력 형식 오류, 다른 조건의 커서 | 아니요 |
| 404 | `DATASET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `NOT_FOUND` | 없는 데이터셋·거래·경로 | 아니요 |
| 409 | `DATASET_NOT_READY`, `DATASET_INVALIDATED`, `VERSION_MISMATCH` | 수집 중·실패, 무효화된 버전, 다른 버전에서 받은 커서 | 아니요(다른 버전 선택·첫 쪽부터) |
| 422 | `OUT_OF_RANGE`, `UNSUPPORTED_ASSET` | 수집 범위 밖, 다른 자산 | 아니요 |
| 429 | `RATE_LIMITED` | 요청 제한(`Retry-After` 헤더) | 예 |
| 503 | `UNAVAILABLE`, `REQUEST_TIMEOUT` / `INVALID_DATA` | 일시 장애·시간 초과 / 저장소 데이터 형식 오류 | 예 / 아니요 |

## 샘플은 어떻게 만들었나

샘플은 서버가 실제로 돌려줄 응답과 같아야 합니다. API 서버 PR부터는 서버 테스트(`TestResponsesMatchSamples`)가 `sample-requests.json`의 요청을 실제 서버에 보내고, 응답이 `samples/` 파일과 글자 그대로 같은지 확인합니다. 그 전까지는 이 샘플을 보고 화면·엔진·저장소를 먼저 만들 수 있습니다.

## v0-draft에서 바뀐 점

- `meta.dataset`(데이터셋 전체) 대신 `meta.coverage`(수집 범위)만 싣습니다.
- 전송에서 데이터셋 키(`datasetId` 등)를 빼고 `transferType`(TRANSFER·MINT·BURN)을 넣었습니다. 데이터셋 키는 `meta`에 있습니다.
- 데이터셋 `labels`를 "주소 → 이름"으로 뒤집었습니다(화면에서 주소로 이름을 찾기 쉽게).
- 데이터셋의 `contractVersion`·`ruleVersion`은 응답 `meta`로 옮기고, `fixtureVersion`은 뺐습니다.
- `sourceMode` 값 `RPC_SNAPSHOT`을 `SNAPSHOT`으로 바꿨습니다.
- 경로 ID를 `path-1` 같은 순번에서 전송 ID로 만든 해시로 바꿨습니다. 같은 경로는 언제 찾아도 같은 ID입니다.
- 잘림 표시를 `truncated: true` + `reasons`에서 `truncated: null | { reason, reasons }`로 바꿨습니다(기획안 `truncated.reason`).
- 후보가 잘리면(`CANDIDATE_LIMIT`) 실제로 분석한 마지막 전송의 블록·시각을 `meta.limits.analyzedUntil`에 싣습니다. 잘리지 않았으면 `null`입니다(기획안 '후보 조회는 적용 범위·상한 초과 여부를 반환').
- 경로 `transferIds`는 `direction`과 상관없이 돈이 흐른 시간순입니다. 같은 경로는 어느 방향으로 찾아도 같은 ID입니다.
- `GET /api/datasets/{id}`는 `datasetVersion`이 필수입니다(기획안 '지정 버전의 상태'). 분석 요청에서 같은 항목을 두 번 쓰거나, 패턴에 경로 전용 항목(`targetAddress`·`startTransferId`·`maxDepth`)을 보내면 400입니다.
- 패턴의 `type`을 `ruleId`로 바꾸고, `asset`·`direction`·`windowSeconds`·`uniqueCounterparties`를 넣고, `patternId`를 `{ruleId}:{address}:{direction}:{첫 근거 전송 ID}`로 정했습니다. 요청에 `direction`을 주면 그 방향의 패턴만 봅니다.
- `GET /api/transfers`에 `direction`·`limit`·`cursor`를 넣었습니다.
- 나머지 샘플(부분 결과·409·422·429·503·다중 Transfer·큰 금액)을 추가했습니다.
