package domain

import (
	"encoding/json"
	"errors"
	"strconv"
)

// BlockNumber는 블록 번호다. JSON에서는 금액처럼 십진 문자열("18204511")로 주고받는다.
// 자바스크립트 숫자는 2^53을 넘으면 정확하지 않아서, 웹과 주고받는 큰 정수는 모두 문자열로 통일했다.
type BlockNumber uint64

var errBlockNumber = errors.New("block number must be a decimal string")

// ParseBlockNumber는 "0" 또는 0으로 시작하지 않는 십진 문자열만 받는다.
func ParseBlockNumber(s string) (BlockNumber, error) {
	if !decimalPattern.MatchString(s) {
		return 0, errBlockNumber
	}
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, errBlockNumber
	}
	return BlockNumber(n), nil
}

func (b BlockNumber) String() string { return strconv.FormatUint(uint64(b), 10) }

func (b BlockNumber) MarshalJSON() ([]byte, error) { return json.Marshal(b.String()) }

func (b *BlockNumber) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return errBlockNumber
	}
	n, err := ParseBlockNumber(s)
	if err != nil {
		return err
	}
	*b = n
	return nil
}

// Position은 체인 안에서 전송의 순서를 정하는 세 값이다.
// 같은 블록 안에서는 거래 순서(transactionIndex), 같은 거래 안에서는 로그 순서(logIndex)로 나눈다.
type Position struct {
	BlockNumber      BlockNumber `json:"blockNumber"`
	TransactionIndex uint32      `json:"transactionIndex"`
	LogIndex         uint32      `json:"logIndex"`
}

// ComparePosition은 a가 앞이면 -1, 같으면 0, 뒤면 1을 돌려준다.
// 시간순 경로는 이 값으로만 판단한다. 위치가 같은 두 전송은 앞뒤 관계가 없어서 hop으로 잇지 않는다.
func ComparePosition(a, b Position) int {
	switch {
	case a.BlockNumber != b.BlockNumber:
		return compare(a.BlockNumber < b.BlockNumber)
	case a.TransactionIndex != b.TransactionIndex:
		return compare(a.TransactionIndex < b.TransactionIndex)
	case a.LogIndex != b.LogIndex:
		return compare(a.LogIndex < b.LogIndex)
	}
	return 0
}

func compare(less bool) int {
	if less {
		return -1
	}
	return 1
}

// Less는 정렬용이다. 위치가 같으면 ID로 한 번 더 비교해서 결과 순서가 항상 같게 만든다.
func Less(a, b Transfer) bool {
	if c := ComparePosition(a.Position(), b.Position()); c != 0 {
		return c < 0
	}
	return a.ID < b.ID
}
