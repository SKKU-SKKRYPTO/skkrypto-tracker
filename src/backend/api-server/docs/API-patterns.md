# POST /api/patterns: 분산·합류 패턴

> 기준은 `src/backend/api-server/contracts/openapi.json`의 `patterns`입니다. 이 페이지와 다르면 openapi.json을 따르고 이 페이지를 고칩니다.

## 목적

한 주소가 600초 안에 서로 다른 3개 이상의 주소로 나눠 보냈는지(FAN_OUT), 받았는지(FAN_IN) 본다. direction을 주면 그 방향만 본다.

## 요청

본문(JSON). 항목 이름은 대소문자까지 정확해야 하고 `null`은 보내지 않습니다(생략은 됩니다).

```bash
curl -s -X POST localhost:8080/api/patterns \
  -H 'Content-Type: application/json' \
  -d '{"datasetId": "patterns-demo", "datasetVersion": "v1", "address": "0x0000000000000000000000000000000000000069"}'
```

## 응답 예시

- `200` [patterns-success.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/patterns-success.json): H로 들어오는 합류(FAN_IN) 창 2개. 두 창이 겹쳐서 같은 groupId로 묶인다. 14:10:00 전송은 첫 창(600초 반열린 구간)에 들어가지 않는다.

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

겹치는 창은 합치지 않고 groupId로 묶는다. 창이 관측 범위(수집 범위·시간/블록 필터·후보 상한) 경계에 걸치면 incomplete: true(범위 밖을 모름). 시작 주소의 전송만 후보로 읽는다. 패턴은 규칙 일치일 뿐 소유자·위법성 판단이 아니다.

오류 응답은 `data: null`, `error: { code, message, retryable }`입니다. `message`는 화면에 그대로 보여 줘도 됩니다.

## 변경 이력

| 날짜 | PR | 내용 |
|---|---|---|
| 2026-10-30 | #8 | v1 규격 확정 |
| 2026-10-31 | #14 | 서버 구현 |
