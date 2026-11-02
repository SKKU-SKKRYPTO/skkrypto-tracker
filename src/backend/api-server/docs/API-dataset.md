# GET /api/datasets/{id}: 데이터셋 한 버전

> 기준은 `src/backend/api-server/contracts/openapi.json`의 `getDataset`입니다. 이 페이지와 다르면 openapi.json을 따르고 이 페이지를 고칩니다.

## 목적

고른 데이터셋 버전의 자산·수집 범위·주소 이름표(labels)를 본다. 상태와 관계없이 돌려주므로 수집 중·무효화 안내에도 쓴다. 이름표가 없으면 labels는 빈 객체({})다. DB에서 읽을 때는 labels·notes를 아직 저장하지 않아 항상 빈 값이다.

## 요청

| 이름 | 위치 | 필수 | 형식 | 설명 |
|---|---|---|---|---|
| `id` | 경로 | 필수 | string |  |
| `datasetVersion` | 쿼리 | 필수 | string | 조회할 버전. 버전 목록은 GET /api/datasets에 있다. |

```bash
curl -s 'localhost:8080/api/datasets/flow-demo?datasetVersion=v1'
```

## 응답 예시

- `200` [dataset-detail.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/dataset-detail.json): 데이터셋 한 버전의 자산·범위·주소 이름표.
- `404` [error-not-found.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/error-not-found.json): 없는 데이터셋.

## 상태 코드

| 상태 | 뜻 |
|---|---|
| 200 | 정상. 데이터셋 상태와 관계없이 200 |
| 400 | 입력 오류(INVALID_INPUT): datasetVersion 없음, 지원하지 않거나 형식이 틀린 쿼리 |
| 404 | 없는 데이터셋·버전(DATASET_NOT_FOUND) |
| 429 | 요청 제한(RATE_LIMITED). Retry-After 초 뒤 다시 |
| 503 | 일시 장애·시간 초과(UNAVAILABLE, REQUEST_TIMEOUT: 다시 시도 가능) |

## 잘림과 오류의 의미

잘림 없음. datasetVersion은 필수(없으면 400).

오류 응답은 `data: null`, `error: { code, message, retryable }`입니다. `message`는 화면에 그대로 보여 줘도 됩니다.

## 변경 이력

| 날짜 | PR | 내용 |
|---|---|---|
| 2026-10-30 | #8 | v1 규격 확정 |
| 2026-10-31 | #14 | 서버 구현 |
| 2026-11-01 | #32 | `finalizedBlock`(FIXTURE)·`collectedAt`(READY가 아닐 때)이 `null`일 수 있음 |
