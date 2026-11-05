# Indexer

Base Sepolia의 허용된 ERC-20 `Transfer` 로그를 고정 블록 범위로 수집해 PostgreSQL에 Snapshot Dataset을 저장합니다. 수집 명령은 `RPC_URL`과 `DATABASE_URL`을 실행 환경에서만 읽으며, `.env` 파일을 자동으로 로드하지 않습니다.

## 설정

레포 루트에서 실행할 때 기본 토큰 목록은 `src/backend/indexer/tokens.json`이 아니라 Go 모듈 기준 `indexer/tokens.json`입니다. 다른 파일은 `--tokens`로 명시합니다.

```sh
export RPC_URL='https://<provider>'
export DATABASE_URL='postgres://<user>:<password>@<host>:5432/<database>?sslmode=disable'
```

URL·키·비밀번호를 CLI 인자로 넘기거나 로그·Manifest에 기록하지 않습니다. PostgreSQL 연결 풀은 수집 잠금과 저장 트랜잭션이 동시에 사용할 수 있도록 최소 2개 연결을 사용합니다.

## 수집

Dataset ID·버전·namespace·토큰·포함 블록 범위를 명시합니다. 종료 블록은 실행 시 확인한 Base Sepolia `finalized` 블록 이하여야 합니다.

```sh
go -C src/backend run ./indexer/cmd/indexer collect \
  --dataset-id base-usdc \
  --dataset-version v1 \
  --namespace base-sepolia \
  --token 0x036cbd53842c5426634e7929541ec2318f3dcf7e \
  --start-block 100 \
  --end-block 200 \
  --tokens indexer/tokens.json
```

성공하면 stdout에는 Manifest JSON만, stderr에는 구조화된 실행 로그만 출력됩니다. 필요하면 `> manifest.json`으로 저장합니다.

기본 청크는 2,000블록입니다. 공급자의 범위·결과 제한이면 최소 1블록까지 절반으로 줄이고, 5개 청크 연속 성공 시 최대 10,000블록까지 두 배로 늘립니다. 일시 오류는 최초 호출 뒤 최대 3회, 250ms부터 최대 2초까지 backoff합니다. 관련 값은 `collect --help`의 비밀값이 아닌 플래그로 조정할 수 있습니다.

## 재개와 상태

- `COLLECTING`: 같은 ID·버전·namespace·토큰·범위로 다시 실행하면 마지막 원자적 청크 다음부터 재개합니다.
- `FAILED`: 같은 입력과 버전으로 다시 실행하면 저장된 경계 hash를 확인한 뒤 재개합니다.
- `READY`: 전체 범위와 모든 경계를 다시 확인해 게시된 불변 버전입니다. 같은 버전으로 재수집하지 않습니다.
- `INVALIDATED`: 저장 경계 hash가 달라진 버전입니다. 기존 내용은 유지하고 새 버전을 명시해 다시 수집합니다.

갑작스러운 중단은 마지막 완전 커밋까지만 남깁니다. 청크 저장과 재개 지점은 한 DB 트랜잭션으로 커밋됩니다.

## Manifest 다시 출력

READY Dataset은 RPC 없이 PostgreSQL 읽기만으로 다시 출력할 수 있습니다. 이 명령은 `DATABASE_URL`만 필요하며 수집 잠금이나 상태 변경을 수행하지 않습니다.

```sh
go -C src/backend run ./indexer/cmd/indexer manifest \
  --dataset-id base-usdc \
  --dataset-version v1
```

## Docker Compose로 수집

호스트에 Go 없이 Compose 네트워크 안에서 한 번 수집하고 멈추는 배치로 실행할 수 있습니다. 기본 `docker compose up -d`에서는 뜨지 않고 `collect` profile에서만 실행됩니다.

```sh
cp src/database/.env.example src/database/.env   # 처음 한 번: DB 계정(이미 했으면 생략). indexer DATABASE_URL도 같은 계정으로
cp src/backend/indexer/.env.example src/backend/indexer/.env   # RPC_URL·DATABASE_URL·INDEXER_* 채우기
docker compose --profile collect up --build -d
docker compose logs -f indexer
```

- `INDEXER_*` 값은 Compose가 위 `collect` 인자로 옮기고, 토큰 목록은 이미지에 들어 있는 `tokens.json`을 씁니다.
- `DATABASE_URL`의 호스트는 `postgres:5432`입니다. RPC URL·DB 비밀번호는 이미지에 넣지 않고 실행할 때만 `.env`에서 받습니다.
- READY Manifest는 RPC 없이 다시 출력합니다: `docker compose run --rm -T --entrypoint indexer indexer manifest --dataset-id <ID> --dataset-version <VERSION>`

## 검증

자동 검증은 외부 서비스가 필요 없는 Go 단위 테스트입니다.

```sh
make test-data
make check
```

실제 Base Sepolia 검증은 별도 수동 절차입니다. PostgreSQL이 healthy인지 확인한 뒤 고유 Dataset 버전으로 제한된 범위를 수집하고, 최소 10개 저장 전송을 RPC Receipt·Block 및 BaseScan과 대조합니다. RPC URL과 DB 자격 증명은 검증 기록에서 제거하며, 수집 탐색·재시도에는 프로젝트 검증 문서의 시간·호출 상한을 적용합니다.
