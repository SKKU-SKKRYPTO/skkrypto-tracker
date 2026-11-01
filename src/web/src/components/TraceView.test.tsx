import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TraceView from './TraceView'
import TransferTable from './TransferTable'
import TransferGraph from './TransferGraph'
import TransferDetail from './TransferDetail'
import { adaptTraceResponse } from '../adapters/traceAdapter'
import type { TraceResult } from '../types'
import type { Truncation } from '../api/v1Types'
import { formatTimestamp } from '../format'
import dataset from '../../mocks/v1/samples/dataset-detail.json'
import success from '../../mocks/v1/samples/trace-success.json'
import empty from '../../mocks/v1/samples/trace-ready-empty.json'
import partial from '../../mocks/v1/samples/trace-candidate-limit.json'

function result(body: unknown): TraceResult {
  const response = adaptTraceResponse(body, dataset)
  if (!response.ok) throw Error('Invalid test fixture')
  return response.result
}
function render(value: TraceResult) {
  return renderToStaticMarkup(<TraceView result={value} selectedTransferId={null} onSelect={() => {}} />)
}

describe('trace result presentation', () => {
  it('keeps normal results separate from partial and empty notices', () => {
    const html = render(result(success))
    expect(html).toContain('송금 상세')
    expect(html).not.toContain('일부만 표시됨')
    expect(html).not.toContain('관측되지 않음')
    expect(html).not.toContain('role="alert"')
  })
  it('keeps the empty-result coverage notice', () => {
    const html = render(result(empty))
    expect(html).toContain('선택한 수집 범위에서 관측되지 않음')
    expect(html).toContain(empty.meta.coverage.startBlock)
    expect(html).not.toContain('일부만 표시됨')
    expect(html).not.toContain('송금 상세')
  })
  it('translates partial reasons without changing counts, analyzed position or source data', () => {
    const value = result(partial)
    const before = structuredClone(value)
    const html = render(value)
    expect(html).toContain('분석 후보 송금 수 제한으로 일부 후보만 분석했습니다.')
    expect(html).not.toContain('CANDIDATE_LIMIT')
    expect(html).toContain(`찾은 송금 ${value.limits.found}건 이상 중 ${value.transfers.length}건 표시`)
    expect(html).toContain(`블록 ${value.limits.analyzedUntil!.blockNumber}까지만 분석`)
    expect(html).toContain(formatTimestamp(value.limits.analyzedUntil!.timestamp))
    expect(value).toEqual(before)
  })
  it('renders multiple reasons and an unknown future reason safely', () => {
    const value = result(partial)
    // Bypass the unchanged API validator to exercise only the presentation fallback.
    value.limits.truncated = { reason: 'FUTURE_LIMIT', reasons: ['EDGE_LIMIT', 'NODE_LIMIT', 'FUTURE_LIMIT'] } as unknown as Truncation
    const html = render(value)
    expect(html).toContain('결과에 포함할 수 있는 송금 수 제한에 도달했습니다.')
    expect(html).toContain('결과에 포함할 수 있는 주소 수 제한에 도달했습니다.')
    expect(html).toContain('분석 제한으로 결과의 일부만 표시합니다.')
    for (const code of ['EDGE_LIMIT', 'NODE_LIMIT', 'FUTURE_LIMIT']) expect(html).not.toContain(code)
  })
  it('preserves the same transfer ID selection callback for table, graph and detail', () => {
    const value = result(success)
    const onSelect = vi.fn()
    const selected = value.transfers[1]
    const tree = TraceView({ result: value, selectedTransferId: selected.id, onSelect })
    let linked = 0
    function visit(node: ReactNode) {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!isValidElement<{ children?: ReactNode; onSelect?: (id: string) => void; selectedTransferId?: string; transfer?: unknown }>(node)) return
      if (node.type === TransferTable || node.type === TransferGraph) {
        expect(node.props.selectedTransferId).toBe(selected.id)
        node.props.onSelect!(selected.id)
        linked++
      }
      if (node.type === TransferDetail) expect(node.props.transfer).toBe(selected)
      visit(node.props.children)
    }
    visit(tree)
    expect(linked).toBe(2)
    expect(onSelect.mock.calls).toEqual([[selected.id], [selected.id]])
  })
})
