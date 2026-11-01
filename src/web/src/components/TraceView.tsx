import TransferTable from './TransferTable'
import TransferGraph from './TransferGraph'
import TransferDetail from './TransferDetail'
import type { TraceResult } from '../types'
import { formatTimestamp } from '../format'
import { formatLimitReason } from '../limitReasons'

type TraceViewProps = { result: TraceResult; selectedTransferId: string | null; onSelect: (id: string) => void }
export default function TraceView({ result, selectedTransferId, onSelect }: TraceViewProps) {
  const { coverage, transfers, limits } = result
  const selectedTransfer = transfers.find(transfer => transfer.id === selectedTransferId) ?? null
  return (
    <>
      {limits.truncated !== null && (
        <p className="notice notice-warning" role="status">
          결과가 상한에 걸려 일부만 표시됨 · {limits.truncated.reasons.map(formatLimitReason).join(' ')} · 대표 사유: {formatLimitReason(limits.truncated.reason)} · 찾은 송금 {limits.found}건{limits.foundIsLowerBound ? ' 이상' : ''} 중 {transfers.length}건 표시
          {limits.analyzedUntil && <> · 블록 {limits.analyzedUntil.blockNumber}까지만 분석 ({formatTimestamp(limits.analyzedUntil.timestamp)})</>}
        </p>
      )}
      {transfers.length === 0 ? (
        <p className="notice" role="status">선택한 수집 범위에서 관측되지 않음 (블록 {coverage.startBlock}~{coverage.endBlock})</p>
      ) : (
        <div className="layout">
          <TransferTable transfers={transfers} selectedTransferId={selectedTransferId} onSelect={onSelect} />
          <TransferGraph result={result} selectedTransferId={selectedTransferId} onSelect={onSelect} />
          <TransferDetail transfer={selectedTransfer} />
        </div>
      )}
      <ul className="notice">{result.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </>
  )
}
