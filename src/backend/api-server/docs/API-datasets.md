# GET /api/datasets: 데이터셋 목록

> 기준은 `src/backend/api-server/contracts/openapi.json`의 `listDatasets`입니다. 이 페이지와 다르면 openapi.json을 따르고 이 페이지를 고칩니다.

## 목적

화면 첫 단계에서 분석할 데이터셋을 고른다. 분석·전송 조회·거래 조회는 상태가 READY인 버전만 된다. 상세 조회(`GET /api/datasets/{id}`)는 상태를 확인하는 용도라 READY가 아니어도 된다.

## 요청

없음

```bash
curl -s 'localhost:8080/api/datasets'
```

## 응답 예시

- `200` [datasets-list.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/datasets-list.json): 데이터셋 목록. 상태(READY·COLLECTING·FAILED·INVALIDATED)와 수집 범위를 함께 보여 준다.
- `429` [error-rate-limited.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/error-rate-limited.json): 요청 제한 초과. Retry-After 헤더(초)만큼 기다렸다가 다시 보낸다.
- `503` [error-unavailable.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/error-unavailable.json): 저장소 장애. retryable이 true라 잠시 뒤 다시 시도할 수 있다.

## 상태 코드

| 상태 | 뜻 |
|---|---|
| 200 | 정상. 0건도 200 |
| 400 | 입력 오류(INVALID_INPUT): 지원하지 않거나 형식이 틀린 쿼리 |
| 429 | 요청 제한(RATE_LIMITED). Retry-After 초 뒤 다시 |
| 503 | 일시 장애·시간 초과(UNAVAILABLE, REQUEST_TIMEOUT: 다시 시도 가능) |

## 잘림과 오류의 의미

잘림 없음. 목록 전체를 돌려준다.

오류 응답은 `data: null`, `error: { code, message, retryable }`입니다. `message`는 화면에 그대로 보여 줘도 됩니다.

## 변경 이력

| 날짜 | PR | 내용 |
|---|---|---|
| 2026-10-30 | #8 | v1 규격 확정 |
| 2026-10-31 | #14 | 서버 구현 |
| 2026-11-01 | #32 | `finalizedBlock`(FIXTURE)·`collectedAt`(READY가 아닐 때)이 `null`일 수 있음 |
