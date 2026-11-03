import WorkspaceSelection from './WorkspaceSelection'
import AddressValue from './AddressValue'
import CopyButton from './CopyButton'
import { useMemo } from 'react'
import type { PatternEnvelope, PatternRequest } from '../api/patterns'
import { formatAmount, formatTimestamp } from '../format'
import { formatLimitReason } from '../limitReasons'
import { PATTERN_DIRECTION_LABELS } from '../patternConditions'
import { resolvePatternSelection } from '../patternSelection'
import { uniqueTransfers } from '../pathSelection'
import TransferGraph from './TransferGraph'
import TransferTable from './TransferTable'
import TransferDetail from './TransferDetail'

type Props = {
  showContext?: boolean
  envelope: PatternEnvelope; selectedPatternId?: string | null; onSelectPattern?: (id: string | null) => void
  selectedTransferId?: string | null; onSelectTransfer?: (id: string) => void
}
export default function PatternResults({ envelope, selectedPatternId = null, onSelectPattern, selectedTransferId = null, onSelectTransfer, showContext = true }: Props) {
  const { data, meta } = envelope
  const { patterns, limits } = data
  const conditions = meta.conditions as PatternRequest
  const graph = useMemo(() => ({ nodes: data.nodes, transfers: uniqueTransfers(data.transfers), conditions, startLabel: '기준' as const }), [data, conditions])
  const selection = resolvePatternSelection(patterns, graph.transfers, selectedPatternId)
  const transfers = new Map(graph.transfers.map(transfer => [transfer.id, transfer]))
  const selectedTransfer = selectedTransferId === null ? null : transfers.get(selectedTransferId) ?? null
  const resolvedTransferId = selectedTransfer?.id ?? null
  return <section aria-label="패턴 검색 결과">
    {showContext && meta.sourceMode === 'FIXTURE' && <p className="fixture-badge">합성 데이터(FIXTURE)</p>}
    <p className="notice">패턴은 규칙에 맞는 구조적인 송금 형태입니다. 불법 거래, 동일 소유자 또는 동일 자금의 이동을 증명하지 않습니다.</p>
    {showContext && <p className="applied-conditions">적용 데이터셋: {meta.datasetId} / {meta.datasetVersion} · 방향: {PATTERN_DIRECTION_LABELS[conditions.direction ?? 'all']}</p>}
    {showContext && <p className="notice mono full-value">분석 기준 주소: {conditions.address}</p>}
    {showContext && <p className="notice" role="status">발견된 패턴 창 {limits.found}개{limits.foundIsLowerBound ? ' 이상 (최소 발견 건수)' : ''} · {patterns.length}개 표시</p>}
    {onSelectPattern && patterns.length > 0 && <p className="notice" role="status">
      {selection.pattern ? `패턴 ${patterns.indexOf(selection.pattern) + 1} 선택됨 · 근거 송금 ${selection.transferIds.size}건을 그래프와 표에 강조합니다.` : '패턴을 선택하면 해당 근거 송금을 그래프와 표에 함께 강조합니다.'}
      {selection.pattern && <button type="button" className="select-button" onClick={() => onSelectPattern(null)}>패턴 선택 해제</button>}
    </p>}
    {limits.truncated && <p className="notice notice-warning" role="status">
      분석 제한으로 일부 결과만 반환되었으며, 전체 결과가 아닐 수 있습니다. {limits.truncated.reasons.map(formatLimitReason).join(' ')} · 대표 사유: {formatLimitReason(limits.truncated.reason)}
      {limits.analyzedUntil && <> · 블록 {limits.analyzedUntil.blockNumber}까지만 분석 ({formatTimestamp(limits.analyzedUntil.timestamp)})</>}
    </p>}
    <WorkspaceSelection group={selection.pattern ? "패턴 " + (patterns.indexOf(selection.pattern) + 1) : null} transfer={selectedTransfer} />
    <div className={graph.transfers.length > 0 ? 'analysis-workspace' : 'analysis-workspace workspace-empty'}>
      <div className="result-list" role="region" aria-label="패턴 선택 목록">
    {patterns.length === 0
      ? <p className="notice" role="status">{limits.truncated || limits.foundIsLowerBound ? '분석한 범위에서 패턴이 관측되지 않았습니다. 전체 범위에 패턴이 없다고 단정할 수 없습니다.' : '선택한 조건과 수집 범위에서 패턴이 관측되지 않았습니다.'}</p>
      : <ol className="pattern-list">{patterns.map((pattern, index) => <li key={pattern.patternId} className={`notice${selection.pattern === pattern ? ' pattern-selected' : ''}`}>
        <h2>패턴 {index + 1} · {PATTERN_DIRECTION_LABELS[pattern.direction]}</h2>
        {onSelectPattern && <button type="button" className="select-button" aria-label={`패턴 ${index + 1} 선택`} aria-pressed={selection.pattern === pattern}
          disabled={!resolvePatternSelection(patterns, graph.transfers, pattern.patternId).pattern} onClick={() => onSelectPattern(pattern.patternId)}>{selection.pattern === pattern ? '✓ 패턴 선택됨' : '패턴 선택'}</button>}
        <div>기준 주소: <AddressValue value={pattern.address} label="기준 주소" /></div>
        <p>탐지 시간 구간: <time dateTime={pattern.windowStart}>{formatTimestamp(pattern.windowStart)}</time> 이상 ~ <time dateTime={pattern.windowEnd}>{formatTimestamp(pattern.windowEnd)}</time> 미만</p>
        <p>분석 창: {pattern.windowSeconds}초 · 시작 포함, 종료 제외</p>
        <p>고유 상대 주소 {pattern.uniqueCounterparties}개 · 판정 기준 {pattern.threshold}개 이상 · 근거 송금 {pattern.evidenceIds.length}건</p>
        <details><summary>상대 주소 {pattern.counterparties.length}개</summary>
          <ul>{pattern.counterparties.map(address => <li key={address}><AddressValue value={address} label="상대 주소" /></li>)}</ul>
        </details>
        <details><summary>근거 송금 {new Set(pattern.evidenceIds).size}건</summary>
          <ol>{[...new Set(pattern.evidenceIds)].map(id => {
            const transfer = transfers.get(id)
            if (!transfer) return <li key={id}><p className="notice notice-error">근거 송금 정보를 확인할 수 없습니다. <span className="mono full-value">{id}</span></p></li>
            return <li key={id}>
              <div className="evidence-addresses"><AddressValue value={transfer.from} label="보낸 주소" /> → <AddressValue value={transfer.to} label="받은 주소" /></div>
              <p>{formatAmount(transfer)} · 블록 {transfer.blockNumber} · {formatTimestamp(transfer.timestamp)}</p>
              <p className="mono full-value">송금 ID: {transfer.id}</p>
              {onSelectTransfer && <button type="button" className="select-button" aria-label={`패턴 ${index + 1} 근거 송금 ${id} 상세 보기`}
                aria-pressed={resolvedTransferId === id} onClick={() => onSelectTransfer(id)}>{resolvedTransferId === id ? '✓ 선택됨' : '송금 상세 보기'}</button>}
            </li>
          })}</ol>
        </details>
        <details className="technical-details"><summary>기술 상세 · 패턴 {index + 1}</summary>
          <p className="mono full-value">패턴 ID: {pattern.patternId} <CopyButton value={pattern.patternId} label="패턴 ID" /></p>
          <p className="mono full-value">groupId: {pattern.groupId} <CopyButton value={pattern.groupId} label="groupId" /></p>
          <p>규칙: {pattern.ruleId} / {pattern.ruleVersion}</p>
        </details>
        {pattern.incomplete
          ? <p className="notice notice-warning">incomplete: 예 · 관측 범위가 불완전하여 이 창의 전후 거래를 모두 확인할 수 없습니다. 분석 제한(truncated)과는 별개입니다.</p>
          : <p>incomplete: 아니요 · 관측 범위 안의 분석 창입니다.</p>}
      </li>)}</ol>}
      </div>
    {graph.transfers.length > 0 && <>
      <TransferGraph result={graph} selectedTransferId={resolvedTransferId} highlightedTransferIds={selection.transferIds} evidenceKind="pattern" onSelect={onSelectTransfer} />
      <TransferTable transfers={graph.transfers} selectedTransferId={resolvedTransferId} highlightedTransferIds={selection.transferIds} evidenceKind="pattern" onSelect={onSelectTransfer} />
      {onSelectTransfer && <TransferDetail transfer={selectedTransfer} />}
    </>}
    </div>
    <ul className="notice">{meta.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
  </section>
}
