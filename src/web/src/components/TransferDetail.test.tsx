import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TransferDetail from './TransferDetail'
import CopyButton from './CopyButton'
import type { Transfer } from '../types'
import success from '../../mocks/v1/samples/trace-success.json'

const transfer: Transfer = {
  ...success.data.transfers[0] as Transfer,
  blockHash: `0x${'ab'.repeat(32)}`,
  asset: { ...success.data.transfers[0].asset, tokenAddress: `0x${'cd'.repeat(20)}`, chainId: 11155111 },
}
describe('transfer evidence detail', () => {
  it('shows complete per-transfer evidence and preserves existing fields', () => {
    const html = renderToStaticMarkup(<TransferDetail transfer={transfer} />)
    for (const text of [transfer.blockHash, transfer.asset.tokenAddress, String(transfer.asset.chainId), transfer.txHash, transfer.blockNumber, transfer.id,
      '블록 시각', 'transactionIndex', 'logIndex', '보낸 주소', '받은 주소', '금액']) expect(html).toContain(text)
    expect(html).toContain('class="mono full-value"')
    for (const label of ['블록 해시', '토큰 주소', '거래 번호']) expect(html).toContain(`aria-label="${label} 복사"`)
  })
  it('passes full original values to the shared copy control', () => {
    const values = new Map<string, string>()
    function visit(node: ReactNode) {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!isValidElement<{ children?: ReactNode; label: string; value: string }>(node)) return
      if (node.type === CopyButton) values.set(node.props.label, node.props.value)
      visit(node.props.children)
    }
    visit(TransferDetail({ transfer }))
    expect(Object.fromEntries(values)).toEqual({ '보낸 주소': transfer.from, '받은 주소': transfer.to, '토큰 주소': transfer.asset.tokenAddress, '블록 해시': transfer.blockHash, '거래 번호': transfer.txHash })
  })
  it('updates evidence to the newly selected transfer', () => {
    const next = { ...transfer, id: 'next', blockHash: `0x${'ef'.repeat(32)}`, asset: { ...transfer.asset, chainId: 1, tokenAddress: `0x${'12'.repeat(20)}` } }
    const html = renderToStaticMarkup(<TransferDetail transfer={next} />)
    expect(html).toContain(next.blockHash)
    expect(html).toContain(next.asset.tokenAddress)
    expect(html).toContain('<dd>1</dd>')
    expect(html).not.toContain(transfer.blockHash)
    expect(html).not.toContain(transfer.asset.tokenAddress)
  })
  it('shows transfer, transaction and block labels and notes when present', () => {
    const labeled = { ...transfer, label: '송금A', note: '메모A', txLabel: '거래B', txNote: '메모B', blockLabel: '블록C', blockNote: '<b>메모C</b>' }
    const html = renderToStaticMarkup(<TransferDetail transfer={labeled} />)
    for (const text of ['송금 이름표', '송금A', '송금 메모', '메모A', '거래 이름표', '거래B', '거래 메모', '메모B', '블록 이름표', '블록C', '블록 메모']) expect(html).toContain(text)
    expect(html).toContain('&lt;b&gt;메모C&lt;/b&gt;')
    expect(html).not.toContain('<b>메모C</b>')
  })
  it('omits label and note rows that the API did not send', () => {
    const html = renderToStaticMarkup(<TransferDetail transfer={{ ...transfer, label: undefined, txLabel: '거래B' }} />)
    expect(html).toContain('거래 이름표')
    for (const name of ['송금 이름표', '송금 메모', '거래 메모', '블록 이름표', '블록 메모']) expect(html).not.toContain(name)
  })
  it('keeps the unselected placeholder and omits evidence controls', () => {
    const html = renderToStaticMarkup(<TransferDetail transfer={null} />)
    expect(html).toContain('표나 그래프에서 송금을 선택하면')
    expect(html).not.toContain('블록 해시')
    expect(html).not.toContain('토큰 주소')
  })
  it.each(['trace', 'analysis'] as const)('prioritizes %s amount, addresses and time while preserving all technical evidence', variant => {
    const html = renderToStaticMarkup(<TransferDetail transfer={transfer} variant={variant} />)
    const basic = html.slice(0, html.indexOf('<details'))
    expect(basic).toContain('1200 SKK')
    expect(basic).toContain(transfer.from)
    expect(basic).toContain(transfer.to)
    expect(basic).toContain(`dateTime="${transfer.timestamp}"`)
    expect(basic).not.toContain('블록 해시')
    const technical = html.slice(html.indexOf('<details'))
    for (const value of [transfer.blockHash, transfer.txHash, transfer.blockNumber, transfer.id, transfer.asset.tokenAddress, transfer.amountRaw, 'transactionIndex', 'logIndex']) expect(technical).toContain(value)
    expect(technical).toContain('송금 ID 복사')
    expect(technical).not.toMatch(/<details[^>]*\sopen/)
  })
  it.each(['trace', 'analysis'] as const)('keeps all present annotations visible and escaped outside %s technical details', variant => {
    const labeled = { ...transfer, label: '송금A', note: '메모A', txLabel: '거래B', txNote: '메모B', blockLabel: '블록C', blockNote: '<b>메모C</b>' }
    const html = renderToStaticMarkup(<TransferDetail transfer={labeled} variant={variant} />)
    const visible = html.slice(0, html.indexOf('<details'))
    for (const value of ['송금 이름표', '송금 메모', '거래 이름표', '거래 메모', '블록 이름표', '블록 메모', '&lt;b&gt;메모C&lt;/b&gt;']) expect(visible).toContain(value)
    expect(html).not.toContain('<b>메모C</b>')
    const plain = renderToStaticMarkup(<TransferDetail transfer={{ ...transfer, label: undefined }} variant={variant} />)
    expect(plain).not.toContain('이름표 및 메모')
  })
})
