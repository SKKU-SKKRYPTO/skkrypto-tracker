# 수집 대상 토큰

수집기는 이 목록에 있는 토큰의 Transfer 로그만 수집합니다([정확성·보안 기준](correctness-security.md)). 수집기가 읽는 파일은 [`src/backend/indexer/tokens.json`](../src/backend/indexer/tokens.json)이고, 구조는 `assets` 테이블(`chainId`, `tokenAddress`, `symbol`, `decimals`)과 같습니다.

체인은 Base Sepolia(`chainId` 84532)입니다.

## 목록

발행처 문서에 주소가 있는 토큰만 넣었습니다. 최근 전송 수는 2026-10-31에 `finalized` 블록 기준 1,000블록(약 200초)을 세어 본 값입니다.

| 토큰 | 주소 | 자릿수 | 발행처 | 최근 전송 | 쓰임 |
| --- | --- | --- | --- | --- | --- |
| USDC | `0x036cbd53842c5426634e7929541ec2318f3dcf7e` | 6 | Circle | 333건 | 첫 데이터셋. 실제 거래가 많아 분산·합류 패턴이 자연스럽게 나온다 |
| EURC | `0x808456652fdb597867f38412077a9182bf77359f` | 6 | Circle | 2건 | 실습용 거래. 다른 거래가 적어 직접 만든 흐름이 묻히지 않는다 |
| WETH | `0x4200000000000000000000000000000000000006` | 18 | Base(OP Stack 기본 컨트랙트) | 12건 | DEX 등 컨트랙트 거래 |
| LINK | `0xe4ab69c077896252fafbd49efd26b5d171a32410` | 18 | Chainlink | 0건 | 실습용 거래 |

데이터셋 하나는 토큰 하나를 담습니다(`datasets`의 `chain_id`·`token_address`). 첫 데이터셋은 USDC로 만들고, 다른 토큰의 데이터셋은 [개발 범위](scope.md)의 P1 "두 번째 ERC-20"에 해당합니다.

## 넣지 않은 것

- **기본 코인 ETH(0 주소)**: ERC-20 컨트랙트가 아니어서 Transfer 로그가 없습니다. 수집하려면 블록의 거래 자체를 읽는 수집이 따로 필요하고, 이는 P1 "최상위 ETH 전송"입니다. 0 주소는 발행·소각 표시로도 쓰여 기본 분석에서 제외됩니다.
- **USDT**: Tether가 Base Sepolia에 배포한 공식 주소가 없습니다. 같은 이름의 토큰은 여럿 있지만 발행자를 확인할 수 없습니다. Aave 테스트용 USDT(`0x0a215d8ba66387dca84b284d18c3b4ec3de6e54a`)도 있으나 Tether 발행이 아니고 최근 전송이 없습니다.
- **이름만 같은 토큰**: Base Sepolia에는 `USDC`·`cbETH`처럼 같은 이름의 토큰이 여럿 있습니다. 자산은 주소로 구분하므로, 이름이 아니라 발행처 문서의 주소로 고릅니다.

## 수집할 때 주의할 점

- **공개 RPC 제한**: `https://sepolia.base.org`는 `eth_getLogs`를 100블록 범위까지만 받고, 500블록 이상은 HTTP 413으로 거부합니다. `User-Agent` 헤더가 없으면 403입니다. 청크를 100블록 이하로 잡거나 RPC 제공자 주소를 `.env`로 받습니다.
- **블록 속도**: 블록이 약 0.2초마다 나옵니다. 1,000블록이 약 200초입니다.
- **finalized 지연**: `finalized`가 최신 블록보다 약 4,600~5,400블록(약 15분) 늦습니다. 수집 종료 블록은 이 안에서 고릅니다.
- **USDC 구간 길이**: USDC는 분당 80~100건이 오갑니다. 분석 후보 상한이 10,000건(`src/backend/analyzer/request.go`)이므로 데이터셋 구간은 1시간 안팎으로 잡습니다.
- **WETH 예치·출금**: ETH를 넣고 빼는 동작은 `Deposit`·`Withdrawal` 이벤트로 남고 Transfer 로그가 아닙니다. 수집한 전송만으로 잔액을 맞춰 보면 차이가 납니다.

## 실습용 토큰 받기

- USDC·EURC: [Circle Faucet](https://faucet.circle.com/)
- LINK: [Chainlink Faucet](https://faucets.chain.link/base-sepolia)
- 수수료용 ETH: [Base 문서의 Faucet 목록](https://docs.base.org/tools/network-faucets)

## 목록을 바꿀 때

- `tokens.json`과 이 문서를 같은 PR에서 바꿉니다.
- 주소는 소문자로 쓰고, 발행처 문서 링크를 아래 출처에 남깁니다.
- 이미 게시한 데이터셋 버전의 토큰은 바꾸지 않습니다. 새 버전을 만듭니다.

## 출처

- [Circle — USDC 컨트랙트 주소](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Circle — EURC 컨트랙트 주소](https://developers.circle.com/stablecoins/eurc-contract-addresses)
- [Chainlink — LINK 토큰 컨트랙트](https://docs.chain.link/resources/link-token-contracts)
- [Optimism — OP Stack 기본 컨트랙트(WETH9)](https://specs.optimism.io/protocol/predeploys.html)
- [Aave Address Book — AaveV3BaseSepolia](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3BaseSepolia.sol)
- [Base Sepolia Blockscout](https://base-sepolia.blockscout.com)
