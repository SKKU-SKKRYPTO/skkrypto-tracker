package httpapi

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// rateLimiter는 클라이언트 IP마다 1분에 perMinute번까지 받는다(고정 창 방식).
// 서버 한 대 안에서만 센다. 서버를 여러 대 띄우면 공용 저장소(예: Redis)로 옮겨야 한다.
type rateLimiter struct {
	mu        sync.Mutex
	perMinute int
	now       func() time.Time
	clients   map[string]*rateWindow
}

type rateWindow struct {
	start time.Time
	count int
}

func newRateLimiter(perMinute int, now func() time.Time) *rateLimiter {
	return &rateLimiter{perMinute: perMinute, now: now, clients: map[string]*rateWindow{}}
}

// allow는 요청을 받아도 되는지와, 안 되면 몇 초 뒤에 다시 오면 되는지를 돌려준다.
func (l *rateLimiter) allow(client string) (bool, int) {
	if l.perMinute <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.clients) > 10000 { // 오래된 기록을 치워 메모리가 계속 늘지 않게 한다
		for k, c := range l.clients {
			if now.Sub(c.start) >= time.Minute {
				delete(l.clients, k)
			}
		}
	}
	c := l.clients[client]
	if c == nil || now.Sub(c.start) >= time.Minute {
		c = &rateWindow{start: now}
		l.clients[client] = c
	}
	if c.count >= l.perMinute {
		return false, int(math.Ceil((time.Minute - now.Sub(c.start)).Seconds()))
	}
	c.count++
	return true, 0
}

// rateLimit은 /api 아래 요청에 붙는다. 넘치면 429와 Retry-After(초)를 돌려준다.
func (s *server) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			client = r.RemoteAddr
		}
		if ok, wait := s.limiter.allow(client); !ok {
			w.Header().Set("Retry-After", strconv.Itoa(wait))
			writeError(w, &failure{status: http.StatusTooManyRequests, code: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.", retryable: true})
			return
		}
		next.ServeHTTP(w, r)
	})
}
