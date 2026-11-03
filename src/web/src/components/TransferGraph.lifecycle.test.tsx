import { afterEach, describe, expect, it, vi } from 'vitest'
import TransferGraph from './TransferGraph'
import cytoscape from 'cytoscape'
import type { CytoscapeOptions } from 'cytoscape'
import { watchGraphSize } from './graphResize'
import patterns from '../../mocks/v1/samples/patterns-success.json'
import type { TransferGraphData } from './graphElements'
const hooks = vi.hoisted(() => ({ refIndex: 0, cleanups: [] as (() => void)[], container: { style: { cursor: '' } } }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useRef: (value: unknown) => ({ current: hooks.refIndex++ === 0 ? hooks.container : value }),
  useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) hooks.cleanups.push(cleanup) },
}))
vi.mock('cytoscape', () => ({ default: vi.fn() }))
vi.mock('./graphResize', () => ({ watchGraphSize: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('graph mount, resize and selection callback', () => {
  it('resizes and reruns layout without replacing evidence, then disconnects before destroy', () => {
    hooks.refIndex = 0; hooks.cleanups = []
    const run = vi.fn(), resize = vi.fn(), destroy = vi.fn(), disconnect = vi.fn()
    const layout = vi.fn().mockReturnValue({ run }), on = vi.fn()
    const cy = { resize, destroy, layout, on, edges: () => ({ removeClass: vi.fn() }) }
    vi.mocked(cytoscape).mockReturnValue(cy as never)
    vi.mocked(watchGraphSize).mockReturnValue(disconnect)
    const removeEventListener = vi.fn()
    vi.stubGlobal('window', { matchMedia: () => ({ addEventListener: vi.fn(), removeEventListener }) })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#111111' }))
    const data = { nodes: patterns.data.nodes, transfers: patterns.data.transfers, conditions: patterns.meta.conditions, startLabel: '기준' } as TransferGraphData
    const onSelect = vi.fn()
    TransferGraph({ result: data, selectedTransferId: null, onSelect })
    const options = vi.mocked(cytoscape).mock.calls.at(-1)![0] as unknown as CytoscapeOptions
    expect(options.layout).toMatchObject({ name: 'concentric', avoidOverlap: true })
    expect(options.elements).toHaveLength(10)
    const refresh = vi.mocked(watchGraphSize).mock.calls.at(-1)![1]
    refresh(); expect(resize).toHaveBeenCalledTimes(1); expect(layout).toHaveBeenCalledWith(options.layout); expect(run).toHaveBeenCalledTimes(1)
    const tap = on.mock.calls.find(call => call[0] === 'tap')![2]
    tap({ target: { id: () => patterns.data.transfers[0].id } })
    expect(onSelect).toHaveBeenCalledWith(patterns.data.transfers[0].id)
    hooks.cleanups.forEach(fn => fn())
    expect(disconnect).toHaveBeenCalledTimes(1); expect(destroy).toHaveBeenCalledTimes(1)
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0])
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })
})
