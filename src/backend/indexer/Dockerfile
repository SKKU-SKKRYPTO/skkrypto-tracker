# Indexer 이미지. Go 모듈 루트(src/backend)를 빌드 컨텍스트로 쓴다.
#   docker build -f src/backend/indexer/Dockerfile -t skkrypto-indexer src/backend
# RPC_URL·DATABASE_URL은 이미지에 넣지 않고 실행할 때 환경 변수로 받는다(src/backend/.dockerignore가 .env를 뺀다).

FROM golang:1.24-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY domain ./domain
COPY indexer ./indexer
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/indexer ./indexer/cmd/indexer

# 실행 이미지에는 실행 파일과 토큰 목록만 넣는다.
# Compose가 INDEXER_* 환경 변수를 collect 인자로 옮길 때 셸이 필요해서 distroless 대신 alpine을 쓴다.
FROM alpine:3.21
RUN adduser -D -H -u 65532 nonroot
WORKDIR /app
COPY --from=build /out/indexer /usr/local/bin/indexer
# collect의 기본 --tokens 경로(indexer/tokens.json)가 작업 폴더(/app) 기준으로 맞게 둔다.
COPY indexer/tokens.json /app/indexer/tokens.json
USER nonroot
ENTRYPOINT ["indexer"]
