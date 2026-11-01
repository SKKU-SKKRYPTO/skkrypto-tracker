// Package httpapi는 담당 3의 HTTP API다.
//
// 저장소(repository.Repository)에서 데이터를 읽고, 분석은 엔진(analyzer.Engine)에 맡긴다.
// 응답은 항상 { data, meta, error } 모양이고, 규격은 contracts/openapi.json이 기준이다.
package httpapi

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/analyzer"
	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/api-server/repository"
)

// Config는 서버를 만들 때 넘기는 재료다.
type Config struct {
	Repo               repository.Repository
	Engine             analyzer.Engine
	RateLimitPerMinute int           // 클라이언트 IP마다 1분에 받는 요청 수. 0이면 제한하지 않는다
	RequestTimeout     time.Duration // 0이면 3초. 분석 시간 예산(최대 2초)보다 조금 길게 둔다
	AllowedOrigins     []string      // 브라우저에서 이 API를 부를 수 있는 웹 주소(CORS)
}

type server struct {
	repo    repository.Repository
	engine  analyzer.Engine
	limiter *rateLimiter
	timeout time.Duration
	origins []string
}

// New는 API 라우터를 만든다. 서버 실행(포트·종료)은 호출한 쪽(cmd/api-server)이 맡는다.
func New(cfg Config) http.Handler {
	s := &server{
		repo:    cfg.Repo,
		engine:  cfg.Engine,
		limiter: newRateLimiter(cfg.RateLimitPerMinute, time.Now),
		timeout: cfg.RequestTimeout,
		origins: cfg.AllowedOrigins,
	}
	if s.timeout == 0 {
		s.timeout = 3 * time.Second
	}

	r := chi.NewRouter()
	r.Use(s.common)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok\n")) })
	r.Route("/api", func(r chi.Router) {
		r.Use(s.rateLimit)
		r.Get("/datasets", handle(s.listDatasets))
		r.Get("/datasets/{id}", handle(s.getDataset))
		r.Get("/transfers", handle(s.listTransfers))
		r.Get("/transactions/{txHash}", handle(s.getTransaction))
		r.Post("/trace", handle(s.analyze(analyzer.KindTrace)))
		r.Post("/paths", handle(s.analyze(analyzer.KindPaths)))
		r.Post("/patterns", handle(s.analyze(analyzer.KindPatterns)))
	})
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, fail(http.StatusNotFound, "NOT_FOUND", "API 경로가 없습니다."))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, fail(http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "허용되지 않은 HTTP 메서드입니다."))
	})
	return r
}

// handlerFunc는 오류를 돌려주는 핸들러다. 오류는 handle이 한곳에서 HTTP 응답으로 바꾼다.
type handlerFunc func(w http.ResponseWriter, r *http.Request) error

func handle(fn handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			writeError(w, err)
		}
	}
}

// common은 모든 요청에 붙는 공통 처리다: 보안 헤더, CORS, 요청 시간 제한.
func (s *server) common(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "no-store")
		if origin := r.Header.Get("Origin"); origin != "" && slices.Contains(s.origins, origin) {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			// 다른 주소의 웹에서도 429의 Retry-After(초)를 읽을 수 있게 한다.
			h.Set("Access-Control-Expose-Headers", "Retry-After")
			if r.Method == http.MethodOptions {
				h.Set("Access-Control-Allow-Methods", "GET, POST")
				h.Set("Access-Control-Allow-Headers", "Content-Type")
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), s.timeout)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
