package domain

import (
	"errors"
	"math/big"
	"regexp"
	"strings"
)

// ZeroAddress는 발행(from)·소각(to)에 쓰이는 0 주소다.
const ZeroAddress = "0x0000000000000000000000000000000000000000"

var (
	decimalPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
	addressPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	hashPattern    = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
)

var maxUint256 = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))

var (
	errAmountFormat = errors.New("amountRaw must be an unsigned decimal string")
	errAmountRange  = errors.New("amountRaw exceeds uint256")
)

// ParseAmount는 uint256 십진 문자열을 큰 정수로 바꾼다.
// 소수점·부호·앞자리 0·지수 표기는 받지 않는다. 금액은 float로 바꾸지 않는다.
func ParseAmount(s string) (*big.Int, error) {
	if !decimalPattern.MatchString(s) {
		return nil, errAmountFormat
	}
	n, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return nil, errAmountFormat
	}
	if n.Cmp(maxUint256) > 0 {
		return nil, errAmountRange
	}
	return n, nil
}

// ValidAddress는 0x + 16진수 40자리인지 본다(대소문자 모두 허용).
func ValidAddress(s string) bool { return addressPattern.MatchString(s) }

// ValidHash는 0x + 16진수 64자리인지 본다.
func ValidHash(s string) bool { return hashPattern.MatchString(s) }

// NormalizeAddress는 주소를 소문자로 바꾼다. 비교·저장은 항상 소문자로 한다.
func NormalizeAddress(s string) string { return strings.ToLower(s) }

// TransferTypeOf는 from/to로 전송 유형을 정한다.
func TransferTypeOf(from, to string) string {
	switch {
	case strings.EqualFold(from, ZeroAddress):
		return TransferTypeMint
	case strings.EqualFold(to, ZeroAddress):
		return TransferTypeBurn
	}
	return TransferTypeTransfer
}
