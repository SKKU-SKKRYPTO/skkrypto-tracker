import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchGraphSize } from './graphResize'
afterEach(() => vi.unstubAllGlobals())
describe('graph resize lifecycle', () => {
  function setup() {
    let width = 640, height = 400, observed!: () => void
    const container = { get clientWidth() { return width }, get clientHeight() { return height } } as HTMLElement
    const disconnect = vi.fn(), observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observed = callback } observe = observe; disconnect = disconnect })
    const frames = new Map<number, FrameRequestCallback>(); let id = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((key: number) => { frames.delete(key) }))
    const refresh = vi.fn(), cleanup = watchGraphSize(container, refresh)
    return { observe, disconnect, refresh, cleanup, frames, resize(w: number, h: number) { width = w; height = h; observed() }, flush() { for (const fn of frames.values()) fn(0); frames.clear() } }
  }
  it('refreshes after actual width/height changes and coalesces rapid resize events', () => {
    const f = setup(); expect(f.observe).toHaveBeenCalledTimes(1)
    f.resize(640, 400); expect(f.frames.size).toBe(0)
    f.resize(900, 500); f.resize(1000, 560); expect(f.frames.size).toBe(1)
    f.flush(); expect(f.refresh).toHaveBeenCalledTimes(1)
    f.resize(1000, 560); expect(f.frames.size).toBe(0)
    f.resize(1000, 0); expect(f.frames.size).toBe(0)
    f.cleanup(); expect(f.disconnect).toHaveBeenCalledTimes(1)
  })
  it('cancels scheduled work on unmount', () => {
    const f = setup(); f.resize(800, 400); f.cleanup(); f.flush()
    expect(f.refresh).not.toHaveBeenCalled(); expect(f.frames.size).toBe(0)
  })
  it('uses and cleans up the window resize fallback when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const addEventListener = vi.fn(), removeEventListener = vi.fn()
    vi.stubGlobal('window', { addEventListener, removeEventListener })
    const cleanup = watchGraphSize({ clientWidth: 640, clientHeight: 400 } as HTMLElement, vi.fn())
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    cleanup(); expect(removeEventListener).toHaveBeenCalledWith('resize', addEventListener.mock.calls[0][1])
  })
})
