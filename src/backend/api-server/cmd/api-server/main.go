// api-server는 Fixture를 메모리에 올려 API를 띄운다.
// DB 연결은 담당 1의 저장소 구현이 나오면 repository.Repository 자리에 바꿔 끼운다.
//
//	go -C src/backend run ./api-server/cmd/api-server   (레포 루트에서, 또는 make run-api)
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/httpapi"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/repository"
)

func main() {
	addr := env("API_ADDR", ":8080")
	fixtureDir := env("FIXTURE_DIR", "api-server/testdata/fixtures")
	perMinute, err := strconv.Atoi(env("RATE_LIMIT_PER_MINUTE", "120"))
	if err != nil {
		log.Fatalf("RATE_LIMIT_PER_MINUTE는 정수여야 합니다: %v", err)
	}
	var origins []string
	for _, origin := range strings.Split(env("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8081"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			origins = append(origins, origin)
		}
	}

	repo, err := repository.LoadFixtureDir(fixtureDir)
	if err != nil {
		log.Fatalf("Fixture를 읽지 못했습니다: %v", err)
	}
	srv := &http.Server{
		Addr: addr,
		Handler: httpapi.New(httpapi.Config{
			Repo:               repo,
			Engine:             analyzer.New(),
			RateLimitPerMinute: perMinute,
			AllowedOrigins:     origins,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}

	go func() {
		log.Printf("API 서버 시작: http://localhost%s (Fixture: %s)", addr, fixtureDir)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	// Ctrl+C나 docker stop을 받으면 처리 중인 요청을 마치고 끈다.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("종료 중 오류: %v", err)
	}
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
