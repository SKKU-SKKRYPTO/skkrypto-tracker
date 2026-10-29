# API 규격 (v0-draft)

API 서버의 요청·응답 규격과 샘플 응답입니다. 웹·엔진·수집/DB가 이 규격을 기준으로 개발합니다.

> v0-draft입니다. v1으로 확정하기 전까지 필드 이름·구조가 바뀔 수 있습니다.

## 파일

| 파일 | 내용 |
|---|---|
| `openapi.json` | API 7개의 요청·응답 규격(OpenAPI 3.1). 프론트엔드 타입·검증 스키마의 기준 |
| `samples/datasets-list.json` | `GET /api/datasets` 정상 응답 |
| `samples/paths-success.json` | `POST /api/paths` 정상 응답(후보 경로 2개) |
| `samples/trace-ready-empty.json` | `POST /api/trace` 결과 0건 응답(200) |
| `samples/error-bad-input.json` | 입력 오류 응답(400) |

샘플 데이터는 합성 Fixture(`fx:` ID)이며 실제 체인 데이터가 아닙니다.

## API

| API | 설명 |
|---|---|
| `GET /api/datasets` | 데이터셋 목록(모드·버전·범위·상태) |
| `GET /api/datasets/{id}` | 데이터셋 한 버전의 상태·자산·범위 |
| `GET /api/transfers` | 전송 목록(주소·거래·블록·시간·최소 금액 필터) |
| `GET /api/transactions/{txHash}` | 한 거래 안의 전송 목록 |
| `POST /api/trace` | 시작 주소에서 1~3 hop 추적 |
| `POST /api/paths` | 두 주소 사이 시간순 후보 경로 |
| `POST /api/patterns` | 분산(FAN_OUT)·합류(FAN_IN) 패턴 |

## 공통 규칙

- **응답 구조:** 항상 `{ "data": ..., "meta": ..., "error": ... }`. 정상이면 `error: null`, 오류면 `data: null`.
- **meta:** 규격·규칙 버전, 데이터셋 ID·버전·모드, 요청 조건, 상한·잘림 정보, 해석 한계 문구.
- **부분 결과:** `meta.limits`(분석 API는 `data.limits`도)에 `truncated`, `reasons`(`PATH_LIMIT`·`STATE_LIMIT`·`CANDIDATE_LIMIT`·`NODE_LIMIT`·`EDGE_LIMIT`·`TIME_BUDGET`), `found`, `foundIsLowerBound`. 부분 결과도 `200`.
- **숫자:** 금액(`amountRaw`)과 블록 번호(`blockNumber`·`startBlock`·`endBlock`·`finalizedBlock`)는 십진 문자열. `transactionIndex`·`logIndex`만 JSON 숫자.
- **시각:** UTC ISO-8601 문자열(예: `2026-10-26T12:00:04Z`).
- **전송 ID:** Snapshot `{chainId}:{txHash}:{logIndex}`, Fixture `fx:{namespace}:{recordId}`.
- **HTTP 상태:** `200` 정상·0건·부분 결과 / `400` 입력 오류 / `404` 없음 / `409` 미준비·무효화 / `422` 지원하지 않는 자산·범위 / `429` 요청 제한 / `503` 일시 장애. 오류 본문은 `{ code, message, retryable }`.
