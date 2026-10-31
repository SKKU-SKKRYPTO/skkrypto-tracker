package httpapi

import (
	"strconv"
	"testing"
	"time"
)

// 기록이 1만 개를 넘어도 오래된 기록 정리는 1초에 한 번만 돈다. 요청마다 전부 훑으면 모든 요청이 잠금 뒤에 줄을 선다.
func TestRateLimiterSweepsAtMostOncePerSecond(t *testing.T) {
	now := fixedNow
	l := newRateLimiter(10, func() time.Time { return now })
	for i := 0; i <= 10000; i++ {
		l.allow("10.0.0." + strconv.Itoa(i))
	}
	l.allow("first") // 1만 개를 넘은 뒤 첫 정리. 다 1분 안쪽이라 지울 것이 없다.
	l.clients["old"] = &rateWindow{start: now.Add(-2 * time.Minute)}

	l.allow("second")
	if l.clients["old"] == nil {
		t.Fatal("정리한 지 1초가 안 됐으면 다시 훑지 않아야 한다")
	}
	now = now.Add(time.Second)
	l.allow("third")
	if l.clients["old"] != nil {
		t.Fatal("1초가 지나면 다시 정리해 오래된 기록을 지워야 한다")
	}
}
