import { describe, expect, it } from 'vitest'
import { formatConditions } from './searchConditions'

describe('formatConditions', () => {
  it('방향과 깊이를 "방향 · N단계"로 보여 준다', () => {
    expect(formatConditions({ direction: 'outgoing', maxDepth: 2 })).toBe('보낸 쪽 · 2단계')
    expect(formatConditions({ direction: 'incoming', maxDepth: 3 })).toBe('받은 쪽 · 3단계')
  })
})
