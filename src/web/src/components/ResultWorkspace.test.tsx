import { afterEach, describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PathResults from './PathResults'
import PatternResults from './PatternResults'
import TraceView from './TraceView'
import TransferGraph from './TransferGraph'
import TransferTable from './TransferTable'
import WorkspaceSelection from './WorkspaceSelection'
import { buildElements } from './graphElements'
import { adaptTraceResponse } from '../adapters/traceAdapter'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PatternEnvelope } from '../api/patterns'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import paths from '../../mocks/v1/samples/paths-success.json'
import trace from '../../mocks/v1/samples/trace-success.json'
import patterns from '../../mocks/v1/samples/patterns-success.json'
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useMemo: (fn: () => unknown) => fn() }))
afterEach(() => vi.restoreAllMocks())
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
describe('result workspace structure and navigation', () => {
  it.each(['paths', 'patterns'] as const)('places %s list, graph and evidence inside the same workspace', mode => {
    const p = adaptPathsResponse(paths, detail, { datasetId: 'flow-demo', datasetVersion: 'v1' })
    if (!p.ok) throw Error('sample')
    const tree = mode === 'paths' ? PathResults({ result: p.result, selectedPathId: paths.data.paths[0].id, selectedTransferId: paths.data.transfers[0].id, onSelectTransfer: () => {} }) : PatternResults({ envelope: patterns as PatternEnvelope, selectedPatternId: patterns.data.patterns[0].patternId, selectedTransferId: patterns.data.transfers[0].id, onSelectTransfer: () => {} })
    const nodes = elements(tree), workspace = nodes.find(n => n.props.className === 'analysis-workspace')!
    const children = elements(workspace.props.children as ReactNode)
    const list = children.findIndex(n => n.props.className === 'result-list'), graph = children.findIndex(n => n.type === TransferGraph), table = children.findIndex(n => n.type === TransferTable)
    expect(list).toBeGreaterThanOrEqual(0); expect(graph).toBeGreaterThan(list); expect(table).toBeGreaterThan(graph)
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('선택한 분석 결과:'); expect(html).toContain('선택한 개별 송금:')
    expect(html).toContain('href="#detail-title"'); expect(html).toContain('id="detail-title" tabindex="-1"')
    expect(html).not.toContain('scrollIntoView')
  })
  it('keeps Trace without an analysis list and places graph before table', () => {
    const r = adaptTraceResponse(trace, detail); if (!r.ok) throw Error('sample')
    const tree = TraceView({ result: r.result, selectedTransferId: null, onSelect: () => {} })
    const nodes = elements(tree)
    expect(nodes.findIndex(n => n.type === TransferGraph)).toBeLessThan(nodes.findIndex(n => n.type === TransferTable))
    expect(nodes.some(n => n.props.className === 'result-list')).toBe(false)
    expect(renderToStaticMarkup(tree)).not.toContain('href="#detail-title"')
  })
  it('uses a center label and preserves separate parallel incoming transfers and directions', () => {
    const nodes = elements(PatternResults({ envelope: patterns as PatternEnvelope }))
    const data = nodes.find(n => n.type === TransferGraph)!.props.result as Parameters<typeof buildElements>[0]
    const built = buildElements(data), center = built.find(e => e.data.id === patterns.meta.conditions.address)!
    expect(center.data.label).toContain('기준\n')
    const parallel = built.filter(e => e.group === 'edges' && e.data.source === patterns.data.transfers[1].from)
    expect(parallel).toHaveLength(2)
    expect(new Set(parallel.map(e => e.data.id)).size).toBe(2)
    expect(parallel.every(e => e.data.target === patterns.meta.conditions.address)).toBe(true)
  })
  it('offers explicit detail navigation only for a resolved transfer', () => {
    const html = renderToStaticMarkup(<WorkspaceSelection group="패턴 2" transfer={patterns.data.transfers[0] as never} />)
    expect(html).toContain('패턴 2'); expect(html).toContain('선택한 송금 상세로 이동')
    expect(renderToStaticMarkup(<WorkspaceSelection group={null} transfer={null} />)).not.toContain('<a')
  })
})
