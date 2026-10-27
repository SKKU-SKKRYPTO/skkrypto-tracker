# 임시 Mock 데이터 (draft)

찬수님의 공식 HTTP 샘플이 나오기 전까지 화면 개발용으로 쓰는 **임시 데이터**입니다.
공식 샘플이 나오면 전부 교체합니다. 파일 이름의 `.draft`가 그 표시입니다.

모든 주소·거래 번호는 가짜(Fixture)라서 Explorer 링크를 만들지 않습니다.

## 파일

- `trace-ok.draft.json`: 정상 결과. A가 B에게 5 TST를 보내고, B가 4분 안에 C·D·E로 나눠 보낸 상황(분산 패턴 예시)
- `trace-empty.draft.json`: 빈 결과. "선택한 수집 범위에서 관측되지 않음"으로 표시해야 함
- `trace-truncated.draft.json`: 부분 결과. 간선 상한(EDGE_LIMIT)에 걸려 일부만 옴
- `trace-error.draft.json`: 오류. 잘못된 주소 입력

## 주요 필드

- `dataset`: 지금 보는 데이터의 종류·버전·상태·범위. `mode`가 `FIXTURE`면 합성 데이터
- `transfers[].id`: 송금 한 건의 고유 번호. 표·상세·그래프가 같은 송금을 가리킬 때 이 값을 씀
- `transfers[].amount`: 금액. **문자열**이며 `decimals`(18)만큼 소수점을 옮겨 표시. 숫자로 바꾸지 않음
- `truncated` / `truncation`: 결과가 잘렸는지, 이유와 찾은 개수
