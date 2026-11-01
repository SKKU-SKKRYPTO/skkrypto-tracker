# SKKRYPTO Tracker Web

실제 Go API에서 데이터셋을 선택하고 주소를 추적하는 React + TypeScript + Vite 화면입니다.
새 패키지는 필요하지 않습니다. 백엔드의 현재 기본 실행 모드는 Fixture 메모리 저장소입니다.
실제 HTTP API 연결이며 실제 체인/RPC나 PostgreSQL 연결을 의미하지 않습니다.

## 로컬 실행

레포 루트에서 Go API를 실행합니다.

```powershell
go -C src/backend run ./api-server/cmd/api-server
```

별도 터미널에서 웹을 실행합니다.

```powershell
cd src/web
# 최초 실행 시 의존성을 설치합니다. 설치 후에는 매번 실행할 필요가 없습니다.
npm ci
npm run dev
```

브라우저는 Vite가 표시하는 주소로 엽니다(기본 http://localhost:5173).
웹은 상대 경로 `/api/...`를 사용하며 Vite가 `http://127.0.0.1:8080`으로 전달합니다.
API의 CORS 변경은 필요하지 않습니다. 이 프록시는 개발 전용입니다.
운영 배포에서는 같은 출처의 `/api` 역방향 프록시 또는 별도 CORS 구성이 필요합니다.

## API 서버 주소 설정

`VITE_API_BASE_URL`을 설정하지 않거나 빈 값으로 두면 기존 로컬 실행 방식이 유지됩니다.
개발 서버에서는 상대 경로 `/api/...`를 Vite 프록시가 로컬 Go 서버로 전달합니다.
이 설정은 Mock 전환 옵션이 아니며, 실제 HTTP API의 연결 주소만 변경합니다.

다른 API 서버에 연결하려면 `src/web`에서 `.env.example`을 `.env.local`로 복사한 뒤 값을 지정합니다.
Railway 연결 예시는 다음과 같습니다.

```dotenv
VITE_API_BASE_URL=https://api-production-965fc.up.railway.app
```

주소에는 `/api`를 붙이지 않습니다. 서비스가 `/api/datasets`, `/api/trace` 등의 경로를 추가합니다.
끝의 `/`는 있어도 됩니다. 예를 들어 위 설정의 목록 요청 주소는
`https://api-production-965fc.up.railway.app/api/datasets`입니다.
환경변수 변경 후에는 `npm run dev`를 다시 실행합니다. 배포 시에는 빌드 환경에 설정하고 다시 빌드해야 합니다.
`VITE_` 환경변수는 브라우저 번들에 공개되므로 비밀번호, API 비밀 키, DB·RPC 비밀값을 넣지 않습니다.

다른 출처의 API에 직접 연결하면 Vite 프록시를 거치지 않으므로 서버의 CORS 허용이 필요합니다.
현재 Go 서버는 `CORS_ALLOWED_ORIGINS`로 허용 출처를 설정할 수 있습니다.
Railway 서버에는 실제 웹 출처(예: `http://localhost:5173` 또는 배포된 웹의 HTTPS 주소)를
쉼표로 구분하여 설정합니다. 출처에는 경로나 끝의 `/`를 넣지 않으며 포트도 일치해야 합니다.
백엔드 코드를 수정할 필요는 없습니다. 현재 기본 허용값은 `http://localhost:5173,http://localhost:8081`입니다.

브라우저 개발자 도구의 Network에서 목록·상세 GET 및 Trace POST를 확인합니다.
응답의 `Access-Control-Allow-Origin`이 웹 출처와 일치해야 하며, JSON POST의 사전 요청 OPTIONS는
GET·POST 메서드와 `Content-Type` 헤더를 허용해야 합니다.
브라우저에서 CORS 차단은 네트워크 오류로 보일 수 있으므로 Console도 함께 확인합니다.
`Retry-After` 값을 교차 출처 브라우저에서도 표시하려면 서버가
`Access-Control-Expose-Headers: Retry-After`를 제공해야 합니다(현재 Go 구현에는 없음).

## 화면 동작

- 첫 READY 데이터셋의 ID·버전을 선택하고 상세 정보를 조회합니다.
- READY가 없어도 첫 데이터셋 정보를 표시하지만 검색은 비활성화합니다.
- 데이터셋은 ID와 버전을 함께 식별합니다. 상세 로딩·실패·비READY 상태에서는 검색하지 않습니다.
- 데이터셋/버전 변경은 기존 결과와 선택을 지우고 이전 상세·Trace 요청을 취소합니다.
- 방향·깊이 변경은 이전 검색을 취소하되 이미 표시된 결과와 적용 조건은 유지합니다.
- 늦은 응답·오류·finally는 요청 번호를 확인하므로 새 화면을 덮어쓰지 않습니다.
- 서버가 409로 데이터셋 상태 변경을 알리면 상세 재조회 전까지 검색을 차단합니다.
- 금액과 블록 번호는 문자열, 시각은 ISO 문자열을 유지합니다. FIXTURE에는 Explorer 링크를 만들지 않습니다.
- finalizedBlock/collectedAt의 null은 각각 '해당 없음'/'미확인'으로 표시합니다.

## 수동 확인

| 데이터셋 | 주소 | 방향 | 깊이 | 기대 결과 |
|---|---|---|---|---|
| flow-demo / v1 | 0x0000000000000000000000000000000000000001 | outgoing | 2 | 6건, 첫 금액 1200 SKK |
| flow-demo / v1 | 0x0000000000000000000000000000000000000007 | outgoing | 2 | 선택한 수집 범위에서 관측되지 않음 |
| flow-demo / v1 | 0x0000000000000000000000000000000000000001 | outgoing | 1 | 3건(공식 샘플 Mock과 달리 실제 API는 이 조건도 지원) |
| collecting-demo / v1 | - | - | - | 정보 표시, 검색 비활성화 |
| invalidated-demo / v1 | - | - | - | 정보 표시, 검색 비활성화 |

부분 결과는 실제 상한·시간 제한에 도달하면 기존 경고와 분석 종료 위치로 표시됩니다.
부분 결과를 강제로 만드는 새 UI는 추가하지 않았습니다. 서비스 테스트에서 공식 부분 결과 샘플을 검증합니다.

## 코드와 테스트

- `main.tsx` → `LiveApp.tsx`: 실제 화면. `state/datasetSession.ts`가 요청과 선택 상태를 관리합니다.
- `api/datasets.ts`, `api/liveTrace.ts`, `api/httpClient.ts`: 실제 HTTP 서비스.
- `components/TraceView.tsx`: Mock·실제 화면이 함께 사용하는 기존 표/그래프/상세.
- `App.tsx`, `api/trace.ts`, `api/mockApi.ts`: 기존 Mock 테스트 호환용. 실제 시작 화면에서는 사용하지 않습니다.
- `onInvalid`는 `createDatasetSession({ onInvalid })` 또는 `createLiveTraceApi().searchTrace({ ..., onInvalid })`에서 선택적으로 받을 수 있습니다. 자동 콘솔 출력은 없습니다.

```powershell
npm test
npm run build
npm run lint
```

기존 테스트와 공식 샘플은 유지하며, 신규 테스트는 HTTP 요청·오류, 선택 상태, 취소·응답 경합과 UI 표시를 검증합니다.
샘플 동기화는 `node scripts/sync-contract.mjs`로 수행합니다. 백엔드 원본은 수정하지 않습니다.
