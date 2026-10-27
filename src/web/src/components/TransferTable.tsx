import { formatUnits, shortenHex } from '../format'
import type { Token, Transfer } from '../types'

type Props = {
  transfers: Transfer[]
  token: Token
  selectedTransferId: string | null
  onSelect: (transferId: string) => void
}

function TransferTable({ transfers, token, selectedTransferId, onSelect }: Props) {
  return (
    <div className="table-scroll">
      <table className="transfers">
        <thead>
          <tr>
            <th>선택</th>
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
            return (
              <tr
                key={transfer.id}
                className={isSelected ? 'selected' : undefined}
                onClick={() => onSelect(transfer.id)}
              >
                <td>
                  {/* 키보드 사용자는 Tab으로 이 버튼에 와서 Enter나 Space로 선택한다 */}
                  <button
                    type="button"
                    className="select-button"
                    aria-pressed={isSelected}
                    aria-label={`송금 ${transfer.id} 상세 보기`}
                    onClick={() => onSelect(transfer.id)}
                  >
                    {isSelected ? '✓ 선택됨' : '보기'}
                  </button>
                </td>
                <td className="mono" title={transfer.from}>
                  {shortenHex(transfer.from)}
                </td>
                <td className="mono" title={transfer.to}>
                  {shortenHex(transfer.to)}
                </td>
                <td className="num">
                  {formatUnits(transfer.amount, token.decimals)} {token.symbol}
                </td>
                <td className="num">{transfer.blockNumber}</td>
                <td className="mono" title={transfer.transactionHash}>
                  {shortenHex(transfer.transactionHash)}
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
