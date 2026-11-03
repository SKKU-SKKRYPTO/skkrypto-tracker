# API 서버 (담당 3)

수집된 데이터를 저장소(`repository.Repository`)에서 읽고, 분석은 엔진(`src/backend/analyzer`)에 맡겨서 웹에 JSON으로 돌려줍니다. 요청마다 체인(RPC)에 묻지 않고 이미 수집된 데이터만 읽습니다.

## 실행

```bash
make run-api                       # http://localhost:8080, Fixture 4개를 메모리에 올림
make demo-fixture                  # 시연용(DB·웹이 붙기 전에는 run-api와 같다)
API_ADDR=:9090 make run-api        # 포트 바꾸기
docker compose up --build -d       # 레포 루트에서: API(8080)·Swagger UI(8081)·PostgreSQL(내부 전용)
```

PostgreSQL에서 읽으려면 아래 [DB로 실행하기](#db로-실행하기)를 봅니다.

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `API_ADDR` | `:8080` | 서버 주소 |
| `DATABASE_URL` | 없음 | PostgreSQL 접속 주소. 있으면 DB를, 없으면 Fixture를 읽는다. 비밀번호가 들어가므로 `.env`·배포 환경 변수에만 둔다 |
| `FIXTURE_DIR` | `api-server/testdata/fixtures` | `DATABASE_URL`이 없을 때 메모리에 올릴 Fixture 폴더(Go 모듈 루트 `src/backend` 기준) |
| `RATE_LIMIT_PER_MINUTE` | `120` | 클라이언트 IP마다 1분에 받는 요청 수(0이면 제한 없음) |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:8081` | 브라우저에서 API를 부를 수 있는 웹 주소 |

예시는 `.env.example`에 있습니다. `docker compose`는 같은 폴더의 `.env`를 읽고, `make run-api`는 `.env`를 읽지 않으므로 `API_ADDR=:9090 make run-api`처럼 앞에 붙입니다. 비밀값은 `.env`에만 두고 커밋하지 않습니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `contracts/` | API 규격(`openapi.json`)과 샘플. 기준 문서 |
| `repository/` | 저장소 인터페이스(담당 3), 메모리 구현(`memory.go`, Fixture), PostgreSQL 구현(`postgres.go`, 담당 1) |
| `httpapi/` | 라우터·핸들러·오류 응답·요청 제한 |
| `cmd/api-server/` | 실행 파일(저장소 고르기·포트·종료 처리) |
| `testdata/fixtures/` | 합성 데이터셋 4개(정상 2, 수집 중 1, 무효화 1) |

## 요청 한 번의 처리 순서(분석 API)

1. 입력 확인 → 400 (쿼리 문자열(분석 API는 받지 않음), 주소 형식, 모르는 항목, 같은 항목 두 번, null, 64KB 초과, 깊이·상한 범위, 패턴에 경로 전용 항목, 추적에 대상 주소)
2. 데이터셋 확인 → 404(없음), 409(수집 중·무효화)
3. 자산·범위 확인 → 422 (다른 토큰, 수집 범위 밖). 선택한 시작 전송 ID가 데이터셋 모드의 ID 형식이 아니면 400
4. 저장소에서 후보 읽기(`maxCandidates`까지). 2·3 hop은 범위 안 전체, 패턴과 1 hop은 시작 주소의 전송만
5. 엔진 실행(시간 예산 안에서, 요청이 취소되면 멈춤)
6. 데이터셋 다시 확인 → 처리하는 사이 무효화됐으면 409
7. 노드에 이름표를 붙여 200 응답(0건·부분 결과도 200)

4번에서 2·3 hop에 주소 조건을 넘기지 않는 이유: 시작 주소와 상관없는 전송(예: A→D)도 지나기 때문입니다. 패턴과 1 hop은 시작 주소의 전송만 쓰므로 주소 조건을 넘겨서, 다른 주소의 전송이 후보 상한을 먼저 채우는 일을 막습니다. 그래도 후보가 잘리면 `meta.limits.analyzedUntil`에 실제로 분석한 마지막 블록·시각이 나옵니다.

## 안전장치

| 항목 | 값 |
|---|---|
| 요청 제한 | IP마다 1분 120회 → 429 + `Retry-After`. 도커·프록시 뒤에서는 모두 같은 IP로 보이므로 실습처럼 여럿이 쓰면 `RATE_LIMIT_PER_MINUTE`를 올리거나 0(끔)으로(Railway 배포는 1200) |
| 본문 크기 | 64KB → 400 |
| 요청 시간 | 3초(엔진 시간 예산 최대 2초 + 여유) → 503 `REQUEST_TIMEOUT` |
| 응답 헤더 | `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` |
| CORS | 등록한 웹 주소만 허용. 429의 `Retry-After`도 읽을 수 있게 노출 |

## 규격을 바꿀 때

1. `contracts/openapi.json`을 고칩니다.
2. 코드를 고친 뒤 `make samples`로 샘플을 다시 만듭니다.
3. `make check`를 통과시킵니다. 서버 응답과 샘플이 다르면 `TestResponsesMatchSamples`가 실패합니다. CodeRabbit 리뷰를 돌리면 openapi.json의 깨지는 변경도 알려 줍니다(oasdiff).
4. PR에 바뀐 샘플을 함께 올리고 담당 1·4에게 리뷰를 받습니다.

## DB로 실행하기

`DATABASE_URL`을 주면 Fixture 대신 PostgreSQL 저장소(`repository/postgres.go`)를 씁니다. 시작할 때 한 번 연결해 보고(최대 10초) 안 되면 바로 종료합니다. 시작 로그에는 `데이터: PostgreSQL 호스트:포트/DB이름`만 찍히고 계정·비밀번호는 나오지 않습니다.

```bash
DATABASE_URL='postgres://계정:비밀번호@127.0.0.1:5432/DB이름?sslmode=disable' make run-api
```

- DB에는 `src/database/init.d`의 스키마와 Fixture 시드가 들어 있어야 합니다. Compose의 PostgreSQL은 처음 띄울 때 자동으로 넣고, Compose의 API가 DB를 읽게 하는 방법은 `docker-compose.yml` 맨 위 주석에 있습니다.
- DB 모드에서도 전송·분석 결과는 Fixture 모드와 같습니다(`sample-requests.json`으로 확인). 다만 데이터셋 `labels`(주소 이름표)·`notes`는 DB에 칸이 없어 비어 있고, 그래서 그래프 노드 `label`도 빠집니다.

### 저장소를 고치거나 새로 만들 때 지킬 약속

- `ListTransfers`는 **위치 순서**(`blockNumber, transactionIndex, logIndex`, 같으면 ID)로 돌려주고, `Limit`개보다 많으면 `HasMore: true`.
- 주소·해시는 소문자, 금액·블록 번호는 그대로(문자열·정수).
- `finalizedBlock`·`collectedAt`은 값이 없으면 `nil`(응답 `null`)로 둡니다. 다른 값으로 채우지 않습니다.
- `ctx`가 취소되면 바로 멈추기.
- 없는 데이터셋·버전은 `repository.ErrNotFound`.

메모리 저장소 테스트(`repository/memory_test.go`)와 같은 조건을 새 저장소에 돌려 보면 약속을 지키는지 확인할 수 있습니다.

## 배포(Railway)

| 항목 | 값 |
|---|---|
| 주소 | `https://api-production-965fc.up.railway.app` (싱가포르) |
| 빌드 | 빌드 폴더 `src/backend`, Dockerfile `api-server/Dockerfile`, 헬스 체크 `/healthz` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`: 같은 프로젝트 PostgreSQL의 내부 주소를 참조(값을 직접 적지 않음) |
| `RATE_LIMIT_PER_MINUTE` | `1200`: Railway 프록시 뒤라 모든 사용자가 같은 IP로 보임 |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:8081`. 웹을 배포하면 그 주소를 추가 |

자동 배포는 아직 없고, main에 병합된 뒤 담당 3이 배포합니다. 진행 상황은 #27에 있습니다.

## 테스트

```bash
make test-api
```

| 회의록 예시 | 테스트 |
|---|---|
| 잘못된 주소 형식을 보내면 에러를 돌려주는지 | `TestInvalidAddressReturns400`, `TestAnalysisRejectsBadInput` |
| 응답 형식이 문서와 같은지 | `TestResponsesMatchSamples`(샘플 21개와 글자 그대로 비교) |

그 밖에 커서 페이지 넘기기, 다른 조건(400)·다른 버전(409)의 커서 거절, 형식이 틀린 쿼리 거절(400), CORS, 분석·거래 조회 중 무효화(409), 요청 제한(429)과 기록 정리 주기, 시간 초과(503)를 확인합니다.

`make test-integration`은 실제 저장소(Fixture 메모리)와 실제 엔진으로 아래를 확인합니다. DB·웹이 붙으면 같은 흐름을 그대로 돌립니다.

- 데이터셋 선택 → 주소 검색 → 1 hop 그래프 → 거래 상세(`TestFixtureFlowSearchOneHopDetail`)
- 샘플 21개와 실제 응답 비교(`TestResponsesMatchSamples`)
- 1만 건 성능(`TestTenThousandTransfersAnswerWithinTwoSeconds`)

## 성능 결과

합성 전송 1만 건·주소 200개·3 hop, 노드 200·엣지 500 상한(맥북 M2, 메모리 저장소, 2026-10-31 측정). 분석 응답의 `Server-Timing` 헤더로 저장소·엔진 시간을 나눠 기록하고, `make test-integration`으로 다시 잴 수 있습니다.

| API | 전체 | 저장소 | 엔진 | 결과 |
|---|---|---|---|---|
| `POST /api/trace` | 약 40ms | 약 18ms | 약 20ms | 전송 500건(EDGE_LIMIT) |
| `POST /api/paths` | 약 50ms | 약 18ms | 약 32ms | 경로 121개 중 상위 10개(PATH_LIMIT) |
| `POST /api/patterns` | 약 1ms | 약 0.4ms | 약 0.3ms | 패턴 28개(시작 주소의 전송만 읽음) |

전체에서 저장소·엔진을 뺀 나머지가 JSON 직렬화 시간입니다. 기준(2초)보다 충분히 빠르고, 실제 DB가 붙으면 저장소 시간을 다시 잽니다.
