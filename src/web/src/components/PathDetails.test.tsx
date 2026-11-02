import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import cytoscape from 'cytoscape'
import PathResults from './PathResults'
import TransferTable from './TransferTable'
import TransferGraph from './TransferGraph'
import TransferDetail from './TransferDetail'
import CopyButton from './CopyButton'
import { applyTransferHighlights } from './graphHighlights'
import { buildElements } from './graphElements'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { Transfer } from '../types'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import sample from '../../mocks/v1/samples/paths-success.json'

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useMemo: (factory: () => unknown) => factory() }))
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function setup(selected = sample.data.transfers[0].id) {
  const response = adaptPathsResponse(sample, detail, { datasetId: 'flow-demo', datasetVersion: 'v1' })
  if (!response.ok) throw Error('Invalid fixture')
  const onSelectTransfer = vi.fn()
  const tree = PathResults({ result: response.result, selectedPathId: sample.data.paths[0].id, selectedTransferId: selected,
    onSelectPath: () => {}, onSelectTransfer })
  const nodes = elements(tree)
  return { tree, nodes, onSelectTransfer, table: nodes.find(node => node.type === TransferTable)!, graph: nodes.find(node => node.type === TransferGraph)!, detail: nodes.find(node => node.type === TransferDetail)! }
}
describe('Path transfer detail component integration', () => {
  it('shares selected ID, callback and path evidence between graph/table, and resolves the same detail object', () => {
    const f = setup(), transfer = sample.data.transfers[0]
    expect(f.table.props.selectedTransferId).toBe(transfer.id)
    expect(f.graph.props.selectedTransferId).toBe(transfer.id)
    expect(f.table.props.onSelect).toBe(f.graph.props.onSelect)
    expect(f.table.props.onSelect).toBe(f.onSelectTransfer)
    expect(f.table.props.highlightedTransferIds).toBe(f.graph.props.highlightedTransferIds)
    expect(f.detail.props.transfer).toEqual(transfer)
    ;(f.graph.props.onSelect as (id: string) => void)(transfer.id)
    const table = TransferTable(f.table.props as Parameters<typeof TransferTable>[0])
    const tableButton = elements(table).find(node => node.props['aria-label'] === `송금 ${transfer.id} 상세 보기`)!
    ;(tableButton.props.onClick as () => void)()
    const evidenceButton = f.nodes.find(node => node.props['aria-label'] === `경로 1 근거 송금 ${transfer.id} 상세 보기`)!
    ;(evidenceButton.props.onClick as () => void)()
    expect(f.onSelectTransfer.mock.calls).toEqual([[transfer.id], [transfer.id], [transfer.id]])
    expect(tableButton.props['aria-pressed']).toBe(true)
    expect(evidenceButton.props['aria-pressed']).toBe(true)
  })
  it('renders original block/asset evidence and passes complete values to unchanged copy controls', () => {
    const f = setup(), transfer = f.detail.props.transfer as Transfer
    const detailTree = TransferDetail({ transfer })
    const html = renderToStaticMarkup(detailTree)
    for (const value of [transfer.id, transfer.txHash, transfer.blockHash, transfer.asset.tokenAddress, String(transfer.asset.chainId), transfer.blockNumber]) expect(html).toContain(value)
    const buttons = elements(detailTree).filter(node => node.type === CopyButton)
    expect(buttons.find(node => node.props.label === '블록 해시')?.props.value).toBe(transfer.blockHash)
    expect(buttons.find(node => node.props.label === '거래 번호')?.props.value).toBe(transfer.txHash)
    expect(buttons.find(node => node.props.label === '토큰 주소')?.props.value).toBe(transfer.asset.tokenAddress)
  })
  it('does not display details or selections for an unknown transfer ID', () => {
    const f = setup('missing')
    expect(f.detail.props.transfer).toBeNull()
    expect(f.table.props.selectedTransferId).toBeNull()
    expect(f.graph.props.selectedTransferId).toBeNull()
    expect(renderToStaticMarkup(f.tree)).toContain('표나 그래프에서 송금을 선택하면')
  })
  it('keeps path and individual Cytoscape classes independent on the same edge', () => {
    const f = setup(), cy = cytoscape({ headless: true, elements: buildElements(f.graph.props.result as Parameters<typeof buildElements>[0]) })
    try {
      applyTransferHighlights(cy, f.graph.props.selectedTransferId as string, f.graph.props.highlightedTransferIds as Set<string>)
      expect(cy.edges('.selected')).toHaveLength(1)
      expect(cy.edges('.path-highlighted')).toHaveLength(3)
      expect(cy.edges('.selected.path-highlighted').map(edge => edge.id())).toEqual([sample.data.transfers[0].id])
      const html = renderToStaticMarkup(f.tree)
      expect(html).toContain('class="selected path-highlighted"')
      expect(html).toContain('경로 포함')
    } finally { cy.destroy() }
  })
})
