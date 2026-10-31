# 공식 API v1 Mock

원본: `src/backend/api-server/contracts/`. `openapi.json`이 최우선 기준입니다.
`v1/`에는 원본 OpenAPI, sample-requests.json, 응답 샘플 20개를 변경 없이 복사합니다.
원본을 갱신한 뒤 `src/web`에서 `node scripts/sync-contract.mjs`를 실행하면
복사본과 `src/api/v1Types.ts`를 함께 갱신합니다. 백엔드 파일은 읽기만 합니다.
`npm test`는 복사본과 원본의 일치 및 20개 응답의 엔드포인트별 구조를 검사합니다.

## 화면에서 지원하는 요청

데이터셋은 `flow-demo / v1`로 고정합니다. 전체 주소는 README의 확인 표를 참고하세요.

| Mock 확인 모드 | 주소 끝자리 | 방향 | 깊이 | 샘플 |
|---|---|---|---|---|
| 기본 샘플 | 0001 | outgoing | 2 | trace-success.json |
| 기본 샘플 | 0007 | outgoing | 2 | trace-ready-empty.json |
| 후보 상한 4 | 0001 | outgoing | 3 | trace-candidate-limit.json |

사용자가 고른 깊이는 바꾸지 않습니다. 후보 상한 모드는 명시적으로
`limits.maxCandidates: 4`를 요청에 추가합니다. 깊이를 3으로 고르는 것만으로
부분 결과가 되지는 않습니다. 지원하지 않는 조합을 빈 결과로 바꾸지 않습니다.
이 제한은 로컬 샘플 재생 범위이며 실제 백엔드 API의 지원 범위가 아닙니다.

잘못된 주소 형식은 공식 공통 INVALID_INPUT 샘플(HTTP 400)을 사용합니다.
이 오류 샘플의 원래 요청은 /api/paths이지만, 동일한 공통 오류 규격이
/api/trace에도 정의되어 있습니다. 오류 표시에는 공식 샘플 재생임을 명시합니다.

나머지 샘플은 원래 데이터셋·엔드포인트·상태 코드를 유지한 채 타입/회귀 테스트에 사용합니다.
다른 데이터셋의 응답을 flow-demo trace 결과로 사용하지 않습니다.
8개 오류 샘플은 Adapter 테스트에서 실제 API 오류 형식으로 처리하는지 검증합니다.

## 경계

- API 오류: v1 오류 envelope와 HTTP 상태를 검증하고 code/message/retryable 보존.
- Mock 미지원: API 오류 코드를 만들지 않고 별도 kind로 안내.
- 응답 형식 오류: 잘못된 JSON 문법, 필드 타입, 요청/데이터셋 불일치 등을 별도 kind로 안내.
- validateV1.ts는 현재 체크인된 계약에서 사용하는 키워드를 지원하는 검사기입니다.
  범용 JSON Schema 검증기가 아니므로 계약에 새 키워드가 생기면 함께 검토해야 합니다.
- 실제 서버 연결, trace 분석 재현, 데이터셋 선택, paths/patterns 화면은 이번 범위 밖입니다.
