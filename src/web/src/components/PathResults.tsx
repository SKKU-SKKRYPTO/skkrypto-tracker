import type { PathsResult } from '../adapters/pathsAdapter'
import { formatAmount, formatTimestamp } from '../format'
import { formatLimitReason } from '../limitReasons'
import { formatConditions } from '../searchConditions'
import { useMemo } from 'react'
import { resolvePathSelection, uniqueTransfers } from '../pathSelection'
import TransferGraph from './TransferGraph'
import TransferTable from './TransferTable'
import TransferDetail from './TransferDetail'

type Props = {
  result: PathsResult; selectedPathId?: string | null; onSelectPath?: (id: string | null) => void
  selectedTransferId?: string | null; onSelectTransfer?: (id: string) => void
}
export default function PathResults({ result, selectedPathId = null, onSelectPath, selectedTransferId = null, onSelectTransfer }: Props) {
  const { data, meta } = result
  const { limits, paths } = data
  // Keep graph input stable while only the chosen path changes; do not rebuild the canvas.
  const graph = useMemo(() => ({ nodes: data.nodes, transfers: uniqueTransfers(data.transfers), conditions: meta.conditions,
    layoutRoot: meta.conditions.direction === 'incoming' ? meta.conditions.targetAddress : meta.conditions.address }), [data, meta.conditions])
  const selection = resolvePathSelection(paths, graph.transfers, selectedPathId)
  const transfers = new Map(graph.transfers.map(transfer => [transfer.id, transfer]))
  // Never display stale or unresolved IDs, even when the component is used independently.
  const selectedTransfer = selectedTransferId === null ? null : transfers.get(selectedTransferId) ?? null
  const resolvedTransferId = selectedTransfer?.id ?? null
  return <section aria-label="경로 검색 결과">
    {meta.sourceMode === 'FIXTURE' && <p className="fixture-badge">합성 데이터(FIXTURE)</p>}
    <p className="notice">경로는 시간순 송금의 후보 연결이며, 동일 자금의 이동이나 소유 관계를 확정하지 않습니다.</p>
    <p className="applied-conditions">적용 데이터셋: {meta.datasetId} / {meta.datasetVersion} · {formatConditions({ direction: meta.conditions.direction, maxDepth: meta.conditions.maxDepth as 1 | 2 | 3 })}</p>
    <p className="notice mono full-value">검색 시작 주소: {meta.conditions.address} · 대상 주소: {meta.conditions.targetAddress}</p>
    {meta.conditions.direction === 'incoming' && <p className="notice">받은 쪽 탐색: 아래 연결은 대상 주소에서 검색 시작 주소로 이어지는 실제 송금 순서입니다.</p>}
    <p className="notice" role="status">찾은 경로 {limits.found}개{limits.foundIsLowerBound ? ' 이상' : ''} 중 {paths.length}개 표시</p>
    {onSelectPath && paths.length > 0 && <p className="notice" role="status">
      {selection.path ? `경로 ${paths.indexOf(selection.path) + 1} 선택됨 · 근거 송금 ${selection.transferIds.size}건을 그래프와 표에 강조합니다.` : '경로를 선택하면 해당 근거 송금을 그래프와 표에 함께 강조합니다.'}
      {selection.path && <button type="button" className="select-button" onClick={() => onSelectPath(null)}>경로 선택 해제</button>}
    </p>}
    {limits.truncated && <p className="notice notice-warning" role="status">
      제한으로 일부 경로만 반환되었으며, 전체 결과가 아닐 수 있습니다. {limits.truncated.reasons.map(formatLimitReason).join(' ')} · 대표 사유: {formatLimitReason(limits.truncated.reason)}
      {limits.analyzedUntil && <> · 블록 {limits.analyzedUntil.blockNumber}까지만 분석 ({formatTimestamp(limits.analyzedUntil.timestamp)})</>}
    </p>}
    {paths.length === 0
      ? <p className="notice" role="status">{limits.truncated ? '분석한 범위에서 표시할 경로를 찾지 못했습니다. 제한 때문에 전체 범위에 경로가 없다고 단정할 수 없습니다.' : '선택한 조건과 수집 범위에서 후보 경로가 관측되지 않았습니다.'}</p>
      : <ol className="path-list">{paths.map((path, index) => {
        const evidence = path.transferIds.map(id => transfers.get(id))
        // The Adapter checks references. Keep a defensive fallback for independently supplied UI data.
        if (evidence.length === 0 || evidence.some(transfer => !transfer)) return <li key={path.id}><p className="notice notice-error">경로 {index + 1}의 근거 송금 정보를 확인할 수 없습니다.</p></li>
        return <li key={path.id} className={`notice${selection.path === path ? ' path-selected' : ''}`}>
          <h2>경로 {index + 1} · {path.hops}단계</h2>
          {onSelectPath && <button type="button" className="select-button" aria-pressed={selection.path === path}
            aria-label={`경로 ${index + 1} 선택`} onClick={() => onSelectPath(path.id)}>{selection.path === path ? '✓ 경로 선택됨' : '경로 선택'}</button>}
          <p className="mono full-value">{[evidence[0]!.from, ...evidence.map(transfer => transfer!.to)].join(' → ')}</p>
          <p className="mono full-value">경로 ID: {path.id}</p>
          <details><summary>근거 송금 {path.transferIds.length}건</summary>
            <ol>{evidence.map(transfer => <li key={transfer!.id}>
              <p className="mono full-value">{transfer!.from} → {transfer!.to}</p>
              <p>{formatAmount(transfer!)} · 블록 {transfer!.blockNumber} · {formatTimestamp(transfer!.timestamp)}</p>
              <p className="mono full-value">송금 ID: {transfer!.id}</p>
              {onSelectTransfer && <button type="button" className="select-button" aria-label={`경로 ${index + 1} 근거 송금 ${transfer!.id} 상세 보기`}
                aria-pressed={resolvedTransferId === transfer!.id} onClick={() => onSelectTransfer(transfer!.id)}>
                {resolvedTransferId === transfer!.id ? '✓ 선택됨' : '송금 상세 보기'}
              </button>}
            </li>)}</ol>
          </details>
        </li>
      })}</ol>}
    {graph.transfers.length > 0 && <div className={`layout path-evidence${onSelectTransfer ? ' path-with-detail' : ''}`}>
      <TransferTable transfers={graph.transfers} selectedTransferId={resolvedTransferId} highlightedTransferIds={selection.transferIds} onSelect={onSelectTransfer} />
      <TransferGraph result={graph} selectedTransferId={resolvedTransferId} highlightedTransferIds={selection.transferIds} onSelect={onSelectTransfer} />
      {onSelectTransfer && <TransferDetail transfer={selectedTransfer} />}
    </div>}
    <ul className="notice">{meta.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
  </section>
}
