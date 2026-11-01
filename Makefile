# 자주 쓰는 명령 모음. `make help`로 목록을 본다.
# 명령 이름은 docs/conventions.md '실행 명령'을 따른다. 담당 1(test-data)·담당 4(web-mock, test-web) 명령은 각 담당이 추가한다.
# Go 모듈은 src/backend 하나라서 Go 명령은 그 폴더에서 실행한다(go -C).

GO ?= go
BACKEND := src/backend

.PHONY: help check test test-data test-engine test-api test-integration samples run-api demo-fixture

help: ## 명령 목록 보기
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-17s %s\n", $$1, $$2}'

check: ## PR 올리기 전 검사: CI의 backend 검사와 같은 gofmt·vet·go test -race
	@out=$$(gofmt -l $(BACKEND)) || exit 1; test -z "$$out" || { echo "gofmt가 필요한 파일:"; echo "$$out"; exit 1; }
	$(GO) -C $(BACKEND) vet ./...
	$(GO) -C $(BACKEND) test -race ./...

test: ## Go 테스트 전체
	$(GO) -C $(BACKEND) test ./...

test-data: ## 담당 1: 공통 타입·Fixture·PostgreSQL 저장·RPC Stub 단위 테스트
	$(GO) -C $(BACKEND) test ./domain/... ./api-server/repository/... ./indexer/...

test-engine: ## 담당 2: 공통 타입·분석 엔진 테스트
	$(GO) -C $(BACKEND) test ./domain/... ./analyzer/...

test-api: ## 담당 3: API 서버 테스트(샘플 비교 포함)
	$(GO) -C $(BACKEND) test ./api-server/...

test-integration: ## 담당 3: 실제 저장소(Fixture)·엔진으로 핵심 흐름·샘플·성능 확인
	$(GO) -C $(BACKEND) test -count=1 ./api-server/httpapi -run 'TestFixtureFlow|TestResponsesMatchSamples|TestTenThousand' -v

samples: ## 규격을 일부러 바꾼 뒤 샘플을 지금 응답으로 다시 만들기
	$(GO) -C $(BACKEND) test ./api-server/httpapi -run TestResponsesMatchSamples -update

run-api: ## Fixture로 API 서버 실행(http://localhost:8080)
	$(GO) -C $(BACKEND) run ./api-server/cmd/api-server

demo-fixture: ## 시연용: 지금은 Fixture API만 실행(웹·DB가 붙으면 함께 띄우게 바꾼다)
	@echo "demo-fixture: 웹·DB 연결 전이라 지금은 Fixture API만 띄웁니다(run-api와 같음)."
	$(GO) -C $(BACKEND) run ./api-server/cmd/api-server
