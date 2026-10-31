import { describe, expect, it } from 'vitest'
import { matchesV1 } from './validateV1'
import success from '../../mocks/v1/samples/trace-success.json'

const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
const overflow = '115792089237316195423570985008687907853269984665640564039457584007913129639936'
describe('calendar dates', () => {
  it.each([
    '2026-02-30T12:00:04Z', '2025-02-29T12:00:04Z', '1900-02-29T00:00:00Z',
    '2100-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+01:60',
    'not a timestamp',
  ])('rejects %s without date rollover', value => {
    expect(matchesV1(value, 'DateTime')).toBe(false)
  })
  it.each([
    '2026-10-26T12:00:04Z', '2024-02-29T23:59:59Z', '2000-02-29T00:00:00Z',
    '2026-04-30T00:00:00Z', '2026-10-26T12:00:04.123456789Z', '2026-10-26T21:00:04+09:00',
  ])('allows valid RFC3339 %s', value => {
    expect(matchesV1(value, 'DateTime')).toBe(true)
  })
})
describe('uint256 decimal strings', () => {
  it.each(['0', '1', '120000', '9007199254740993', max])('preserves valid value %s', value => {
    expect(matchesV1(value, 'Amount')).toBe(true)
  })
  it.each([overflow, '1' + '0'.repeat(78), '-1', '1.5', '1e18', '01', '', 120000, null])('rejects invalid or overflowing amount %s', value => {
    expect(matchesV1(value, 'Amount')).toBe(false)
  })
  it('also enforces Amount references in transfers and filters, without limiting block numbers', () => {
    expect(matchesV1({ ...success.data.transfers[0], amountRaw: overflow }, 'Transfer')).toBe(false)
    expect(matchesV1({ minAmountRaw: overflow }, 'Filter')).toBe(false)
    expect(matchesV1({ minAmountRaw: max }, 'Filter')).toBe(true)
    expect(matchesV1(overflow, 'BlockNumber')).toBe(true)
  })
})
