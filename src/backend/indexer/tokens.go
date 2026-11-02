package indexer

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/SKKU-SKKRYPTO/skkrypto-tracker/src/backend/domain"
)

// LoadTokens reads and validates the complete Base Sepolia token allowlist.
func LoadTokens(path string) ([]domain.Asset, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read token allowlist: %w", err)
	}
	var tokens []domain.Asset
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&tokens); err != nil {
		return nil, fmt.Errorf("decode token allowlist: %w", err)
	}
	if len(tokens) == 0 {
		return nil, errors.New("token allowlist is empty")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("token allowlist contains invalid trailing JSON")
	}
	seen := make(map[string]struct{}, len(tokens))
	for i := range tokens {
		if err := validateToken(tokens[i]); err != nil {
			return nil, fmt.Errorf("token allowlist entry %d: %w", i, err)
		}
		address := domain.NormalizeAddress(tokens[i].TokenAddress)
		if _, exists := seen[address]; exists {
			return nil, fmt.Errorf("token allowlist entry %d duplicates address %s", i, address)
		}
		seen[address] = struct{}{}
	}
	return tokens, nil
}

// SelectToken returns exactly the requested allowlisted token after case-insensitive address matching.
func SelectToken(tokens []domain.Asset, tokenAddress string) (domain.Asset, error) {
	normalized := domain.NormalizeAddress(tokenAddress)
	if !domain.ValidAddress(normalized) || normalized == domain.ZeroAddress {
		return domain.Asset{}, errors.New("invalid token address")
	}
	for _, token := range tokens {
		if token.TokenAddress == normalized {
			return token, nil
		}
	}
	return domain.Asset{}, fmt.Errorf("token %s is not allowlisted", normalized)
}

// LoadToken validates the allowlist and selects the one explicitly requested token.
func LoadToken(path, tokenAddress string) (domain.Asset, error) {
	tokens, err := LoadTokens(path)
	if err != nil {
		return domain.Asset{}, err
	}
	return SelectToken(tokens, tokenAddress)
}

// validateToken enforces the stored allowlist's canonical Base Sepolia representation.
func validateToken(token domain.Asset) error {
	switch {
	case token.ChainID != domain.ChainID:
		return fmt.Errorf("chainId must be %d", domain.ChainID)
	case !domain.ValidAddress(token.TokenAddress):
		return errors.New("invalid tokenAddress")
	case token.TokenAddress != domain.NormalizeAddress(token.TokenAddress):
		return errors.New("tokenAddress must use canonical lowercase form")
	case token.TokenAddress == domain.ZeroAddress:
		return errors.New("tokenAddress must not be the zero address")
	case strings.TrimSpace(token.Symbol) == "":
		return errors.New("symbol is required")
	case token.Symbol != strings.TrimSpace(token.Symbol):
		return errors.New("symbol must not have surrounding whitespace")
	case token.Decimals < 0 || token.Decimals > 255:
		return errors.New("decimals must be between 0 and 255")
	}
	return nil
}
