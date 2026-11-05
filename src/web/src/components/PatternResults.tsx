import AddressValue from './AddressValue'
import CopyButton from './CopyButton'
import { useMemo } from 'react'
import type { PatternEnvelope, PatternRequest } from '../api/patterns'
import { formatAmount, formatTimestamp, formatPatternWindow } from '../format'
import { formatLimitReason } from '../limitReasons'
import { PATTERN_DIRECTION_LABELS } from '../patternConditions'
import { resolvePatternSelection } from '../patternSelection'
import { uniqueTransfers } from '../pathSelection'
import TransferGraph from './TransferGraph'
import TransferTable from './TransferTable'
import TransferDetail from './TransferDetail'
import { revealResultCard } from './resultCardScroll'

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
    {limits.truncated && <p className="notice notice-warning" role="status">
      분석 제한으로 일부 결과만 반환되었으며, 전체 결과가 아닐 수 있습니다. {limits.truncated.reasons.map(formatLimitReason).join(' ')} · 대표 사유: {formatLimitReason(limits.truncated.reason)}
      {limits.analyzedUntil && <> · 블록 {limits.analyzedUntil.blockNumber}까지만 분석 ({formatTimestamp(limits.analyzedUntil.timestamp)})</>}
    </p>}
    <div className={graph.transfers.length > 0 ? 'analysis-workspace evidence-workspace' : 'analysis-workspace workspace-empty'}>
      <div className="result-list" role="region" aria-label="패턴 선택 목록" tabIndex={0}>
        <div className="panel-heading"><h3>탐지 패턴</h3><span>{patterns.length}개</span></div>
    {patterns.length === 0
      ? <p className="notice" role="status">{limits.truncated || limits.foundIsLowerBound ? '분석한 범위에서 패턴이 관측되지 않았습니다. 전체 범위에 패턴이 없다고 단정할 수 없습니다.' : '선택한 조건과 수집 범위에서 패턴이 관측되지 않았습니다.'}</p>
      : <ol className="pattern-list">{patterns.map((pattern, index) => {
        const windowLabel = formatPatternWindow(pattern.windowStart, pattern.windowEnd)
        return <li key={pattern.patternId} className={`notice${selection.pattern === pattern ? ' pattern-selected' : ''}`}>
        <h4>패턴 {index + 1} · {PATTERN_DIRECTION_LABELS[pattern.direction]}</h4>
        <p className="card-window"><span>탐지 시간: <time dateTime={pattern.windowStart} title={formatTimestamp(pattern.windowStart)}>{windowLabel.start}</time> ~ <time dateTime={pattern.windowEnd} title={formatTimestamp(pattern.windowEnd)}>{windowLabel.end}</time></span><span className="window-duration">{pattern.windowSeconds}초 창</span></p>
        <p className="card-metrics">고유 상대 주소 {pattern.uniqueCounterparties}개 · 근거 송금 {pattern.evidenceIds.length}건</p>
        {onSelectPattern && <button type="button" className="select-button" aria-label={`패턴 ${index + 1} 선택`} aria-pressed={selection.pattern === pattern} onFocus={event => revealResultCard(event.currentTarget)}
          disabled={!resolvePatternSelection(patterns, graph.transfers, pattern.patternId).pattern} onClick={() => onSelectPattern(pattern.patternId)}>{selection.pattern === pattern ? '✓ 패턴 선택됨' : '패턴 선택'}</button>}
        {pattern.incomplete
          ? <p className="notice notice-warning">관측 범위 불완전 · 관측 범위가 불완전하여 이 창의 전후 거래를 모두 확인할 수 없습니다. 분석 제한(truncated)과는 별개입니다.</p>
          : null}
        <details><summary>기준·상대 주소 {pattern.counterparties.length}개</summary>
        <div>기준 주소: <AddressValue value={pattern.address} label="기준 주소" /></div>

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
          <p className="mono full-value">시간(원본): {pattern.windowStart} ~ {pattern.windowEnd}</p>
          <p>탐지 시간(현지): {formatTimestamp(pattern.windowStart)} ~ {formatTimestamp(pattern.windowEnd)}</p>
          {!pattern.incomplete && <p>관측 범위 내 분석 창</p>}
          <p>분석 창: {pattern.windowSeconds}초 · 시작 포함, 종료 제외 · 판정 기준: 고유 상대 {pattern.threshold}개 이상</p>
        </details>
      </li>})}</ol>}
      </div>
    {graph.transfers.length > 0 && <>
      <TransferGraph result={graph} selectedTransferId={resolvedTransferId} highlightedTransferIds={selection.transferIds} evidenceKind="pattern" onSelect={onSelectTransfer} controls
        selectionLabel={selection.pattern ? `패턴 ${patterns.indexOf(selection.pattern) + 1}` : null} onClearSelection={onSelectPattern ? () => onSelectPattern(null) : undefined} />
      <TransferTable transfers={graph.transfers} selectedTransferId={resolvedTransferId} highlightedTransferIds={selection.transferIds} evidenceKind="pattern" onSelect={onSelectTransfer} variant="analysis" />
      {onSelectTransfer && <TransferDetail transfer={selectedTransfer} variant="analysis" />}
    </>}
    </div>
    <ul className="notice">{meta.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
  </section>
}
