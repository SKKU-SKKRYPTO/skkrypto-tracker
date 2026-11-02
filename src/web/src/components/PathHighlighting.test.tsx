import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactNode, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PathResults from './PathResults'
import TransferTable from './TransferTable'
import TransferGraph from './TransferGraph'
import { buildElements } from './graphElements'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PathsResult } from '../adapters/pathsAdapter'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import normal from '../../mocks/v1/samples/paths-success.json'
import partial from '../../mocks/v1/samples/paths-path-limit.json'

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useMemo: (factory: () => unknown) => factory() }))
function result(body: unknown = normal) {
  const adapted = adaptPathsResponse(body, detail, { datasetId: 'flow-demo', datasetVersion: 'v1' })
  if (!adapted.ok) throw Error('Invalid fixture')
  return adapted.result
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
describe('shared Path selection rendering', () => {
  it.each([normal, partial])('provides keyboard-accessible path selection and clear actions', sample => {
    const value = result(sample), onSelectPath = vi.fn(), path = value.data.paths[0]
    const tree = PathResults({ result: value, selectedPathId: path.id, onSelectPath }), nodes = elements(tree)
    const button = nodes.find(node => node.props['aria-label'] === '경로 1 선택')!
    expect(button.props['aria-pressed']).toBe(true)
    ;(button.props.onClick as () => void)()
    const clear = nodes.find(node => node.type === 'button' && node.props.children === '경로 선택 해제')!
    ;(clear.props.onClick as () => void)()
    expect(onSelectPath.mock.calls).toEqual([[path.id], [null]])
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('근거 송금 3건을 그래프와 표에 강조')
    expect(html).not.toContain('상세 보기')
  })
  it.each([0, 1])('passes the identical evidence set and deduplicated transfer objects to both views for path %s', index => {
    const value = result(), selected = value.data.paths[index]
    value.data.transfers.push(value.data.transfers[0])
    const tree = PathResults({ result: value, selectedPathId: selected.id, onSelectPath: () => {} }), nodes = elements(tree)
    const table = nodes.find(node => node.type === TransferTable)!, graph = nodes.find(node => node.type === TransferGraph)!
    expect(table.props.highlightedTransferIds).toBe(graph.props.highlightedTransferIds)
    expect([...(table.props.highlightedTransferIds as Set<string>)]).toEqual(selected.transferIds)
    expect(table.props.selectedTransferId).toBeNull()
    expect(graph.props.selectedTransferId).toBeNull()
    expect(table.props.onSelect).toBeUndefined()
    expect(graph.props.onSelect).toBeUndefined()
    const graphData = graph.props.result as Parameters<typeof buildElements>[0]
    expect(table.props.transfers).toBe(graphData.transfers)
    expect(graphData.transfers).toHaveLength(5)
    expect(buildElements(graphData).filter(element => element.group === 'edges')).toHaveLength(5)
    const html = renderToStaticMarkup(tree)
    expect((html.match(/data-path-highlighted="true"/g) ?? []).length).toBe(3)
    expect((html.match(/class="path-highlighted"/g) ?? []).length).toBe(3)
    expect(html).toContain('aria-pressed="true"')
  })
  it('preserves incoming direction and the ordered path evidence', () => {
    const value = result()
    Object.assign(value.meta.conditions, { direction: 'incoming', address: normal.meta.conditions.targetAddress, targetAddress: normal.meta.conditions.address })
    const nodes = elements(PathResults({ result: value, selectedPathId: value.data.paths[0].id }))
    const graph = nodes.find(node => node.type === TransferGraph)!
    expect((graph.props.result as Parameters<typeof buildElements>[0]).layoutRoot).toBe(normal.meta.conditions.address)
    expect((graph.props.result as Parameters<typeof buildElements>[0]).conditions.address).toBe(normal.meta.conditions.targetAddress)
    const edges = buildElements(graph.props.result as Parameters<typeof buildElements>[0]).filter(element => element.group === 'edges')
    for (const transfer of normal.data.transfers) expect(edges.find(edge => edge.data.id === transfer.id)?.data).toMatchObject({ source: transfer.from, target: transfer.to })
    expect([...(graph.props.highlightedTransferIds as Set<string>)]).toEqual(normal.data.paths[0].transferIds)
  })
  it.each(['missing-path', normal.data.paths[0].id])('never highlights nonexistent references (%s)', id => {
    const value = result(); value.data.paths[0].transferIds[0] = 'missing-transfer'
    const tree = PathResults({ result: value, selectedPathId: id, onSelectPath: () => {} }), nodes = elements(tree)
    const graph = nodes.find(node => node.type === TransferGraph)!
    expect((graph.props.highlightedTransferIds as Set<string>).size).toBe(0)
    expect(renderToStaticMarkup(tree)).toContain('근거 송금 정보를 확인할 수 없습니다')
  })
  it('shows no graph/table or stale highlight for an empty result', () => {
    const value: PathsResult = result(); value.data.paths = []; value.data.transfers = []; value.data.nodes = []; value.data.limits.found = 0
    const tree = PathResults({ result: value, selectedPathId: 'old', onSelectPath: () => {} }), nodes = elements(tree)
    expect(nodes.some(node => node.type === TransferGraph || node.type === TransferTable)).toBe(false)
    expect(renderToStaticMarkup(tree)).toContain('후보 경로가 관측되지 않았습니다')
  })
  it('retains the existing Trace single-row selection and callbacks', () => {
    const transfer = normal.data.transfers[0], onSelect = vi.fn()
    const tree = TransferTable({ transfers: normal.data.transfers as Parameters<typeof TransferTable>[0]['transfers'], selectedTransferId: transfer.id, onSelect })
    const nodes = elements(tree), button = nodes.find(node => node.props['aria-label'] === `송금 ${transfer.id} 상세 보기`)!
    expect(button.props['aria-pressed']).toBe(true)
    ;(button.props.onClick as () => void)()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(transfer.id)
    expect(renderToStaticMarkup(tree)).toContain('class="selected"')
    expect(renderToStaticMarkup(tree)).not.toContain('path-highlighted')
  })
})
