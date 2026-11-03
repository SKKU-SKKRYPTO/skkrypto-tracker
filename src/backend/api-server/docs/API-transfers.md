# GET /api/transfers: 전송 목록

> 기준은 `src/backend/api-server/contracts/openapi.json`의 `listTransfers`입니다. 이 페이지와 다르면 openapi.json을 따르고 이 페이지를 고칩니다.

## 목적

표 화면. 주소·방향·블록·시간·최소 금액으로 원본 전송을 위치 순으로 본다. 분석에서 빠지는 0 금액·발행·소각·자기 전송도 여기에는 나온다.

## 요청

| 이름 | 위치 | 필수 | 형식 | 설명 |
|---|---|---|---|---|
| `datasetId` | 쿼리 | 필수 | string | 데이터셋 ID |
| `datasetVersion` | 쿼리 | 필수 | string | 데이터셋 버전. 결과를 재현할 수 있도록 꼭 넣는다. |
| `address` | 쿼리 | 선택 | Address | 이 주소가 보내거나 받은 전송 |
| `direction` | 쿼리 | 선택 | any/incoming/outgoing | address 기준 방향. incoming·outgoing은 address가 필요하다. |
| `startBlock` | 쿼리 | 선택 | BlockNumber | 이 블록부터(포함) |
| `endBlock` | 쿼리 | 선택 | BlockNumber | 이 블록까지(포함) |
| `startTime` | 쿼리 | 선택 | DateTime | 이 시각부터(포함) |
| `endTime` | 쿼리 | 선택 | DateTime | 이 시각까지(포함) |
| `minAmountRaw` | 쿼리 | 선택 | Amount | 이 금액 이상 |
| `limit` | 쿼리 | 선택 | integer | 한 쪽의 개수 |
| `cursor` | 쿼리 | 선택 | string | 이전 응답의 meta.page.nextCursor |

```bash
curl -s 'localhost:8080/api/transfers?datasetId=flow-demo&datasetVersion=v1&address=0x0000000000000000000000000000000000000001&direction=outgoing&limit=2'
```

## 응답 예시

- `200` [transfers-page.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/transfers-page.json): S가 보낸 전송 첫 쪽(2건). 다음 쪽은 meta.page.nextCursor를 cursor로 넘겨 받는다.
- `409` [error-invalidated.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/error-invalidated.json): 무효화된 버전은 조회·분석하지 않는다.

## 상태 코드

| 상태 | 뜻 |
|---|---|
| 200 | 정상. 0건도 200 |
| 400 | 입력 오류(INVALID_INPUT), 잘못되거나 다른 조건에서 받은 커서(INVALID_CURSOR) |
| 404 | 없는 데이터셋(DATASET_NOT_FOUND) |
| 409 | 수집 중·무효화·다른 버전에서 받은 커서(DATASET_NOT_READY, DATASET_INVALIDATED, VERSION_MISMATCH) |
| 422 | 수집 범위 밖(OUT_OF_RANGE) |
| 429 | 요청 제한(RATE_LIMITED). Retry-After 초 뒤 다시 |
| 503 | 일시 장애·시간 초과(UNAVAILABLE, REQUEST_TIMEOUT: 다시 시도 가능), 데이터 형식 오류(INVALID_DATA) |

## 잘림과 오류의 의미

한 쪽은 limit개(기본 100, 최대 1000). 다음 쪽은 meta.page.nextCursor를 cursor로 넘긴다. 커서는 데이터셋·버전·조건에 묶여서 다른 버전이면 409 VERSION_MISMATCH, 다른 조건이면 400 INVALID_CURSOR. 지원하지 않는 조건, 같은 조건 두 번, 세미콜론(;)이나 잘못된 %가 든 쿼리는 조건을 빼고 넓게 답하지 않고 400 INVALID_INPUT으로 거절한다.

오류 응답은 `data: null`, `error: { code, message, retryable }`입니다. `message`는 화면에 그대로 보여 줘도 됩니다.

## 변경 이력

| 날짜 | PR | 내용 |
|---|---|---|
| 2026-10-30 | #8 | v1 규격 확정 |
| 2026-10-31 | #14 | 서버 구현 |
