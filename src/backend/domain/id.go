package domain

import (
	"fmt"
	"strconv"
	"strings"
)

// SnapshotTransferID는 체인에서 수집한 전송의 ID다: {chainId}:{txHash}:{logIndex}
// 같은 거래 안에 Transfer 로그가 여러 개 있어도 logIndex가 달라서 겹치지 않는다.
func SnapshotTransferID(chainID uint64, txHash string, logIndex uint32) string {
	return fmt.Sprintf("%d:%s:%d", chainID, strings.ToLower(txHash), logIndex)
}

// FixtureTransferID는 합성 데이터의 전송 ID다: fx:{namespace}:{recordId}
// fx: 접두어가 있어서 실제 체인 데이터와 섞여도 바로 구분된다.
func FixtureTransferID(namespace, recordID string) string {
	return "fx:" + namespace + ":" + recordID
}

// ValidTransferID는 ID가 데이터셋 출처(sourceMode)에 맞는 형식인지 확인한다.
func ValidTransferID(sourceMode, namespace, id string) bool {
	switch sourceMode {
	case SourceFixture:
		record, ok := strings.CutPrefix(id, "fx:"+namespace+":")
		return ok && record != "" && !strings.Contains(record, ":")
	case SourceSnapshot:
		parts := strings.Split(id, ":")
		if len(parts) != 3 || !ValidHash(parts[1]) || parts[1] != strings.ToLower(parts[1]) {
			return false
		}
		chain, err := strconv.ParseUint(parts[0], 10, 64)
		if err != nil || strconv.FormatUint(chain, 10) != parts[0] {
			return false
		}
		log, err := strconv.ParseUint(parts[2], 10, 32)
		return err == nil && strconv.FormatUint(log, 10) == parts[2]
	}
	return false
}
