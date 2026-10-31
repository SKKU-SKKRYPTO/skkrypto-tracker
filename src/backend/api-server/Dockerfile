# API 서버 이미지. Go 모듈 루트(src/backend)를 빌드 컨텍스트로 쓴다.
#   docker build -f src/backend/api-server/Dockerfile -t skkrypto-api src/backend

FROM golang:1.24-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY domain ./domain
COPY analyzer ./analyzer
COPY api-server ./api-server
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api-server ./api-server/cmd/api-server

# 실행 이미지에는 실행 파일과 Fixture만 넣는다(셸·패키지 관리자 없음).
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/api-server /app/api-server
COPY api-server/testdata/fixtures /app/fixtures
ENV API_ADDR=:8080 \
    FIXTURE_DIR=/app/fixtures
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/api-server"]
