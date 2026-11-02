# GET /api/transactions/{txHash}: 거래 상세

> 기준은 `src/backend/api-server/contracts/openapi.json`의 `getTransaction`입니다. 이 페이지와 다르면 openapi.json을 따르고 이 페이지를 고칩니다.

## 목적

그래프의 선(전송)을 눌렀을 때 같은 거래의 전송을 모두 보여 준다. 한 거래에 전송이 여러 개면 사용자가 분석 시작 전송(startTransferId)을 고를 수 있다.

## 요청

| 이름 | 위치 | 필수 | 형식 | 설명 |
|---|---|---|---|---|
| `txHash` | 경로 | 필수 | Hash |  |
| `datasetId` | 쿼리 | 필수 | string | 데이터셋 ID |
| `datasetVersion` | 쿼리 | 필수 | string | 데이터셋 버전. 결과를 재현할 수 있도록 꼭 넣는다. |

```bash
curl -s 'localhost:8080/api/transactions/0x00000000000000000000000000000000000000000000000000000000000003ed?datasetId=patterns-demo&datasetVersion=v1'
```

## 응답 예시

- `200` [transaction-multiple.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/transaction-multiple.json): 한 거래 안의 전송 2건. 같은 txHash라도 logIndex가 달라 ID가 다르다.
- `200` [large-amount.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/large-amount.json): uint256 최대 금액. amountRaw가 문자열이라 78자리가 그대로 온다.

## 상태 코드

| 상태 | 뜻 |
|---|---|
| 200 | 정상 |
| 400 | 입력 오류(INVALID_INPUT): 해시 형식, 지원하지 않거나 형식이 틀린 쿼리 |
| 404 | 없는 데이터셋·거래(DATASET_NOT_FOUND, TRANSACTION_NOT_FOUND) |
| 409 | 수집 중·무효화(DATASET_NOT_READY, DATASET_INVALIDATED) |
| 429 | 요청 제한(RATE_LIMITED). Retry-After 초 뒤 다시 |
| 503 | 일시 장애·시간 초과(UNAVAILABLE, REQUEST_TIMEOUT: 다시 시도 가능), 데이터 형식 오류(INVALID_DATA) |

## 잘림과 오류의 의미

잘림 없음(전송이 1000건을 넘는 거래도 모두 준다). 데이터셋 범위에 없는 거래는 404 TRANSACTION_NOT_FOUND. 찾는 사이 데이터셋이 무효화되면 404 대신 409 DATASET_INVALIDATED로 알린다.

오류 응답은 `data: null`, `error: { code, message, retryable }`입니다. `message`는 화면에 그대로 보여 줘도 됩니다.

## 변경 이력

| 날짜 | PR | 내용 |
|---|---|---|
| 2026-10-30 | #8 | v1 규격 확정 |
| 2026-10-31 | #14 | 서버 구현 |
