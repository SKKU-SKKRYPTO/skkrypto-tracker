import { formatAmount, shortenHex } from '../format'
import type { Transfer } from '../types'

type Props = {
  transfers: Transfer[]
  selectedTransferId: string | null
  onSelect?: (transferId: string) => void
  highlightedTransferIds?: ReadonlySet<string>
  evidenceKind?: 'path' | 'pattern'
}

function TransferTable({ transfers, selectedTransferId, onSelect, highlightedTransferIds, evidenceKind = 'path' }: Props) {
  const evidenceLabel = evidenceKind === 'pattern' ? '패턴' : '경로'
  return (
    <div className="table-scroll" role="region" aria-label="송금 목록 표" tabIndex={0}>
      <table className={onSelect ? 'transfers' : 'transfers transfers-readonly'}>
        <thead>
          <tr>
            <th>{onSelect ? '선택' : `${evidenceLabel} 근거`}</th>
            <th>보낸 주소</th>
            <th>받은 주소</th>
            <th className="num">금액</th>
            <th className="num">블록 번호</th>
            <th>거래 번호</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((transfer) => {
            const isSelected = transfer.id === selectedTransferId
            const isPathEvidence = highlightedTransferIds?.has(transfer.id) === true
            return (
              <tr
                key={transfer.id}
                className={[isSelected ? 'selected' : '', isPathEvidence ? 'path-highlighted' : ''].filter(Boolean).join(' ') || undefined}
                data-transfer-id={transfer.id}
                data-path-highlighted={isPathEvidence ? 'true' : undefined}
                onClick={onSelect ? () => onSelect(transfer.id) : undefined}
              >
                <td>
                  {/* 키보드 사용자는 Tab으로 이 버튼에 와서 Enter나 Space로 선택한다 */}
                  {onSelect ? <button
                    type="button"
                    className="select-button"
                    aria-pressed={isSelected}
                    aria-label={`송금 ${transfer.id} 상세 보기`}
                    onClick={() => onSelect(transfer.id)}
                  >
                    {isSelected ? '✓ 선택됨' : '보기'}
                  </button> : <span>{isPathEvidence ? `${evidenceLabel} 포함` : '—'}</span>}
                  {onSelect && isPathEvidence && <span className="path-membership">{evidenceLabel} 포함</span>}
                </td>
                <td className="mono" title={transfer.from}>
                  {shortenHex(transfer.from)}
                </td>
                <td className="mono" title={transfer.to}>
                  {shortenHex(transfer.to)}
                </td>
                <td className="num">
                  {formatAmount(transfer)}
                </td>
                <td className="num">{transfer.blockNumber}</td>
                <td className="mono" title={transfer.txHash}>
                  {shortenHex(transfer.txHash)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default TransferTable

