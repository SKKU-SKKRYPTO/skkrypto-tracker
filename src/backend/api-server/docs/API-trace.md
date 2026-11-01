# POST /api/trace: 1~3 hop 추적

> 기준은 `src/backend/api-server/contracts/openapi.json`의 `trace`입니다. 이 페이지와 다르면 openapi.json을 따르고 이 페이지를 고칩니다.

## 목적

시작 주소(또는 고른 전송)에서 나간 돈이 1~3 hop 안에 시간 순서로 어디까지 이어지는지 그래프로 본다.

## 요청

본문(JSON). 항목 이름은 대소문자까지 정확해야 하고 `null`은 보내지 않습니다(생략은 됩니다). `targetAddress`는 쓰지 않습니다(보내면 400). 두 주소 사이 경로는 [paths](API-paths.md)로 찾습니다.

```bash
curl -s -X POST localhost:8080/api/trace \
  -H 'Content-Type: application/json' \
  -d '{"datasetId": "flow-demo", "datasetVersion": "v1", "address": "0x0000000000000000000000000000000000000001", "maxDepth": 2}'
```

## 응답 예시

- `200` [trace-success.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/trace-success.json): S에서 2 hop 안에 시간순으로 닿는 전송.
- `200` [trace-ready-empty.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/trace-ready-empty.json): T는 보낸 전송이 없다. 0건도 오류가 아니라 200이다(선택한 범위에서 관측되지 않음).
- `200` [trace-candidate-limit.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/trace-candidate-limit.json): 후보 상한 4 → 위치 순 앞 4건만 분석한 부분 결과. truncated.reason은 CANDIDATE_LIMIT, found는 최소값(foundIsLowerBound true), analyzedUntil은 실제로 분석한 마지막 전송의 블록·시각이다. 화면은 '블록 N까지만 분석'으로 보여 준다.
- `409` [error-not-ready.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/error-not-ready.json): 수집 중인 데이터셋은 분석하지 않는다.
- `422` [error-out-of-range.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/error-out-of-range.json): 수집 범위 밖 블록. 0건이 아니라 422로 알린다.
- `422` [error-unsupported-asset.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/error-unsupported-asset.json): 데이터셋과 다른 토큰.

## 상태 코드

| 상태 | 뜻 |
|---|---|
| 200 | 정상. 0건·부분 결과도 200 |
| 400 | 입력 오류(INVALID_INPUT) |
| 404 | 없는 데이터셋(DATASET_NOT_FOUND) |
| 409 | 수집 중·무효화(DATASET_NOT_READY, DATASET_INVALIDATED) |
| 422 | 수집 범위 밖·다른 자산(OUT_OF_RANGE, UNSUPPORTED_ASSET) |
| 429 | 요청 제한(RATE_LIMITED). Retry-After 초 뒤 다시 |
| 503 | 일시 장애·시간 초과(UNAVAILABLE, REQUEST_TIMEOUT: 다시 시도 가능), 데이터 형식 오류(INVALID_DATA) |

## 잘림과 오류의 의미

노드 200·엣지 500·상태 1만·후보 1만·시간 2초 상한. 걸리면 200 + meta.limits.truncated.reason. 탐색을 멈췄으면 foundIsLowerBound가 true라 found는 최소값이다. 후보가 잘리면(CANDIDATE_LIMIT) meta.limits.analyzedUntil에 실제로 분석한 마지막 블록·시각이 있다. maxDepth 1이면 시작 주소의 전송만 후보로 읽는다.

오류 응답은 `data: null`, `error: { code, message, retryable }`입니다. `message`는 화면에 그대로 보여 줘도 됩니다.

## 변경 이력

| 날짜 | PR | 내용 |
|---|---|---|
| 2026-10-30 | #8 | v1 규격 확정 |
| 2026-10-31 | #14 | 서버 구현 |
