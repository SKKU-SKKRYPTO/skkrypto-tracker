package analyzer

import (
	"fmt"
	"strings"
	"time"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// 테스트용 주소. 숫자를 0x 뒤 40자리로 채운다(1 → 0x000...001).
func addr(n int) string { return fmt.Sprintf("0x%040x", n) }

var (
	S = addr(1)
	A = addr(2)
	B = addr(3)
	C = addr(4)
	D = addr(5)
	E = addr(6)
	T = addr(7)
)

var testAsset = domain.Asset{ChainID: domain.ChainID, TokenAddress: addr(0x1000), Symbol: "SKK", Decimals: 2}

func at(clock string) time.Time {
	t, err := time.Parse(time.RFC3339, "2026-10-26T"+clock+"Z")
	if err != nil {
		panic(err)
	}
	return t
}

func transfer(id string, block uint64, tx, log uint32, clock, from, to, amount string) domain.Transfer {
	return domain.Transfer{
		ID:               id,
		Asset:            testAsset,
		TransferType:     domain.TransferTypeOf(from, to),
		BlockNumber:      domain.BlockNumber(block),
		TransactionIndex: tx,
		LogIndex:         log,
		Timestamp:        at(clock),
		From:             from,
		To:               to,
		AmountRaw:        amount,
	}
}

// flowDemo는 기획안 예시 그림과 같은 모양의 작은 데이터다.
//
//	S ─e1→ A ─e4→ D ─e6→ T
//	S ─e2→ B ─e5→ D
//	S ─e3→ C ─e7→ E ─e8→ T   (e8이 e7보다 먼저라서 시간순 경로가 아니다)
func flowDemo() Input {
	return Input{
		Transfers: []domain.Transfer{
			transfer("e1", 18204511, 3, 0, "12:00:04", S, A, "120000"),
			transfer("e2", 18204566, 1, 2, "12:01:54", S, B, "250000"),
			transfer("e3", 18204782, 0, 1, "12:09:06", S, C, "90000"),
			transfer("e4", 18205040, 5, 0, "12:17:42", A, D, "115000"),
			transfer("e5", 18205103, 2, 1, "12:19:48", B, D, "248000"),
			transfer("e6", 18205900, 4, 3, "12:46:22", D, T, "360000"),
			transfer("e7", 18206300, 1, 0, "12:59:42", C, E, "88000"),
			transfer("e8", 18205410, 7, 2, "12:30:02", E, T, "87000"),
		},
		Coverage: domain.Coverage{StartBlock: 18204211, EndBlock: 18206309, StartTime: at("11:50:04"), EndTime: at("13:00:00")},
	}
}

func transferIDs(ts []domain.Transfer) string {
	ids := make([]string, len(ts))
	for i, t := range ts {
		ids[i] = t.ID
	}
	return strings.Join(ids, ",")
}

// onlyReason은 잘림 사유가 want 하나뿐인지 본다.
func onlyReason(l LimitStatus, want string) bool {
	return l.Truncated != nil && l.Truncated.Reason == want && len(l.Truncated.Reasons) == 1
}

func pathIDs(r Result) []string {
	out := make([]string, len(r.Paths))
	for i, p := range r.Paths {
		out[i] = strings.Join(p.TransferIDs, ">")
	}
	return out
}
