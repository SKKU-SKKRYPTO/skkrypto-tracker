# SKKRYPTO Tracker Web

React + TypeScript + Vite 프론트엔드. API v1 대응 1단계는 실제 서버 대신 공식 JSON 샘플을 사용합니다.
데이터셋은 `flow-demo / v1`입니다. 새 패키지는 필요하지 않습니다.

```sh
npm ci
npm run dev
npm test
npm run build
npm run lint
```

## 확인할 검색

| 결과 | 주소 | 방향 | 깊이 | Mock 확인 모드 | 기대 결과 |
|---|---|---|---|---|---|
| 정상 | 0x0000000000000000000000000000000000000001 | 보낸 쪽(outgoing) | 2 | 기본 샘플 | 표 6건, 노드 6개, 간선 6개, 첫 금액 1200 SKK |
| 빈 결과 | 0x0000000000000000000000000000000000000007 | 보낸 쪽(outgoing) | 2 | 기본 샘플 | 선택한 수집 범위에서 관측되지 않음 |
| 부분 결과 | 0x0000000000000000000000000000000000000001 | 보낸 쪽(outgoing) | 3 | 후보 상한 4 | 4건, CANDIDATE_LIMIT, 블록 18205040까지만 분석 |
| Mock 미지원 | 0x0000000000000000000000000000000000000001 | 받은 쪽(incoming) | 2 | 기본 샘플 | Mock 미지원 안내(실제 API 제한 아님) |
| API 오류 샘플 | 0x123 | 보낸 쪽(outgoing) | 2 | 기본 샘플 | 공식 INVALID_INPUT / HTTP 400 안내 |

주소 입력·방향·깊이 메뉴·검색 중 표시·표/그래프/상세 선택·복사 기능을 유지합니다.
조건 메뉴를 바꾸어도 다시 검색하기 전에는 기존 결과의 실제 적용 조건을 표시합니다.
FIXTURE 데이터에는 Explorer 링크를 만들지 않습니다.

## 구성

- `src/api/v1Types.ts`: 공식 OpenAPI에서 생성한 API 원본 타입.
- `src/api/validateV1.ts`: 응답의 계약 구조 검사.
- `src/api/mockApi.ts`: 공식 요청과 조건이 일치하는 샘플만 재생. 네트워크 호출 없음.
- `src/api/trace.ts`: 고정 데이터셋 및 사용자 조건으로 요청 구성.
- `src/adapters/traceAdapter.ts`: API 오류/잘못된 응답 구분 및 UI 모델 변환.
- `src/types.ts`: 표·그래프·상세가 공유하는 UI 모델.
- `src/format.ts`: 문자열 금액, 전송별 asset, ISO 시각 표시.

샘플 동기화와 범위는 `mocks/README.md`를 참고하세요.
샘플을 바꿀 때는 `node scripts/sync-contract.mjs` 실행 후 테스트·빌드·린트를 확인합니다.
