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

// Two-line table display; dateTime and exports retain the original ISO timestamp.
export function formatTransferTime(timestamp: string, timeZone?: string): { date: string; time: string } {
  const value = new Date(timestamp)
  return {
    date: new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(value),
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short', timeZone }).format(value),
  }
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


// Compact display only: retain the API timestamps on <time dateTime> and in exports.
export function formatPatternWindow(start: string, end: string, timeZone?: string): { start: string; end: string } {
  const date = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
  const clock = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone })
  const from = new Date(start), to = new Date(end)
  const day = (value: Date) => {
    const parts = date.formatToParts(value)
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('.')
  }
  const time = (value: Date) => {
    const parts = clock.formatToParts(value)
    return ['hour', 'minute', 'second'].map(type => parts.find(part => part.type === type)!.value.padStart(2, '0')).join(':')
  }
  const firstDay = day(from), lastDay = day(to)
  // Exact dates, timezone and [start, end) boundaries remain in technical details.
  return { start: firstDay.slice(5) + ' ' + time(from), end: (firstDay === lastDay ? '' : lastDay.slice(5) + ' ') + time(to) }
}
