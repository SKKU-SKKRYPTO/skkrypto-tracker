# 구조와 기술 스택

수집기가 RPC 또는 Fixture에서 전송을 모아 PostgreSQL에 저장하고, Go API가 분석 엔진을 호출해 React 웹에 결과를 줍니다. 수집 실행은 웹 API가 아니라 운영자 CLI로 분리합니다.

```txt
RPC / Fixture → 수집·정규화 → PostgreSQL → 분석 엔진 → Go API → React 웹
                                                    └→ 결과 JSON
```

## 모듈 경계

```txt
담당 1: 수집·DB ── Repository ──┐
                              담당 3: API ── HTTP ── 담당 4: 화면
담당 2: 분석 엔진 ── Engine ────┘
```

| 경계 | 연결 방식 | 정의 | 구현 |
| --- | --- | --- | --- |
| 수집·DB ↔ API | Repository 인터페이스 | 담당 3 | 담당 1 |
| 분석 ↔ API | Engine (`Trace`·`Paths`·`Patterns`) | 담당 2 | 담당 2 |
| API ↔ 화면 | HTTP 규격 (OpenAPI) | 담당 3 | 담당 3 |

- 모듈은 공개 인터페이스로만 연결합니다. API는 SQL·테이블 구조에 의존하지 않고, 경로·패턴 알고리즘을 복제하지 않습니다.
- 공통 도메인에는 타입·금액·위치 표현만 둡니다. DB·HTTP·RPC·UI 의존성과 분석 알고리즘은 넣지 않습니다.
- 엔진은 DB·HTTP·RPC를 직접 호출하지 않습니다. 브라우저는 DB·RPC를 호출하거나 경로·패턴을 따로 계산하지 않습니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 수집·서버 | Go, go-ethereum, net/http + chi |
| 저장 | PostgreSQL 16, pgx |
| 분석 | Adjacency List, 제한된 BFS, Sliding Window |
| 화면 | TypeScript, Vite·React, TanStack Query, Zod, Cytoscape.js |
| 검증·실행 | Go testing, Vitest, Playwright, Docker Compose |

## 데이터

| 테이블 | 용도 |
| --- | --- |
| `datasets` | 데이터셋 ID·버전·모드·범위·상태 |
| `ingestion_chunks` | 수집 청크와 체크포인트 |
| `blocks` | 블록 번호·해시·시각 |
| `transactions` | 거래 |
| `transfers` | 정규화한 Transfer 로그 |
| `dataset_transfers` | 데이터셋 버전별 전송 연결 |

### 공통 데이터 규격

- 데이터셋 키: `datasetId + datasetVersion`
- 원천 구분: `sourceMode + sourceNamespace` (Fixture 또는 Snapshot)
- 자산 키: `chainId + tokenAddress`
- 전송 필드: 원본 `id`, 자산, 송신·수신, `amountRaw`, 전송 유형, 블록·거래·로그 위치, 시각. Snapshot은 실제 거래·블록 해시를 포함
- 정렬: `(blockNumber, transactionIndex, logIndex, id)`
