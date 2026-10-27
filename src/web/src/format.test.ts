import { describe, expect, it } from 'vitest'
import { formatUnits, shortenHex } from './format'

describe('formatUnits', () => {
  it('정수 금액은 소수점 없이 표시한다', () => {
    expect(formatUnits('5000000000000000000', 18)).toBe('5')
  })

  it('소수 금액은 소수점 아래까지 표시한다', () => {
    expect(formatUnits('1500000000000000000', 18)).toBe('1.5')
  })

  it('가장 작은 값(1)은 소수점 아래 18번째 자리에 1로 표시한다', () => {
    expect(formatUnits('1', 18)).toBe('0.000000000000000001')
  })

  it('Number로는 정밀도를 잃는 아주 큰 값도 자릿수를 그대로 유지한다', () => {
    expect(formatUnits('123456789012345678901234567890', 18)).toBe(
      '123456789012.34567890123456789',
    )
  })

  it('0은 "0"으로 표시한다', () => {
    expect(formatUnits('0', 18)).toBe('0')
  })

  it('소수 부분 끝자리 0은 지우고, 정수 부분의 0은 남긴다', () => {
    expect(formatUnits('1230000000000000000', 18)).toBe('1.23')
    expect(formatUnits('1000000000000000000', 18)).toBe('1')
    expect(formatUnits('10000000000000000000', 18)).toBe('10')
  })
})

describe('shortenHex', () => {
  it('주소는 앞 6글자와 뒤 4글자만 남긴다', () => {
    expect(shortenHex('0x000000000000000000000000000000000000a001')).toBe('0x0000…a001')
  })

  it('거래 해시도 같은 방식으로 줄인다', () => {
    expect(
      shortenHex('0xabcd000000000000000000000000000000000000000000000000000000001234'),
    ).toBe('0xabcd…1234')
  })

  it('10글자 이하인 값은 그대로 둔다', () => {
    expect(shortenHex('0x1234')).toBe('0x1234')
    expect(shortenHex('0x12345678')).toBe('0x12345678')
  })
})
