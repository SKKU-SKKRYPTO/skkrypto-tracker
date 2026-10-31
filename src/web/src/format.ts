// 0x1234567890abcdef → 0x1234…cdef (화면 표시용)
export function shortenHex(value: string): string {
  if (value.length <= 10) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

// 공식 v1 ISO-8601 블록 시각을 사용자 컴퓨터의 시간대로 표시한다.

export function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString('ko-KR', {
    timeZoneName: 'short',
  })
}

// 최소 단위 금액 문자열을 decimals만큼 소수점을 옮긴 문자열로 바꾼다.
// 큰 수의 정밀도를 잃지 않도록 Number를 거치지 않고 문자열로만 계산한다.
// 예: ("1500000000000000000", 18) → "1.5"
export function formatUnits(amount: string, decimals: number): string {
  const digits = amount.padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export function formatAmount(transfer: { amountRaw: string; asset: { decimals: number; symbol: string } }): string {
  return `${formatUnits(transfer.amountRaw, transfer.asset.decimals)} ${transfer.asset.symbol}`
}

