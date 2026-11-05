import { describe, expect, it } from 'vitest'
import { revealResultCard } from './resultCardScroll'

describe('result card visibility without page scrolling', () => {
  it.each([[80, 280, 68], [420, 620, 232], [120, 320, 100], [80, 700, 100]])('reveals card bounds %s–%s only inside its list', (top, bottom, expected) => {
    const list = { scrollTop: 100, clientHeight: 400, querySelector: () => null, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) }
    const card = { closest: () => list, getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) }
    const button = { closest: () => card } as unknown as HTMLElement
    revealResultCard(button)
    expect(list.scrollTop).toBe(expected)
  })
  it('safely ignores buttons outside a result card', () => {
    expect(() => revealResultCard({ closest: () => null } as unknown as HTMLElement)).not.toThrow()
  })
})
