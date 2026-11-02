package indexer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// TestLoadProjectTokens validates the checked-in Base Sepolia allowlist.
func TestLoadProjectTokens(t *testing.T) {
	tokens, err := LoadTokens("tokens.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 4 {
		t.Fatalf("len(tokens) = %d", len(tokens))
	}
	for _, token := range tokens {
		if token.ChainID != domain.ChainID || token.TokenAddress != strings.ToLower(token.TokenAddress) {
			t.Fatalf("invalid token = %+v", token)
		}
	}
}

// TestSelectTokenRequiresExplicitAllowlistedAddress covers normalized selection and rejection.
func TestSelectTokenRequiresExplicitAllowlistedAddress(t *testing.T) {
	tokens, err := LoadTokens("tokens.json")
	if err != nil {
		t.Fatal(err)
	}
	uppercase := strings.ToUpper(tokens[0].TokenAddress)
	selected, err := SelectToken(tokens, uppercase)
	if err != nil {
		t.Fatal(err)
	}
	if selected != tokens[0] {
		t.Fatalf("selected = %+v", selected)
	}
	if _, err := SelectToken(tokens, "0x1111111111111111111111111111111111111111"); err == nil {
		t.Fatal("non-allowlisted token was accepted")
	}
}

// TestLoadTokensRejectsInvalidEntries freezes allowlist validation boundaries.
func TestLoadTokensRejectsInvalidEntries(t *testing.T) {
	valid := `{"chainId":84532,"tokenAddress":"0x1111111111111111111111111111111111111111","symbol":"TKN","decimals":18}`
	tests := map[string]string{
		"wrong chain":       `[{"chainId":1,"tokenAddress":"0x1111111111111111111111111111111111111111","symbol":"TKN","decimals":18}]`,
		"uppercase address": `[{"chainId":84532,"tokenAddress":"0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","symbol":"TKN","decimals":18}]`,
		"zero address":      `[{"chainId":84532,"tokenAddress":"0x0000000000000000000000000000000000000000","symbol":"TKN","decimals":18}]`,
		"blank symbol":      `[{"chainId":84532,"tokenAddress":"0x1111111111111111111111111111111111111111","symbol":" ","decimals":18}]`,
		"negative decimals": `[{"chainId":84532,"tokenAddress":"0x1111111111111111111111111111111111111111","symbol":"TKN","decimals":-1}]`,
		"large decimals":    `[{"chainId":84532,"tokenAddress":"0x1111111111111111111111111111111111111111","symbol":"TKN","decimals":256}]`,
		"duplicate":         `[` + valid + `,` + valid + `]`,
		"unknown field":     `[{"chainId":84532,"tokenAddress":"0x1111111111111111111111111111111111111111","symbol":"TKN","decimals":18,"extra":true}]`,
	}
	for name, contents := range tests {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "tokens.json")
			if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := LoadTokens(path); err == nil {
				t.Fatal("invalid allowlist was accepted")
			}
		})
	}
}
