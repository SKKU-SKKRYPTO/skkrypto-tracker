# API 문서

> API를 쓰는 법을 설명합니다. API 모양의 기준은 [`../contracts/openapi.json`](../contracts/openapi.json)이고, 둘이 다르면 openapi.json이 맞습니다.
> 프로젝트 문서(`docs/`)와 겹치지 않게 API 서버 폴더에 둡니다. Wiki에 옮겨 실을 때는 페이지 이름을 파일 이름(확장자 제외)과 같게 하고 링크의 `.md`를 빼며, 이 파일은 `API` 페이지로 씁니다(Wiki Home과 겹치지 않게).

## 이 서비스가 하는 일

정해진 데이터셋(Base Sepolia, ERC-20 토큰 하나, 확정된 블록 구간) 안에서

1. **추적(trace):** 한 주소에서 나간 돈이 1~3 hop 안에 어디까지 이어지는지
2. **경로(paths):** 두 주소 사이에 시간 순서로 이어지는 전송 경로가 있는지
3. **패턴(patterns):** 한 주소가 10분 안에 여러 주소로 나눠 보내거나(분산) 여러 주소에서 받았는지(합류)

를 찾고, 그렇게 판단한 근거 전송을 함께 보여 줍니다.

## 페이지

- [코드 구조](architecture.md): 패키지 경계, 분석 요청 한 번의 흐름, 세 가지 버전
- [API 가이드](API-가이드.md): 웹에서 API를 부르는 순서, 숫자·시각 다루기, 부분 결과 표시, 오류 처리
- API별 페이지(목적·요청·응답 예시·상태 코드·잘림과 오류·변경 이력)
  - [GET /api/datasets](API-datasets.md) · [GET /api/datasets/{id}](API-dataset.md)
  - [GET /api/transfers](API-transfers.md) · [GET /api/transactions/{txHash}](API-transaction.md)
  - [POST /api/trace](API-trace.md) · [POST /api/paths](API-paths.md) · [POST /api/patterns](API-patterns.md)

## 갱신 규칙

- API를 바꾼 PR은 이 폴더의 해당 페이지와 변경 이력(PR 번호)을 같은 PR에서 고칩니다. Wiki에도 싣는다면 PR 본문에 "Wiki 갱신 대상"을 적고, 병합 뒤 담당 3이 옮깁니다.
- Wiki에 싣는다면 편집을 저장소 쓰기 권한자로 제한합니다(Settings → Features → Wikis의 "Restrict editing to collaborators only"). public 저장소는 기본값이면 외부인도 편집할 수 있습니다.

## 용어

| 용어 | 뜻 |
|---|---|
| 데이터셋 | 수집한 데이터 한 벌. `datasetId` + `datasetVersion`으로 구분한다 |
| 수집 범위(coverage) | 데이터셋이 수집한 블록·시간 구간. 범위 밖은 "없음"이 아니라 "모름" |
| 전송(Transfer) | ERC-20 Transfer 로그 하나. 위치(블록·거래 순서·로그 순서)로 앞뒤를 정한다 |
| hop | 전송 한 번. S→A→D는 2 hop |
| 노드·엣지 | 주소가 노드(점), 전송이 엣지(선) |
| BFS | 가까운 것부터 한 단계씩 넓혀 가는 탐색. 1 hop을 모두 본 뒤 2 hop을 본다 |
| 부분 결과 | 상한에 걸려 일부만 돌려준 결과. `truncated.reason`에 사유가 있다 |
| FAN_OUT·FAN_IN | 분산(한 주소 → 여러 주소)·합류(여러 주소 → 한 주소) |
