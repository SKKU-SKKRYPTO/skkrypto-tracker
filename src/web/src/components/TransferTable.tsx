import { formatAmount, formatTimestamp, formatTransferTime, shortenHex } from '../format'
import type { Transfer } from '../types'
import AddressValue from './AddressValue'

type Props = {
  transfers: Transfer[]
  selectedTransferId: string | null
  onSelect?: (transferId: string) => void
  highlightedTransferIds?: ReadonlySet<string>
  evidenceKind?: 'path' | 'pattern'
  variant?: 'default' | 'trace' | 'analysis'
}

function TransferTable({ transfers, selectedTransferId, onSelect, highlightedTransferIds, evidenceKind = 'path', variant = 'default' }: Props) {
  const evidenceLabel = evidenceKind === 'pattern' ? '패턴' : '경로'
  if (variant !== 'default') return <section className="trace-transfer-panel" aria-labelledby="trace-transfers-title">
    <div className="panel-heading"><h3 id="trace-transfers-title">송금 목록</h3><span>{transfers.length}건</span></div>
    <div className="table-scroll" role="region" aria-label="송금 목록 표" tabIndex={0}>
      <table className={`transfers trace-transfers${onSelect ? '' : ' transfers-readonly'}`}>
        <thead><tr><th>송금 시간</th><th>보낸 주소</th><th>받는 주소</th><th className="num">금액 및 자산</th></tr></thead>
        <tbody>{transfers.map(transfer => {
          const selected = transfer.id === selectedTransferId
          const evidence = highlightedTransferIds?.has(transfer.id) === true
          const clock = formatTransferTime(transfer.timestamp)
          const time = <time id={`transfer-time-${transfer.id}`} dateTime={transfer.timestamp} title={formatTimestamp(transfer.timestamp)}>
            <span>{clock.date}</span><span>{clock.time}</span>
          </time>
          return <tr key={transfer.id} data-transfer-id={transfer.id} data-path-highlighted={evidence ? 'true' : undefined}
            className={[selected ? 'selected' : '', evidence ? 'path-highlighted' : ''].filter(Boolean).join(' ') || undefined}
            onClick={onSelect ? () => onSelect(transfer.id) : undefined}>
            <td className="transfer-time">
              {onSelect ? <button type="button" className="transfer-time-button" aria-pressed={selected} aria-label={`송금 ${transfer.id} 상세 보기`}
                aria-describedby={`transfer-time-${transfer.id}`} onClick={event => { event.stopPropagation(); onSelect(transfer.id) }}>
                {time}{selected && <span className="transfer-check" aria-hidden="true">✓</span>}
              </button> : time}
              {evidence && <span className="path-membership">{evidenceLabel} 포함</span>}
            </td>
            <td onClick={event => { if ((event.target as HTMLElement).closest('button, details')) event.stopPropagation() }}><AddressValue value={transfer.from} label="보낸 주소" /></td>
            <td onClick={event => { if ((event.target as HTMLElement).closest('button, details')) event.stopPropagation() }}><AddressValue value={transfer.to} label="받는 주소" /></td>
            <td className="num transfer-amount">{formatAmount(transfer)}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </section>
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

