import { afterEach, describe, expect, it, vi } from 'vitest'
import TransferGraph from './TransferGraph'
import cytoscape from 'cytoscape'
import type { CytoscapeOptions } from 'cytoscape'
import { watchGraphSize } from './graphResize'
import patterns from '../../mocks/v1/samples/patterns-success.json'
import type { TransferGraphData } from './graphElements'
import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatAmount } from '../format'
const hooks = vi.hoisted(() => ({ refIndex: 0, cleanups: [] as (() => void)[], container: { style: { cursor: '' } } }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useRef: (value: unknown) => ({ current: hooks.refIndex++ === 0 ? hooks.container : value }),
  useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) hooks.cleanups.push(cleanup) },
}))
vi.mock('cytoscape', () => ({ default: vi.fn() }))
vi.mock('./graphResize', () => ({ watchGraphSize: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('graph mount, resize and selection callback', () => {
  it.each(['trace', 'paths', 'patterns'] as const)('provides working %s zoom and fit without dropping parallel transfers or selection IDs', async mode => {
    hooks.refIndex = 0; hooks.cleanups = []
    let level = 0.3
    const zoom = vi.fn((value?: number | { level: number }) => {
      if (value === undefined) return level
      level = typeof value === 'number' ? value : value.level
    })
    const fit = vi.fn(() => { level = 0.3 }), center = vi.fn(), resize = vi.fn(), on = vi.fn()
    const run = vi.fn(() => { level = 0.3 }), layout = vi.fn(() => ({ run }))
    const cy = { zoom, fit, center, resize, layout, on, width: () => 300, height: () => 400, destroy: vi.fn(), edges: () => ({ removeClass: vi.fn() }), getElementById: () => ({ filter: () => ({ addClass: vi.fn() }) }) }
    vi.mocked(cytoscape).mockReturnValue(cy as never)
    vi.mocked(watchGraphSize).mockReturnValue(vi.fn())
    vi.stubGlobal('window', { matchMedia: () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => name === '--mono' ? 'monospace' : '#111111' }))
    const onSelect = vi.fn()
    const onClearSelection = vi.fn(), kind = mode === 'patterns' ? '패턴' : '경로'
    const tree = TransferGraph({ controls: true, result: { nodes: patterns.data.nodes, transfers: patterns.data.transfers, conditions: patterns.meta.conditions, startLabel: mode === 'patterns' ? '기준' : undefined } as TransferGraphData,
      selectedTransferId: patterns.data.transfers[4].id, onSelect, evidenceKind: mode === 'patterns' ? 'pattern' : 'path',
      ...(mode === 'trace' ? {} : { highlightedTransferIds: new Set(patterns.data.patterns[0].evidenceIds), selectionLabel: `${kind} 1`, onClearSelection }) })
    expect(level).toBe(1)
    expect(renderToStaticMarkup(tree)).toContain(formatAmount(patterns.data.transfers[4]))
    expect(renderToStaticMarkup(tree)).not.toContain(patterns.data.transfers[4].id)
    const buttons: { [key: string]: () => void } = {}
    function visit(node: ReactNode) {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!isValidElement<{ children?: ReactNode; 'aria-label'?: string; onClick: () => void }>(node)) return
      if (node.type === 'button') buttons[node.props['aria-label'] ?? String(node.props.children)] = node.props.onClick
      visit(node.props.children)
    }
    visit(tree)
    buttons['그래프 확대'](); expect(level).toBe(1.25)
    expect(zoom).toHaveBeenLastCalledWith({ level: 1.25, renderedPosition: { x: 150, y: 200 } })
    buttons['그래프 축소'](); expect(level).toBe(1)
    buttons['화면 맞춤'](); expect(fit).toHaveBeenCalledWith(undefined, 32); expect(level).toBe(0.3)
    if (mode !== 'trace') { buttons[`${kind} 선택 해제`](); expect(onClearSelection).toHaveBeenCalledOnce() }
    vi.mocked(watchGraphSize).mock.calls.at(-1)![1](); expect(level).toBe(1)
    const options = vi.mocked(cytoscape).mock.calls.at(-1)![0] as unknown as CytoscapeOptions
    if (mode === 'paths') expect(options.layout).toMatchObject({ name: 'breadthfirst', direction: 'rightward', avoidOverlap: true })
    if (mode === 'trace') expect(options.layout).not.toHaveProperty('direction')
    if (mode === 'patterns') expect(options.layout).toMatchObject({ name: 'concentric', avoidOverlap: true })
    const traceStyle = options.style as { selector: string; style: Record<string, unknown> }[]
    expect(traceStyle.find(rule => rule.selector === 'node')!.style['font-size']).toBe(14)
    expect(traceStyle.find(rule => rule.selector === 'edge')!.style['font-size']).toBe(14)
    const nodeStyle = traceStyle.find(rule => rule.selector === 'node')!.style
    expect(nodeStyle.width).toBeTypeOf('number')
    const height = nodeStyle.height as (node: { data: () => string }) => number
    expect(height({ data: () => '기준 · H\n0x0000…0069' })).toBe(38)
    expect(height({ data: () => '아주 긴 주소 이름표'.repeat(8) })).toBeGreaterThan(38)
    const edges = (options.elements as { group: string; data: { id: string } }[]).filter(e => e.group === 'edges')
    expect(edges.map(e => e.data.id)).toEqual(patterns.data.transfers.map(t => t.id))
    // Parse the exact production stylesheet in the installed library as well as
    // testing controls with the mock. Catch deprecated/invalid style values.
    const { default: createGraph } = await vi.importActual<{ default: typeof cytoscape }>('cytoscape')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const actual = createGraph({ headless: true, styleEnabled: true, elements: options.elements, style: options.style, layout: { name: 'preset' } })
    expect(actual.nodes()[0].width()).toBe(108)
    expect(actual.edges().map(edge => edge.id())).toEqual(patterns.data.transfers.map(t => t.id))
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/deprecated|invalid/i)
    actual.destroy()
    on.mock.calls.find(call => call[0] === 'tap')![2]({ target: { id: () => patterns.data.transfers[4].id } })
    expect(onSelect).toHaveBeenCalledWith(patterns.data.transfers[4].id)
    hooks.cleanups.forEach(fn => fn())
  })
  it('resizes and reruns layout without replacing evidence, then disconnects before destroy', () => {
    hooks.refIndex = 0; hooks.cleanups = []
    const run = vi.fn(), resize = vi.fn(), destroy = vi.fn(), disconnect = vi.fn()
    const layout = vi.fn().mockReturnValue({ run }), on = vi.fn()
    const cy = { resize, destroy, layout, on, edges: () => ({ removeClass: vi.fn() }) }
    vi.mocked(cytoscape).mockReturnValue(cy as never)
    vi.mocked(watchGraphSize).mockReturnValue(disconnect)
    const removeEventListener = vi.fn()
    vi.stubGlobal('window', { matchMedia: () => ({ addEventListener: vi.fn(), removeEventListener }) })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => name === '--mono' ? 'monospace' : '#111111' }))
    const data = { nodes: patterns.data.nodes, transfers: patterns.data.transfers, conditions: patterns.meta.conditions, startLabel: '기준' } as TransferGraphData
    const onSelect = vi.fn()
    TransferGraph({ result: data, selectedTransferId: null, onSelect })
    const options = vi.mocked(cytoscape).mock.calls.at(-1)![0] as unknown as CytoscapeOptions
    expect(options.layout).toMatchObject({ name: 'concentric', avoidOverlap: true })
    expect(options.elements).toHaveLength(10)
    const edgeStyle = (options.style as { selector: string; style: Record<string, unknown> }[]).find(rule => rule.selector === 'edge')!.style
    expect(edgeStyle['text-rotation']).toBe('none')
    expect(edgeStyle['font-size']).toBe(12)
    expect(edgeStyle['curve-style']).toBe('bezier')
    expect(edgeStyle['control-point-step-size']).toBe(64)
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
