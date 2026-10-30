import { formatTimestamp, formatUnits } from '../format'
import type { Token, Transfer } from '../types'
import CopyButton from './CopyButton'

type Props = {
  transfer: Transfer | null
  token: Token
}

// FIXTURE 데이터의 주소·거래 번호는 가짜라서 Explorer 링크를 만들지 않는다.
function TransferDetail({ transfer, token }: Props) {
  return (
    <aside className="detail" aria-labelledby="detail-title">
      <h2 id="detail-title">송금 상세</h2>

      {transfer === null ? (
        <p className="detail-empty">표에서 송금을 선택하면 상세 정보가 여기에 나옵니다.</p>
      ) : (
        <dl>
          <dt>보낸 주소</dt>
          <dd>
            <span className="mono full-value">{transfer.from}</span>
            <CopyButton value={transfer.from} label="보낸 주소" />
          </dd>

          <dt>받은 주소</dt>
          <dd>
            <span className="mono full-value">{transfer.to}</span>
            <CopyButton value={transfer.to} label="받은 주소" />
          </dd>

          <dt>금액</dt>
          <dd>
            {formatUnits(transfer.amount, token.decimals)} {token.symbol}
          </dd>

          <dt>블록 번호</dt>
          <dd>{transfer.blockNumber}</dd>

          <dt>블록 시각</dt>
          <dd>{formatTimestamp(transfer.blockTimestamp)}</dd>

          <dt>거래 번호</dt>
          <dd>
            <span className="mono full-value">{transfer.transactionHash}</span>
            <CopyButton value={transfer.transactionHash} label="거래 번호" />
          </dd>

          <dt>거래 안 위치 (transactionIndex)</dt>
          <dd>{transfer.transactionIndex}</dd>

          <dt>로그 위치 (logIndex)</dt>
          <dd>{transfer.logIndex}</dd>

          <dt>송금 id</dt>
          <dd className="mono">{transfer.id}</dd>
        </dl>
      )}
    </aside>
  )
}

export default TransferDetail
