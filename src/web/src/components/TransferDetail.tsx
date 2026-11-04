import { Fragment } from 'react'
import { formatTimestamp, formatAmount } from '../format'
import type { Transfer } from '../types'
import CopyButton from './CopyButton'

type Props = {
  transfer: Transfer | null
  variant?: 'default' | 'trace'
}

// 이름표·메모는 API가 값이 있을 때만 보낸다. 없는 칸은 줄째 숨긴다.
function annotations(transfer: Transfer): [string, string][] {
  const rows: [string, string | undefined][] = [
    ['송금 이름표', transfer.label], ['송금 메모', transfer.note],
    ['거래 이름표', transfer.txLabel], ['거래 메모', transfer.txNote],
    ['블록 이름표', transfer.blockLabel], ['블록 메모', transfer.blockNote],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]))
}

// FIXTURE 데이터의 주소·거래 번호는 가짜라서 Explorer 링크를 만들지 않는다.
function TransferDetail({ transfer, variant = 'default' }: Props) {
  const annotationRows = transfer && annotations(transfer).map(([name, value]) => <Fragment key={name}>
    <dt>{name}</dt><dd className="full-value">{value}</dd>
  </Fragment>)
  if (variant === 'trace') return <aside className="detail trace-detail" aria-labelledby="detail-title">
    <h2 id="detail-title" tabIndex={-1}>송금 상세</h2>
    {transfer === null ? <p className="detail-empty">표나 그래프에서 송금을 선택하면 상세 정보가 여기에 나옵니다.</p> : <>
      <p className="detail-amount"><span>송금 금액</span><strong>{formatAmount(transfer)}</strong></p>
      <dl className="transfer-basics">
        <dt>보낸 주소</dt><dd><span className="mono full-value">{transfer.from}</span><CopyButton value={transfer.from} label="보낸 주소" /></dd>
        <dt>받는 주소</dt><dd><span className="mono full-value">{transfer.to}</span><CopyButton value={transfer.to} label="받는 주소" /></dd>
        <dt>송금 시간</dt><dd><time dateTime={transfer.timestamp}>{formatTimestamp(transfer.timestamp)}</time></dd>
      </dl>
      {annotations(transfer).length > 0 && <section className="transfer-annotations" aria-label="송금·거래·블록 이름표 및 메모">
        <h3>이름표 및 메모</h3><dl>{annotationRows}</dl>
      </section>}
      <details key={transfer.id} className="technical-details transfer-technical"><summary>기술 상세</summary>
        <dl>{technicalFields(transfer, true)}</dl>
      </details>
    </>}
  </aside>
  return (
    <aside className="detail" aria-labelledby="detail-title">
      <h2 id="detail-title" tabIndex={-1}>송금 상세</h2>

      {transfer === null ? (
        <p className="detail-empty">표나 그래프에서 송금을 선택하면 상세 정보가 여기에 나옵니다.</p>
      ) : (
        <dl>
          {annotationRows}
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
            {formatAmount(transfer)}
          </dd>

          {technicalFields(transfer)}
        </dl>
      )}
    </aside>
  )
}

// Keep the existing evidence fields identical for every analysis mode.
function technicalFields(transfer: Transfer, trace = false) {
  return <>
          <dt>토큰 주소</dt>
          <dd>
            <span className="mono full-value">{transfer.asset.tokenAddress}</span>
            <CopyButton value={transfer.asset.tokenAddress} label="토큰 주소" />
          </dd>

          <dt>체인 ID (chainId)</dt>
          <dd>{transfer.asset.chainId}</dd>

          <dt>블록 번호</dt>
          <dd>{transfer.blockNumber}</dd>

          <dt>블록 해시 (blockHash)</dt>
          <dd>
            <span className="mono full-value">{transfer.blockHash}</span>
            <CopyButton value={transfer.blockHash} label="블록 해시" />
          </dd>

          {!trace && <><dt>블록 시각</dt><dd>{formatTimestamp(transfer.timestamp)}</dd></>}

          <dt>거래 번호</dt>
          <dd>
            <span className="mono full-value">{transfer.txHash}</span>
            <CopyButton value={transfer.txHash} label="거래 번호" />
          </dd>

          <dt>거래 안 위치 (transactionIndex)</dt>
          <dd>{transfer.transactionIndex}</dd>

          <dt>로그 위치 (logIndex)</dt>
          <dd>{transfer.logIndex}</dd>

          <dt>송금 id</dt>
          <dd className="mono full-value">{transfer.id}{trace && <CopyButton value={transfer.id} label="송금 ID" />}</dd>
          {trace && <><dt>최소 단위 금액 (amountRaw)</dt><dd className="mono full-value">{transfer.amountRaw}</dd>
            <dt>자산 소수 자릿수 (decimals)</dt><dd>{transfer.asset.decimals}</dd></>}
  </>
}

export default TransferDetail

