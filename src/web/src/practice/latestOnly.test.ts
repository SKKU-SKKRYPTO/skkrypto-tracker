import { describe, expect, it } from 'vitest'
import { createLatestOnly } from './latestOnly'

describe('latest request only', () => {
  it('keeps the result of the latest request', () => {
    const latest = createLatestOnly()
    const first = latest.start()
    expect(latest.isCurrent(first)).toBe(true)
    const second = latest.start()
    expect(latest.isCurrent(first)).toBe(false)
    expect(latest.isCurrent(second)).toBe(true)
  })
  it('drops a pending result once the answer changes', () => {
    const latest = createLatestOnly()
    const ticket = latest.start()
    latest.invalidate()
    expect(latest.isCurrent(ticket)).toBe(false)
  })
})
