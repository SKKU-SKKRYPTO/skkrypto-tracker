# POST /api/paths: 두 주소 사이 후보 경로

> 기준은 `src/backend/api-server/contracts/openapi.json`의 `paths`입니다. 이 페이지와 다르면 openapi.json을 따르고 이 페이지를 고칩니다.

## 목적

시작 주소에서 대상 주소까지 시간 순서로 이어지는 경로를 hop이 적은 순으로 본다. 경로는 같은 돈이라는 확정이 아니라 후보다. transferIds는 direction과 상관없이 돈이 흐른 순서다.

## 요청

본문(JSON). 항목 이름은 대소문자까지 정확해야 하고 `null`은 보내지 않습니다(생략은 됩니다).

```bash
curl -s -X POST localhost:8080/api/paths \
  -H 'Content-Type: application/json' \
  -d '{"datasetId": "flow-demo", "datasetVersion": "v1", "address": "0x0000000000000000000000000000000000000001", "targetAddress": "0x0000000000000000000000000000000000000007", "maxDepth": 3}'
```

## 응답 예시

- `200` [paths-success.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/paths-success.json): S에서 T까지 3 hop 경로 2개. 두 경로가 e6을 함께 쓰지만 summary에는 한 번만 센다.
- `200` [paths-path-limit.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/paths-path-limit.json): 경로 상한 1 → 정렬 순서의 앞 1개만 주고 truncated.reason은 PATH_LIMIT. 부분 결과도 200이고 found(2)는 전체 경로 수라 foundIsLowerBound는 false다.
- `200` [paths-time-budget.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/paths-time-budget.json): 시간 예산 초과 → TIME_BUDGET. 그때까지 찾은 것만 돌려주고 found는 최소값(foundIsLowerBound true)이다. 테스트에서는 느린 시계로 재현한다.
- `400` [error-bad-input.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/error-bad-input.json): 주소 형식 오류.

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

경로가 10개를 넘으면 정렬 순서의 앞 10개만 주고 truncated.reason은 PATH_LIMIT, found는 전체 개수(foundIsLowerBound false). 상태·시간 상한으로 멈추면 foundIsLowerBound true.

오류 응답은 `data: null`, `error: { code, message, retryable }`입니다. `message`는 화면에 그대로 보여 줘도 됩니다.

## 변경 이력

| 날짜 | PR | 내용 |
|---|---|---|
| 2026-10-30 | #8 | v1 규격 확정 |
| 2026-10-31 | #14 | 서버 구현 |
