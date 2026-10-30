package domain

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
)

func TestBlockNumberIsDecimalStringInJSON(t *testing.T) {
	b, err := json.Marshal(struct {
		N BlockNumber `json:"n"`
	}{18204511})
	if err != nil || string(b) != `{"n":"18204511"}` {
		t.Fatalf("marshal = %s, %v", b, err)
	}

	var v struct {
		N BlockNumber `json:"n"`
	}
	if err := json.Unmarshal([]byte(`{"n":"18204511"}`), &v); err != nil || v.N != 18204511 {
		t.Fatalf("unmarshal = %d, %v", v.N, err)
	}
	for _, bad := range []string{`{"n":18204511}`, `{"n":"0123"}`, `{"n":"-1"}`, `{"n":"1e3"}`, `{"n":""}`} {
		if err := json.Unmarshal([]byte(bad), &v); err == nil {
			t.Errorf("%s 를 받아들이면 안 된다", bad)
		}
	}
}

func TestParseAmountAcceptsOnlyUint256(t *testing.T) {
	max := "115792089237316195423570985008687907853269984665640564039457584007913129639935"
	for _, ok := range []string{"0", "1", "120000", max} {
		if n, err := ParseAmount(ok); err != nil || n.String() != ok {
			t.Errorf("%s: %v", ok, err)
		}
	}
	overflow := "115792089237316195423570985008687907853269984665640564039457584007913129639936"
	for _, bad := range []string{"", "01", "-1", "1.5", "1e18", " 1", overflow} {
		if _, err := ParseAmount(bad); err == nil {
			t.Errorf("%q 를 받아들이면 안 된다", bad)
		}
	}
}

func TestComparePositionUsesBlockThenTxThenLog(t *testing.T) {
	p := func(b BlockNumber, tx, log uint32) Position {
		return Position{BlockNumber: b, TransactionIndex: tx, LogIndex: log}
	}
	cases := []struct {
		a, b Position
		want int
	}{
		{p(10, 9, 9), p(11, 0, 0), -1},
		{p(10, 1, 9), p(10, 2, 0), -1},
		{p(10, 1, 1), p(10, 1, 0), 1},
		{p(10, 1, 1), p(10, 1, 1), 0},
	}
	for _, c := range cases {
		if got := ComparePosition(c.a, c.b); got != c.want {
			t.Errorf("ComparePosition(%v, %v) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestLessBreaksTiesByID(t *testing.T) {
	rows := []Transfer{
		{ID: "b", BlockNumber: 5},
		{ID: "z", BlockNumber: 4},
		{ID: "a", BlockNumber: 5},
	}
	sort.Slice(rows, func(i, j int) bool { return Less(rows[i], rows[j]) })
	got := rows[0].ID + rows[1].ID + rows[2].ID
	if got != "zab" {
		t.Fatalf("order = %s", got)
	}
}

func TestAddressAndHash(t *testing.T) {
	if !ValidAddress("0x0000000000000000000000000000000000000001") || !ValidAddress("0xABCDEFabcdef0000000000000000000000000001") {
		t.Fatal("정상 주소를 거절했다")
	}
	for _, bad := range []string{"0x123", "0000000000000000000000000000000000000001", "0xg000000000000000000000000000000000000001"} {
		if ValidAddress(bad) {
			t.Errorf("%s 를 주소로 받아들이면 안 된다", bad)
		}
	}
	if !ValidHash("0x"+strings.Repeat("a", 64)) || ValidHash("0x"+strings.Repeat("a", 63)) {
		t.Fatal("해시 길이 검사가 틀렸다")
	}
}

func TestTransferType(t *testing.T) {
	one := "0x0000000000000000000000000000000000000001"
	if TransferTypeOf(ZeroAddress, one) != TransferTypeMint || TransferTypeOf(one, ZeroAddress) != TransferTypeBurn || TransferTypeOf(one, one) != TransferTypeTransfer {
		t.Fatal("전송 유형이 틀렸다")
	}
}

func TestTransferIDs(t *testing.T) {
	hash := "0x" + strings.Repeat("Ab", 32)
	id := SnapshotTransferID(ChainID, hash, 3)
	if id != "84532:0x"+strings.Repeat("ab", 32)+":3" {
		t.Fatalf("snapshot id = %s", id)
	}
	if !ValidTransferID(SourceSnapshot, "", id) {
		t.Fatal("정상 snapshot id를 거절했다")
	}
	for _, bad := range []string{"84532:" + hash + ":3", "84532:0x12:3", "084532:0x" + strings.Repeat("ab", 32) + ":3", "fx:demo:e1"} {
		if ValidTransferID(SourceSnapshot, "", bad) {
			t.Errorf("%s 를 snapshot id로 받아들이면 안 된다", bad)
		}
	}

	fx := FixtureTransferID("flow-demo-v1", "e1")
	if fx != "fx:flow-demo-v1:e1" || !ValidTransferID(SourceFixture, "flow-demo-v1", fx) {
		t.Fatalf("fixture id = %s", fx)
	}
	if ValidTransferID(SourceFixture, "other-v1", fx) || ValidTransferID(SourceFixture, "flow-demo-v1", "fx:flow-demo-v1:") {
		t.Fatal("다른 namespace나 빈 recordId를 받아들이면 안 된다")
	}
}
