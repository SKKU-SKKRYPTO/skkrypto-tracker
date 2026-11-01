import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CopyButton from './CopyButton'

// Exercise the real click handler without a DOM dependency. Timer/layout behavior is not simulated.
const hooks = vi.hoisted(() => ({ status: 'idle' }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [hooks.status, (value: string) => { hooks.status = value }],
  useEffect: () => {},
}))
beforeEach(() => { hooks.status = 'idle' })
afterEach(() => vi.unstubAllGlobals())

describe('evidence clipboard actions', () => {
  it.each([
    ['블록 해시', `0x${'ab'.repeat(32)}`],
    ['토큰 주소', `0x${'cd'.repeat(20)}`],
    ['거래 번호', `0x${'ef'.repeat(32)}`],
  ])('copies the complete %s value', async (label, value) => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const button = CopyButton({ label, value })
    expect(button.props['aria-label']).toBe(`${label} 복사`)
    await button.props.onClick()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(value)
    expect(hooks.status).toBe('copied')
  })
  it('handles clipboard permission failures without throwing', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    await expect(CopyButton({ label: '블록 해시', value: 'full-value' }).props.onClick()).resolves.toBeUndefined()
    expect(hooks.status).toBe('failed')
  })
})
