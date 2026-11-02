# 개발 규칙

`main`은 항상 실행·데모 가능한 상태로 둡니다. 모든 변경은 짧은 브랜치 → PR → 리뷰 승인 → CI 통과 → Squash merge로 들어갑니다.

## 브랜치 — GitHub Flow

- `main`에 직접 push하지 않는다. 병합한 브랜치는 삭제한다.
- `develop`·`release/`·`hotfix/` 브랜치는 두지 않는다. 긴급 수정도 `fix/`로 처리한다.
- 데모·제출 시점은 `main`의 태그로 표시한다.
- `main` 보호: PR 필수, 작성자 외 승인 1명, 리뷰 대화 모두 resolve, Squash merge만 허용. CI는 PR마다 돌지만 아직 병합 필수 조건은 아니다.

### 브랜치 이름 — [Conventional Branch](https://conventionalbranch.org/)

```txt
feature/issue-12-trace-api
└─┬──┘ └───────┬────────┘
  종류      이슈 번호 + 작업 내용
```

| 종류 | 언제 | 예시 |
| --- | --- | --- |
| `feature` (`feat`) | 새 기능 | `feature/issue-12-trace-api` |
| `fix` (`bugfix`) | 버그 수정, 긴급 수정 포함 | `fix/issue-31-cursor-overflow` |
| `chore` | 의존성·설정·빌드 | `chore/upgrade-pgx-v5.7` |
| `claude`·`codex`·`copilot`·`cursor`·`ai` | AI 에이전트가 만든 브랜치 | `claude/issue-40-fixture-seed` |

- 영문 소문자와 숫자만 쓰고, 단어 사이는 하이픈 하나로 잇는다.
- 작업 내용은 2~4단어로 쓴다. 점은 버전 번호에만 쓴다.
- 하이픈이나 점으로 시작·끝내지 않고, 연달아 쓰지 않는다.

CI가 아래 정규식으로 검사합니다.

```txt
^(feature|feat|fix|bugfix|chore|ai|claude|codex|copilot|cursor)/[a-z0-9]+([.-][a-z0-9]+)*$
```

## 커밋 메시지 — [Conventional Commits 1.0.0](https://www.conventionalcommits.org/ko/v1.0.0/)

```txt
feat(api): 후보 경로 응답에 잘림 사유 추가          ← 제목: 종류(범위): 무엇을 바꿨는지

경로 개수 외의 상한으로 중단될 때도 사유를 구분해    ← 본문: 왜 (선택)
반환한다. 화면에서 "연결 없음"과 "탐색 중단"을 구분하기 위함.

Refs: #12                                            ← 꼬리말: 관련 이슈 (선택)
```

| 종류 | 언제 |
| --- | --- |
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `refactor` | 동작은 그대로 두고 구조만 변경 |
| `perf` | 성능 개선 |
| `test` | 테스트 추가·수정 |
| `docs` | 문서 |
| `build` | 빌드 설정·의존성 |
| `ci` | CI 설정 |
| `style` | 포맷·공백 |
| `chore` | 그 밖의 잡무 |
| `revert` | 이전 커밋 되돌리기 |

| 범위 | 대상 |
| --- | --- |
| `data` | 수집·DB (담당 1) |
| `engine` | 경로·패턴 엔진 (담당 2) |
| `api` | 조회·분석 API (담당 3) |
| `web` | 화면 (담당 4) |
| `contract` | 공통 규격·OpenAPI·HTTP 샘플 |
| `infra` | Compose·CI·Makefile |

- 제목 설명은 한국어로, 50자 안팎, 마침표 없이 쓴다. "수정"·"업데이트"처럼 내용 없는 제목은 쓰지 않는다.
- 본문에는 왜 바꿨는지를 쓴다. 코드를 보면 알 수 있는 내용은 반복하지 않는다.
- 이슈는 꼬리말 `Refs: #12`로 연결한다. PR 본문에 `Closes #12`를 쓰면 병합 때 이슈가 닫힌다.
- Squash merge라서 PR 제목이 그대로 `main`의 커밋 제목이 된다. PR 제목도 같은 형식으로 쓴다.

### 규격을 깨는 변경

필드 삭제·이름·타입·필수 여부·정렬·상태 의미를 바꾸면 범위 뒤에 `!`를 붙이고, 꼬리말에 무엇이 깨지는지 적습니다.

```txt
feat(contract)!: 잘림 사유를 문자열에서 enum으로 변경

BREAKING CHANGE: truncated.reason의 값이 PATH_LIMIT 등 6개로 고정된다.
담당 4는 화면 문구 매핑을 갱신해야 한다.
```

### 자동 검사

- PR 제목: action-semantic-pull-request로 종류·범위 검사
- 커밋: 따로 검사하지 않는다. Squash merge라 `main`에는 PR 제목만 남는다.
- 브랜치 이름: 위 정규식
- 코드: `backend`(gofmt·vet·`go test -race`), `web`(lint·build), `database`(migration up → rollback → up). 설정은 `.github/workflows/`에 있다.

## 변경·리뷰

- **작업 기록**: 이슈 체크리스트·PR·테스트 결과로 남긴다.
- **리뷰 대화**: 사람·CodeRabbit의 지적마다 "고침(커밋)" 또는 "안 고침 + 이유 한 줄"로 답하고 resolve한다. 미해결 대화가 있으면 병합되지 않는다.
- **규격 변경**: 새 버전과 소비자 확인이 필요하다. 선택 필드 추가도 스키마·샘플·소비자 테스트로 검증한다.
- **장애 공유**: 보안·정밀도·원천 의미 오류, 통합 실패, 범위·마감 영향은 소유자에게 이슈로 전달한다. 재현 입력·로그·기대/실제 결과·수정안을 포함한다.
- **리허설**: 담당 4가 고정 시나리오를 2회 실행·기록하고, 실패 영역은 해당 소유자가 고친다.

## 실행 명령

| 명령 | 담당 | 검증 범위 |
| --- | --- | --- |
| `make test-data` | 1 | DB·Fixture·수집·Repository |
| `make test-engine` | 2 | DB·RPC 없는 엔진 테스트 |
| `make test-api` | 3 | Fake·Stub 기반 API 테스트 |
| `make web-mock` / `make test-web` | 4 | Mock 웹 실행·단위·E2E |
| `make demo-fixture` | 3 | Seed·실제 엔진·API·웹 실행 |
| `make test-integration` | 3 | 실제 구현·규격·핵심 흐름 검증 |

- 공통 실행 명령·Compose는 담당 3이, CI는 리드가 관리한다. 각 담당자는 자기 모듈의 실행·테스트 진입점을 제공한다.
- 웹은 Mock 모드와 `VITE_API_BASE_URL` 기반 실제 API 모드를 구분한다.
- DB·RPC 비밀값은 서버 환경에만 둔다.

## 비공개 정답 분리

코드 저장소는 public입니다. 비공개 정답·정답 Fixture·출제자 라벨은 이 저장소에 커밋하지 않고(삭제해도 이력에 남습니다) 별도 private 저장소 `Jeon1691/skkrypto-tracker-labs`에 둡니다. 정답 회귀 테스트도 그 저장소에서 실행합니다. 이 저장소에는 공개 개발 예시만 둡니다.

정답 저장소는 조직이 아니라 리드 개인 계정에 있습니다. 조직의 기본 권한이 읽기라서, 조직에 두면 실습 참가자를 포함한 조직 멤버 전원이 정답을 볼 수 있기 때문입니다. 접근 권한은 리드와 팀원 3명(AVG-High·cryscham123·lauren1331)에게만 있습니다.
