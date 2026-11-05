import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import cytoscape from 'cytoscape'
import PatternResults from './PatternResults'
import TransferGraph from './TransferGraph'
import TransferTable from './TransferTable'
import TransferDetail from './TransferDetail'
import { applyTransferHighlights } from './graphHighlights'
import { buildElements } from './graphElements'
import { resolvePatternSelection } from '../patternSelection'
import type { PatternEnvelope } from '../api/patterns'
import sample from '../../mocks/v1/samples/patterns-success.json'
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useMemo: (factory: () => unknown) => factory() }))
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function setup(envelope = structuredClone(sample) as PatternEnvelope, index = 0, selected = envelope.data.transfers[0]?.id ?? null) {
  const onSelectPattern = vi.fn(), onSelectTransfer = vi.fn()
  const tree = PatternResults({ envelope, selectedPatternId: envelope.data.patterns[index]?.patternId ?? 'missing', selectedTransferId: selected, onSelectPattern, onSelectTransfer })
  const nodes = elements(tree)
  return { tree, nodes, onSelectPattern, onSelectTransfer,
    graph: nodes.find(n => n.type === TransferGraph)!, table: nodes.find(n => n.type === TransferTable)!, detail: nodes.find(n => n.type === TransferDetail)! }
}
describe('Pattern highlighting and transfer details', () => {
  it.each(['incoming', 'outgoing'] as const)('shares deduplicated evidence and preserves %s arrows', direction => {
    const e = structuredClone(sample) as PatternEnvelope
    if (direction === 'outgoing') {
      for (const t of e.data.transfers) [t.from, t.to] = [t.to, t.from]
      for (const p of e.data.patterns) { p.direction = 'outgoing'; p.ruleId = 'FAN_OUT' }
    }
    e.data.transfers.push(e.data.transfers[0])
    const f = setup(e), ids = f.graph.props.highlightedTransferIds as Set<string>
    expect(f.table.props.highlightedTransferIds).toBe(ids)
    expect([...ids]).toEqual(e.data.patterns[0].evidenceIds)
    const graphData = f.graph.props.result as Parameters<typeof buildElements>[0]
    expect(f.table.props.transfers).toBe(graphData.transfers); expect(graphData.transfers).toHaveLength(5)
    const edges = buildElements(graphData).filter(n => n.group === 'edges')
    expect(edges).toHaveLength(5)
    for (const t of graphData.transfers) expect(edges.find(edge => edge.data.id === t.id)?.data).toMatchObject({ source: t.from, target: t.to })
    const cy = cytoscape({ headless: true, elements: buildElements(graphData) })
    try {
      applyTransferHighlights(cy, e.data.transfers[0].id, ids)
      expect(cy.edges('.path-highlighted')).toHaveLength(3)
      expect(cy.edges('.selected.path-highlighted')).toHaveLength(1)
      applyTransferHighlights(cy, null, new Set(e.data.patterns[1].evidenceIds))
      expect(cy.edges('.path-highlighted').map(edge => edge.id()).sort()).toEqual([...e.data.patterns[1].evidenceIds].sort())
      expect(cy.edges('.selected')).toHaveLength(0)
    } finally { cy.destroy() }
    const html = renderToStaticMarkup(f.tree)
    expect(html).toContain('패턴 포함'); expect(html).not.toContain('경로 포함')
    expect(html).toContain('패턴 근거 송금 그래프')
  })
  it('selects stable window IDs, supports clear and keeps shared group windows separate', () => {
    const f = setup(), button = f.nodes.find(n => n.props['aria-label'] === '패턴 2 선택')!
    ;(button.props.onClick as () => void)()
    ;(f.graph.props.onClearSelection as () => void)()
    expect(f.onSelectPattern.mock.calls).toEqual([[sample.data.patterns[1].patternId], [null]])
    expect(f.nodes.find(n => n.props['aria-label'] === '패턴 1 선택')!.props['aria-pressed']).toBe(true)
    const second = setup(undefined, 1)
    expect([...(second.graph.props.highlightedTransferIds as Set<string>)]).toEqual(sample.data.patterns[1].evidenceIds)
  })
  it('connects list, table and graph to the same detail object and callback', () => {
    const f = setup(), t = sample.data.transfers[0]
    expect(f.table.props.selectedTransferId).toBe(t.id); expect(f.graph.props.selectedTransferId).toBe(t.id)
    expect(f.table.props.onSelect).toBe(f.graph.props.onSelect); expect(f.detail.props.transfer).toEqual(t)
    ;(f.graph.props.onSelect as (id: string) => void)(t.id)
    const table = TransferTable(f.table.props as Parameters<typeof TransferTable>[0])
    const button = elements(table).find(n => n.props['aria-label'] === `송금 ${t.id} 상세 보기`)!
    const click = { stopPropagation: vi.fn() }
    ;(button.props.onClick as (event: typeof click) => void)(click)
    expect(click.stopPropagation).toHaveBeenCalledOnce()
    const evidence = f.nodes.find(n => n.props['aria-label'] === `패턴 1 근거 송금 ${t.id} 상세 보기`)!
    ;(evidence.props.onClick as () => void)()
    expect(evidence.props['aria-pressed']).toBe(true)
    expect(f.onSelectTransfer.mock.calls).toEqual([[t.id], [t.id], [t.id]])
    const html = renderToStaticMarkup(<TransferDetail {...f.detail.props as Parameters<typeof TransferDetail>[0]} />)
    for (const v of [t.id, t.txHash, t.blockHash, t.asset.tokenAddress]) expect(html).toContain(v)
  })
  it.each(['missing', 'empty'] as const)('handles %s evidence safely without inventing transfers', mode => {
    const e = structuredClone(sample) as PatternEnvelope
    e.data.patterns[0].evidenceIds = mode === 'missing' ? ['missing', ...e.data.patterns[0].evidenceIds] : []
    const f = setup(e, 0, 'missing')
    expect((f.graph.props.highlightedTransferIds as Set<string>).size).toBe(0)
    expect(f.detail.props.transfer).toBeNull(); expect(f.graph.props.selectedTransferId).toBeNull()
    expect(f.nodes.find(n => n.props['aria-label'] === '패턴 1 선택')!.props.disabled).toBe(true)
    if (mode === 'missing') expect(renderToStaticMarkup(f.tree)).toContain('근거 송금 정보를 확인할 수 없습니다')
    expect((f.table.props.transfers as unknown[])).toHaveLength(5)
  })
  it('deduplicates repeated evidence IDs and safely rejects unknown patterns', () => {
    const e = structuredClone(sample) as PatternEnvelope
    e.data.patterns[0].evidenceIds.push(e.data.patterns[0].evidenceIds[0])
    expect(resolvePatternSelection(e.data.patterns, e.data.transfers, e.data.patterns[0].patternId).transferIds.size).toBe(3)
    expect(resolvePatternSelection(e.data.patterns, e.data.transfers, 'missing').pattern).toBeNull()
  })
  it('shows no stale graph, table or detail after an empty result', () => {
    const e = structuredClone(sample) as PatternEnvelope; e.data.patterns = []; e.data.transfers = []
    const f = setup(e)
    expect(f.graph).toBeUndefined(); expect(f.table).toBeUndefined(); expect(f.detail).toBeUndefined()
  })
})
