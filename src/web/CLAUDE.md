# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 작업 범위

이 폴더(`src/web`)는 온체인 트랜잭션 추적 시스템의 웹 화면(Part 4)을 담당합니다. 모노레포의 네 파트는 담당자가 각각 다릅니다.
- `src/indexer`: Part 1, 온체인 토큰 송금 수집
- `src/analyzer`: Part 2, 송금 흐름 분석
- `src/api-server`: Part 3, 추적 결과를 HTTP로 제공
- `src/web`: Part 4, 추적 결과 시각화

규칙:
- **`src/web` 밖의 파일은 만들거나 수정하지 않습니다.** 루트의 `.github/`, `Makefile`, `docker-compose.yml`은 Part 3 담당자가 관리합니다.
- 루트 `.gitignore`는 수정하지 않습니다. 무시 규칙은 `src/web/.gitignore`에 추가합니다.
- 환경 변수는 `src/web/.env.example`에 추가합니다. `.env.example` 외의 `.env*` 파일은 git에서 무시됩니다.
- 새 패키지를 설치하기 전에는 무엇을 왜 설치하는지 먼저 설명하고 허락을 받습니다.

## Git 규칙

- **`git push`는 절대 하지 않습니다.** 커밋도 사용자가 요청할 때만 합니다.
- 커밋 메시지는 Conventional Commits 형식으로 쓰고, 범위는 `web`으로 씁니다. 예: `feat(web): 주소 검색창 추가`
- 한 커밋에는 한 가지 변경만 담습니다.

## 설명 방식

사용자는 개발 초보자입니다. 코드를 바꾼 뒤에는 무엇을 왜 바꿨는지 쉬운 말로 짧게 설명합니다.

## 명령어

`src/web`에서 실행합니다.

```bash
npm run dev       # Vite 개발 서버 (HMR)
npm run build     # tsc -b 타입 검사 후 vite build
npm run lint      # eslint .
npm run preview   # 빌드 결과 미리보기
```

테스트 프레임워크는 아직 없습니다. 타입 검사는 `npm run build`로 합니다.

## 현재 상태와 설정

Vite + React 19 + TypeScript 템플릿 그대로입니다(`src/App.tsx`는 템플릿 페이지). 라우터와 상태 관리 라이브러리는 아직 없습니다.

TypeScript 설정(`tsconfig.app.json`) 중 코드 작성에 영향을 주는 옵션:
- `verbatimModuleSyntax`: 타입만 가져올 때는 `import type`을 씁니다.
- `erasableSyntaxOnly`: `enum`과 생성자 parameter property를 쓸 수 없습니다.
- `noUnusedLocals`, `noUnusedParameters`: 쓰지 않는 변수와 매개변수가 있으면 빌드가 실패합니다.

## Mock 추적 데이터 (`mocks/`)

api-server의 공식 HTTP 샘플이 나오기 전까지 `*.draft.json` 임시 데이터로 화면을 개발합니다. 공식 샘플이 나오면 전부 교체합니다(`mocks/README.md` 참고). 네 파일(`ok`, `empty`, `truncated`, `error`)이 UI가 처리해야 할 네 가지 상태입니다.

응답 구조:
- `dataset`: 데이터 종류(`mode`, `FIXTURE`면 합성 데이터), 상태, `chainId`, `token`(`symbol`, `decimals`), `blockRange`
- `query`: `address`, `direction`(예: `OUT`), `depth`
- `nodes[]`: 결과에 나온 주소 목록
- `transfers[]`: 송금 간선. `from`/`to`, `amount`, 블록·거래 정보, 고유 `id`
- `truncated` / `truncation`: 결과가 잘렸는지. `{ reason: "EDGE_LIMIT", foundCount, isLowerBound }`
- 오류 응답은 구조가 다릅니다: `{ error: { code, message, field } }`

UI 규칙:
- 표·상세·그래프가 같은 송금을 가리킬 때는 `transfers[].id`를 공통 키로 씁니다.
- 금액은 항상 문자열로 다루고 JavaScript `Number`로 바꾸지 않습니다. `amount`는 최소 단위 문자열이므로, 표시할 때 `token.decimals`(18)만큼 소수점을 옮깁니다.
- 빈 결과는 "선택한 수집 범위에서 관측되지 않음"으로 표시합니다. 송금이 없다는 뜻이 아닙니다.
- Fixture의 주소와 거래 해시는 가짜이므로 `FIXTURE` 데이터에는 Explorer 링크를 만들지 않습니다.
