# POST /api/practice/grade: 실습 채점

> 기준은 `src/backend/api-server/contracts/openapi.json`의 `paths`입니다. 이 페이지와 다르면 openapi.json을 따르고 이 페이지를 고칩니다.

## 목적

실습 답안(경로 묶음)을 서버가 가진 정답과 비교해 통과 여부(PASS/FAIL)만 돌려준다. 점수·맞힌 개수·어느 경로가 맞았는지는 알려 주지 않는다(개수를 주면 경로를 하나씩 넣어 보며 정답을 맞출 수 있다). 다시 내는 횟수는 막지 않는다.

정답은 이 public 저장소에 없다. 서버 환경 변수 `PRACTICE_ANSWERS_JSON`(값) 또는 `PRACTICE_ANSWERS_FILE`(파일 경로)로만 받고, 없으면 채점은 꺼져 있다(404). 정답이 있는 데이터셋은 `PRACTICE_DATASETS`에 없어도 `POST /api/paths`가 403 `PATHS_DISABLED`다.

## 요청

본문(JSON). `paths`는 경로마다 송금 ID(`transfers[].id`)를 출발부터 도착까지 순서대로 담는다. 경로끼리의 순서는 상관없고, 경로 안의 송금 순서는 정확해야 한다. 경로는 최대 10개, 경로 하나는 송금 1~3개. 경로가 없다고 답할 때는 빈 배열로 보내거나 뺀다.

```bash
PRACTICE_ANSWERS_FILE=/절대/경로/answers.json make run-api   # 정답 파일은 저장소 밖에 둔다
curl -s -X POST localhost:8080/api/practice/grade \
  -H 'Content-Type: application/json' \
  -d '{"challenge": "P1", "datasetId": "flow-demo", "datasetVersion": "v1", "paths": [["fx:flow-demo-v1:e1", "fx:flow-demo-v1:e4", "fx:flow-demo-v1:e6"], ["fx:flow-demo-v1:e2", "fx:flow-demo-v1:e5", "fx:flow-demo-v1:e6"]]}'
```

정답 파일 형식은 비공개 정답 저장소의 `answers.json`(version 2·3)입니다. 형식이 틀리면 서버가 뜨지 않습니다.

## 응답 예시

- `200` [practice-grade-passed.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/practice-grade-passed.json): 통과. 예시로 flow-demo의 S→T 경로 2개를 정답으로 둔 테스트 설정이다. `datasetMatches`는 답안의 데이터셋이 문제의 데이터셋과 같은지, `passed`는 정답 경로를 모두 내고 틀린 경로가 없을 때만 true.
- `404` [practice-grade-off.json](https://github.com/SKKU-SKKRYPTO/skkrypto-tracker/blob/main/src/backend/api-server/contracts/samples/practice-grade-off.json): 서버에 정답이 없어 채점이 꺼져 있음.

## 상태 코드

| 상태 | 뜻 |
|---|---|
| 200 | 채점함. 통과하지 못해도 200(`passed: false`) |
| 400 | 입력 오류(INVALID_INPUT): 모르는 문제, 데이터셋 빠짐, 경로 수·길이·송금 ID 길이 초과, 쿼리 문자열 |
| 404 | 채점이 꺼져 있음(NOT_FOUND) |
| 429 | 요청 제한(RATE_LIMITED). Retry-After 초 뒤 다시 |
| 503 | 일시 장애·시간 초과(UNAVAILABLE, REQUEST_TIMEOUT) |

## 채점 기준

- 송금 ID는 대소문자를 가리지 않고, 같은 경로를 두 번 내도 한 번으로 센다.
- 정답 경로를 하나라도 빠뜨리거나, 정답이 아닌 경로를 하나라도 더하거나, 경로 안의 송금 순서가 다르면 통과하지 못한다.
- 답안의 데이터셋이 문제의 데이터셋과 다르면 `datasetMatches: false`이고 통과하지 못한다.

## 변경 이력

| 날짜 | PR | 내용 |
|---|---|---|
| 2026-11-05 | (이 PR) | 추가 |
