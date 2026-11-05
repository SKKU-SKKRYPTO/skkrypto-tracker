import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Core } from 'cytoscape'
import { watchGraphViewport } from './graphViewport'
import { watchGraphSize } from './graphResize'

vi.mock('./graphResize', () => ({ watchGraphSize: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setup(width = 800, height = 420) {
  const frames = new Map<number, FrameRequestCallback>(); let id = 0
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  const listeners = new Map<string, Set<() => void>>()
  const emit = (event: string) => listeners.get(event)?.forEach(fn => fn())
  const cy = {
    on: vi.fn((events: string, fn: () => void) => events.split(' ').forEach(event => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    })),
    off: vi.fn((events: string, fn: () => void) => events.split(' ').forEach(event => listeners.get(event)?.delete(fn))),
    ready: vi.fn((fn: () => void) => fn()),
    fit: vi.fn(() => { emit('pan'); emit('zoom') }),
    resize: vi.fn(() => emit('pan')), layout: vi.fn(), zoom: vi.fn(), center: vi.fn(),
  }
  const container = { clientWidth: width, clientHeight: height } as HTMLElement
  const disconnect = vi.fn()
  vi.mocked(watchGraphSize).mockReturnValue(disconnect)
  const cleanup = watchGraphViewport(cy as unknown as Core, container)
  return {
    cy, container, emit, frames, cleanup, disconnect,
    resize() { vi.mocked(watchGraphSize).mock.calls.at(-1)![1]() },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)) },
  }
}

describe('initial graph fit and viewport preservation', () => {
  it('fits all elements after ready and layout stop in the next frame without enforcing a minimum zoom', () => {
    const f = setup()
    expect(f.cy.fit).not.toHaveBeenCalled()
    f.emit('layoutstop'); f.emit('layoutstop')
    expect(f.frames.size).toBe(1)
    f.flush()
    expect(f.cy.resize).toHaveBeenCalledOnce()
    expect(f.cy.fit).toHaveBeenCalledExactlyOnceWith(undefined, 32)
    expect(f.cy.zoom).not.toHaveBeenCalled(); expect(f.cy.center).not.toHaveBeenCalled()
    f.cleanup()
  })
  it('waits for a nonzero container and fits again when actual dimensions change before user interaction', () => {
    const f = setup(0, 0); f.flush()
    expect(f.cy.fit).not.toHaveBeenCalled()
    Object.assign(f.container, { clientWidth: 760, clientHeight: 380 })
    f.resize(); f.flush(); expect(f.cy.fit).toHaveBeenCalledTimes(1)
    f.resize(); f.flush(); expect(f.cy.fit).toHaveBeenCalledTimes(2)
    expect(f.cy.layout).not.toHaveBeenCalled()
    f.cleanup()
  })
  it.each(['pan', 'zoom'])('preserves manual %s through resize and layout notifications', event => {
    const f = setup(); f.flush()
    f.emit(event)
    f.resize(); f.emit('layoutstop'); f.flush()
    expect(f.cy.fit).toHaveBeenCalledTimes(1)
    expect(f.cy.layout).not.toHaveBeenCalled()
    expect(f.cy.resize).toHaveBeenCalledTimes(2)
    f.cleanup()
  })
  it('does not override user navigation that happens before a pending fit', () => {
    const f = setup(); f.emit('zoom'); f.flush()
    expect(f.cy.fit).not.toHaveBeenCalled()
    f.cleanup()
  })
  it('ignores selection/style events, leaving the current layout and viewport alone', () => {
    const f = setup(); f.flush()
    f.emit('select'); f.emit('style'); f.flush()
    expect(f.cy.fit).toHaveBeenCalledTimes(1)
    expect(f.cy.layout).not.toHaveBeenCalled()
    f.cleanup()
  })
  it('cancels pending work and removes listeners when the result is replaced or unmounted', () => {
    const f = setup(); f.cleanup(); f.emit('layoutstop'); f.flush()
    expect(f.cy.fit).not.toHaveBeenCalled()
    expect(f.frames.size).toBe(0)
    expect(f.disconnect).toHaveBeenCalledOnce()
    expect(f.cy.off).toHaveBeenCalledTimes(2)
  })
})
