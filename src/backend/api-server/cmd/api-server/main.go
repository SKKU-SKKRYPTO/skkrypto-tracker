// api-server는 API를 띄운다. DATABASE_URL이 있으면 PostgreSQL에서, 없으면 Fixture를 메모리에 올려 읽는다.
// PRACTICE_ANSWERS_JSON(또는 PRACTICE_ANSWERS_FILE)이 있으면 실습 채점(POST /api/practice/grade)을 켜고,
// 정답이 있는 데이터셋은 PRACTICE_DATASETS처럼 경로 찾기(/api/paths)를 막는다.
//
//	go -C src/backend run ./api-server/cmd/api-server   (레포 루트에서, 또는 make run-api)
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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
	origins := list(env("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8081"))
	practice := list(os.Getenv("PRACTICE_DATASETS"))

	// 실습 정답은 값(PRACTICE_ANSWERS_JSON, Railway 비밀 변수)이나 파일 경로로 받는다. 로그에는 문제 수만 남긴다.
	answers, err := loadPracticeAnswers(os.Getenv("PRACTICE_ANSWERS_JSON"), os.Getenv("PRACTICE_ANSWERS_FILE"))
	if err != nil {
		log.Fatal(err)
	}
	if answers != nil {
		log.Printf("실습 채점 켬: 문제 %d개(정답이 있는 데이터셋은 경로 찾기를 막음)", answers.Len())
	}

	repo, source, closeRepo, err := openRepository(os.Getenv("DATABASE_URL"), fixtureDir)
	if err != nil {
		log.Fatal(err)
	}
	defer closeRepo()
	srv := &http.Server{
		Addr: addr,
		Handler: httpapi.New(httpapi.Config{
			Repo:               repo,
			Engine:             analyzer.New(),
			RateLimitPerMinute: perMinute,
			AllowedOrigins:     origins,
			PracticeDatasets:   practice,
			PracticeAnswers:    answers,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}

	go func() {
		log.Printf("API 서버 시작: http://localhost%s (데이터: %s)", addr, source)
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

// openRepository는 dsn이 있으면 PostgreSQL 저장소를, 비어 있으면 Fixture 저장소를 연다.
// 돌려주는 설명은 로그용이라 접속 주소의 계정·비밀번호는 넣지 않는다.
// DB에 처음 연결되지 않으면 바로 실패한다(Railway는 재시작 정책으로 다시 띄운다).
func openRepository(dsn, fixtureDir string) (repository.Repository, string, func(), error) {
	if dsn == "" {
		repo, err := repository.LoadFixtureDir(fixtureDir)
		if err != nil {
			return nil, "", nil, fmt.Errorf("Fixture를 읽지 못했습니다: %w", err)
		}
		return repo, "Fixture " + fixtureDir, func() {}, nil
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		// 파싱 오류에는 접속 주소가 비밀번호까지 그대로 들어갈 수 있어서 이유를 싣지 않는다.
		return nil, "", nil, errors.New("DATABASE_URL 형식이 잘못됐습니다(값은 출력하지 않습니다)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, "", nil, fmt.Errorf("PostgreSQL 연결 풀을 만들지 못했습니다: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, "", nil, fmt.Errorf("PostgreSQL에 연결하지 못했습니다: %w", err)
	}
	cfg := pool.Config().ConnConfig
	return repository.NewPostgres(pool), fmt.Sprintf("PostgreSQL %s:%d/%s", cfg.Host, cfg.Port, cfg.Database), pool.Close, nil
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

// loadPracticeAnswers는 정답 값이 있으면 그것을, 없으면 파일을 읽는다. 둘 다 없으면 채점을 끈다(nil).
func loadPracticeAnswers(value, file string) (*httpapi.PracticeAnswers, error) {
	switch {
	case value != "":
		return httpapi.ParsePracticeAnswers([]byte(value))
	case file != "":
		return httpapi.LoadPracticeAnswers(file)
	}
	return nil, nil
}

// list는 쉼표로 나눈 값을 앞뒤 공백을 지우고 빈 칸 없이 돌려준다.
func list(value string) []string {
	var items []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}
