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
  it('keeps the unselected placeholder and omits evidence controls', () => {
    const html = renderToStaticMarkup(<TransferDetail transfer={null} />)
    expect(html).toContain('표나 그래프에서 송금을 선택하면')
    expect(html).not.toContain('블록 해시')
    expect(html).not.toContain('토큰 주소')
  })
})
