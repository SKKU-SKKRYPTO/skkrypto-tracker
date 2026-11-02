import type { PatternEnvelope, PatternRequest } from '../api/patterns'
import { formatTimestamp } from '../format'
import { formatLimitReason } from '../limitReasons'
import { PATTERN_DIRECTION_LABELS } from '../patternConditions'

export default function PatternResults({ envelope }: { envelope: PatternEnvelope }) {
  const { data, meta } = envelope
  const { patterns, limits } = data
  const conditions = meta.conditions as PatternRequest
  return <section aria-label="패턴 검색 결과">
    {meta.sourceMode === 'FIXTURE' && <p className="fixture-badge">합성 데이터(FIXTURE)</p>}
    <p className="notice">패턴은 규칙에 맞는 구조적인 송금 형태입니다. 불법 거래, 동일 소유자 또는 동일 자금의 이동을 증명하지 않습니다.</p>
    <p className="applied-conditions">적용 데이터셋: {meta.datasetId} / {meta.datasetVersion} · 방향: {PATTERN_DIRECTION_LABELS[conditions.direction ?? 'all']}</p>
    <p className="notice mono full-value">분석 기준 주소: {conditions.address}</p>
    <p className="notice" role="status">발견된 패턴 창 {limits.found}개{limits.foundIsLowerBound ? ' 이상 (최소 발견 건수)' : ''} · {patterns.length}개 표시</p>
    {limits.truncated && <p className="notice notice-warning" role="status">
      분석 제한으로 일부 결과만 반환되었으며, 전체 결과가 아닐 수 있습니다. {limits.truncated.reasons.map(formatLimitReason).join(' ')} · 대표 사유: {formatLimitReason(limits.truncated.reason)}
      {limits.analyzedUntil && <> · 블록 {limits.analyzedUntil.blockNumber}까지만 분석 ({formatTimestamp(limits.analyzedUntil.timestamp)})</>}
    </p>}
    {patterns.length === 0
      ? <p className="notice" role="status">{limits.truncated || limits.foundIsLowerBound ? '분석한 범위에서 패턴이 관측되지 않았습니다. 전체 범위에 패턴이 없다고 단정할 수 없습니다.' : '선택한 조건과 수집 범위에서 패턴이 관측되지 않았습니다.'}</p>
      : <ol className="pattern-list">{patterns.map((pattern, index) => <li key={pattern.patternId} className="notice">
        <h2>패턴 {index + 1} · {PATTERN_DIRECTION_LABELS[pattern.direction]}</h2>
        <p className="mono full-value">기준 주소: {pattern.address}</p>
        <p>탐지 시간 구간: <time dateTime={pattern.windowStart}>{formatTimestamp(pattern.windowStart)}</time> 이상 ~ <time dateTime={pattern.windowEnd}>{formatTimestamp(pattern.windowEnd)}</time> 미만</p>
        <p>분석 창: {pattern.windowSeconds}초 · 시작 포함, 종료 제외</p>
        <p>고유 상대 주소 {pattern.uniqueCounterparties}개 · 판정 기준 {pattern.threshold}개 이상 · 근거 송금 {pattern.evidenceIds.length}건</p>
        <details><summary>상대 주소 {pattern.counterparties.length}개</summary>
          <ul>{pattern.counterparties.map(address => <li key={address} className="mono full-value">{address}</li>)}</ul>
        </details>
        <p className="mono full-value">groupId: {pattern.groupId}</p>
        <p className="mono full-value">패턴 ID: {pattern.patternId} · 규칙: {pattern.ruleId} / {pattern.ruleVersion}</p>
        {pattern.incomplete
          ? <p className="notice notice-warning">incomplete: 예 · 관측 범위가 불완전하여 이 창의 전후 거래를 모두 확인할 수 없습니다. 분석 제한(truncated)과는 별개입니다.</p>
          : <p>incomplete: 아니요 · 관측 범위 안의 분석 창입니다.</p>}
      </li>)}</ol>}
    <ul className="notice">{meta.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
  </section>
}
