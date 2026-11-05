import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TransferTable from './TransferTable'
import type { Transfer } from '../types'
import sample from '../../mocks/v1/samples/trace-success.json'
import { formatTimestamp } from '../format'

const transfers = sample.data.transfers as Transfer[]
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
describe('Trace transfer table', () => {
  it('keeps server order and four columns with accessible full addresses and times', () => {
    const html = renderToStaticMarkup(<TransferTable variant="trace" transfers={transfers} selectedTransferId={null} onSelect={() => {}} />)
    expect(html.match(/<th[ >]/g)).toHaveLength(4)
    for (const title of ['송금 시간', '보낸 주소', '받는 주소', '금액 및 자산']) expect(html).toContain(title)
    expect([...html.matchAll(/data-transfer-id="([^"]+)"/g)].map(match => match[1])).toEqual(transfers.map(t => t.id))
    expect(html).toContain(`dateTime="${transfers[0].timestamp}"`)
    expect(html).toContain(formatTimestamp(transfers[0].timestamp))
    expect(html).toContain('보낸 주소 전체 주소 보기')
    expect(html).toContain('받는 주소 복사')
    expect(html).toContain(transfers[0].from)
    expect(html).toContain('aria-label="송금 목록 표" tabindex="0"')
  })
  it('selects the exact ID once from either a row or its keyboard button', () => {
    const onSelect = vi.fn(), selected = transfers[1]
    const nodes = elements(TransferTable({ variant: 'trace', transfers, selectedTransferId: selected.id, onSelect }))
    const row = nodes.find(n => n.type === 'tr' && n.props['data-transfer-id'] === selected.id)!
    expect(row.props.className).toBe('selected')
    ;(row.props.onClick as () => void)()
    const button = nodes.find(n => n.type === 'button' && n.props['aria-pressed'] === true)!
    const event = { stopPropagation: vi.fn() }
    ;(button.props.onClick as (e: typeof event) => void)(event)
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(onSelect.mock.calls).toEqual([[selected.id], [selected.id]])
  })
  it('preserves parallel transfer IDs and large amount strings', () => {
    const pair = [transfers[0], { ...transfers[0], id: 'derived-parallel', amountRaw: '123456789012345678901234567890123456789' }]
    const html = renderToStaticMarkup(<TransferTable variant="trace" transfers={pair} selectedTransferId={pair[1].id} onSelect={() => {}} />)
    expect(html).toContain('1234567890123456789012345678901234567.89 SKK')
    expect(html.match(/data-transfer-id=/g)).toHaveLength(2)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('✓')
  })
  it.each(['path', 'pattern'] as const)('keeps %s evidence and single-transfer selection distinct in the shared four-column table', evidenceKind => {
    const ids = new Set(transfers.slice(0, 3).map(t => t.id))
    const html = renderToStaticMarkup(<TransferTable variant="analysis" transfers={transfers} selectedTransferId={transfers[1].id} highlightedTransferIds={ids} evidenceKind={evidenceKind} onSelect={() => {}} />)
    expect(html.match(/<th[ >]/g)).toHaveLength(4)
    expect(html.match(/data-path-highlighted="true"/g)).toHaveLength(3)
    expect(html).toContain('class="selected path-highlighted"')
    expect(html).toContain(evidenceKind === 'path' ? '경로 포함' : '패턴 포함')
    expect([...html.matchAll(/data-transfer-id="([^"]+)"/g)].map(match => match[1])).toEqual(transfers.map(t => t.id))
  })
  it('retains the legacy table when compact presentation is not requested', () => {
    const html = renderToStaticMarkup(<TransferTable transfers={transfers} selectedTransferId={null} highlightedTransferIds={new Set([transfers[0].id])} evidenceKind="pattern" />)
    expect(html.match(/<th[ >]/g)).toHaveLength(6)
    expect(html).toContain('패턴 포함')
    expect(html).toContain('블록 번호')
    expect(html).not.toContain('trace-transfer-panel')
  })
})
