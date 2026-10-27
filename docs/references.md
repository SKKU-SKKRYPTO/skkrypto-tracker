# 참고 자료

처음 합류했다면 BlockSec의 MetaSleuth 영상과 MetaSleuth 튜토리얼부터 보세요. 우리 실습 흐름과 가장 가깝습니다.

## 기술 문서

- [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/)
- [ERC-20](https://eips.ethereum.org/EIPS/eip-20)
- [go-ethereum](https://geth.ethereum.org/docs/developers/dapp-developer/native)
- [Go net/http](https://pkg.go.dev/net/http)
- [pgx](https://pkg.go.dev/github.com/jackc/pgx/v5)
- [Cytoscape.js](https://js.cytoscape.org/)
- [Base 네트워크](https://docs.base.org/base-chain/quickstart/connecting-to-base)
- [Base Sepolia Explorer](https://sepolia.basescan.org/)

## 참고 서비스

| 서비스 | 참고할 점 |
| --- | --- |
| [MetaSleuth 경량 자금 추적 튜토리얼](https://docs.metasleuth.io/tutorials/advanced-analysis-lightweight-fund-tracking) | outflow를 hop 단위로 펼치고, hop마다 시간 구간을 좁히며, 토큰 필터로 추적. 실습 흐름과 가장 가까움 |
| [Arkham Visualizer](https://codex.arkm.com/the-intelligence-platform/visualizer) | 유입·유출 색 구분, 하단 타임바, 엔티티를 주소로 펼치기. 간선을 합산해 보여 주는 점이 개별 Transfer 간선과 다름 |
| [Etherscan Flow](https://docs.etherscan.io/build-with-ai/skills/etherscan-flow) | 노드·간선 JSON으로 자금 흐름을 그림. 결과 JSON 형식 비교 대상 |
| [Phalcon Explorer](https://blocksec.com/phalcon/explorer) | 단일 거래 분석 도구. Tx Hash 시작점 화면 참고 후보 |

## 구현 참고

| 자료 | 참고할 점 |
| --- | --- |
| [GraphSense](https://arxiv.org/abs/2102.13613) | 오픈소스 구성요소를 갖춘 자금 흐름 분석 플랫폼(2021). 전체 구조 참고 |
| [ethereum-etl](https://ethereum-etl.readthedocs.io/en/latest/commands/) | `export_token_transfers`·`extract_token_transfers`와 `token_transfers.csv` 스키마. 정규화 스키마 대조용 |

## 영상

| 영상 | 참고할 점 |
| --- | --- |
| [BlockSec — Use MetaSleuth to track the stolen funds in a phishing transaction](https://www.youtube.com/watch?v=Ad6sJpiG7Xg) | outflow 펼치기·토큰 필터·엣지 목록. 팀 온보딩 첫 영상 |
| [Lessons with Julie P2 — Etherscan](https://www.youtube.com/watch?v=QhbJQfo8ofI) | Etherscan만으로 USDT 다중 hop 추적, 추적을 멈출 지점 판단. 실습 해설·한계 문서 참고 |
| [Lessons with Julie P1 — Arkham](https://www.youtube.com/watch?v=U83OUI1bMwA) | P2의 앞편 |
| [Follow the Breadcrumbs](https://www.youtube.com/watch?v=zbDwtVWi7mo) | 조사 전 과정 워크스루. 추적 UX 참고 |
| [Analyzing Blockchain and Bitcoin Transaction Data as Graph](https://www.youtube.com/watch?v=w8OEVobyhFE) (2018) | 그래프 DB 파이프라인. Bitcoin 기반이라 개념 참고용 |
