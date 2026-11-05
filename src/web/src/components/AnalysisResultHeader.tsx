import AddressValue from './AddressValue'
import type { DatasetSessionState } from '../state/datasetSession'
import type { AnalysisRequest } from '../api/v1Types'
import { DIRECTION_LABELS } from '../searchConditions'
import { PATTERN_DIRECTION_LABELS } from '../patternConditions'
import { formatTimestamp } from '../format'

const MODES = { trace: '송금 추적(Trace)', paths: '경로 탐색(Path)', patterns: '패턴 분석(Pattern)' }
export default function AnalysisResultHeader({ state }: { state: DatasetSessionState }) {
  // Display the accepted response even when draft edits have invalidated its download.
  const envelope = state.mode === 'trace' ? (state.response?.ok ? state.response.envelope : null)
    : state.mode === 'paths' ? (state.pathResponse?.ok ? state.pathResponse.result : null)
    : (state.patternResponse?.ok ? state.patternResponse.envelope : null)
  if (!envelope) return <p className="applied-conditions">현재 분석 모드: {MODES[state.mode]}</p>
  const { data, meta } = envelope
  const conditions = meta.conditions as AnalysisRequest
  const limited = data.limits.truncated !== null || data.limits.foundIsLowerBound
  if (state.mode === 'trace' && state.response?.ok) {
    const coverage = state.response.result.coverage
    return <div className="trace-result-summary" aria-label="적용 조건 및 결과 요약">
    <p className="trace-summary-line"><strong>송금 {data.transfers.length}건</strong> · {DIRECTION_LABELS[conditions.direction!]} · 깊이 {conditions.maxDepth}단계
      <span className="status-badge">{limited ? '부분 결과' : '정상 응답'}</span>
      {meta.sourceMode === 'FIXTURE' && <span className="source-badge">합성 데이터(FIXTURE)</span>}
    </p>
    <div className="trace-summary-address">시작 주소: <AddressValue value={conditions.address} label="적용 주소" /></div>
    <details className="trace-coverage"><summary>적용 조건·관측 범위</summary>
      <p>적용 데이터셋: {meta.datasetId} / {meta.datasetVersion}</p>
      <p>적용 방향: {DIRECTION_LABELS[conditions.direction!]} · 최대 깊이: {conditions.maxDepth}단계</p>
      <p>관측 블록: {coverage.startBlock} ~ {coverage.endBlock}</p>
      <p>관측 시간: {formatTimestamp(coverage.startTime)} ~ {formatTimestamp(coverage.endTime)}</p>
      {conditions.filter && <p className="full-value">적용 필터: {Object.entries(conditions.filter).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>}
      {conditions.limits && <p className="full-value">요청 제한: {Object.entries(conditions.limits).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>}
    </details>
    {data.limits.foundIsLowerBound && !data.limits.truncated && <p className="notice notice-warning">발견된 송금 {data.limits.found}건 이상 (최소 발견 건수)</p>}
    {data.patterns.some(pattern => pattern.incomplete) && <p className="notice notice-warning">관측 범위가 불완전한 패턴 창이 포함되어 있습니다. 결과 잘림 여부와는 별개입니다.</p>}
  </div>
  }
  return <div className="trace-result-summary evidence-result-summary" aria-label="적용 조건 및 결과 요약">
    <p className="trace-summary-line"><strong>{state.mode === 'paths' ? `반환 경로 ${data.paths.length}개` : `반환 패턴 창 ${data.patterns.length}개`}</strong>
      <span>· 반환 송금 {data.transfers.length}건 · {state.mode === 'patterns' ? PATTERN_DIRECTION_LABELS[conditions.direction ?? 'all'] : DIRECTION_LABELS[conditions.direction!]}</span>
      {state.mode === 'paths' && <span>· 깊이 {conditions.maxDepth}단계</span>}
      <span className="status-badge">{limited ? '부분 결과' : '정상 응답'}</span>{meta.sourceMode === 'FIXTURE' && <span className="source-badge">합성 데이터(FIXTURE)</span>}
    </p>
    <div className="trace-summary-address">{state.mode === 'paths' ? '시작 주소:' : '기준 주소:'} <AddressValue value={conditions.address} label="적용 주소" />{state.mode === 'paths' && <> · 대상 주소: <AddressValue value={conditions.targetAddress!} label="대상 주소" /></>}</div>
    <details className="trace-coverage"><summary>적용 조건·관측 범위</summary>
      <p>적용 데이터셋: {meta.datasetId} / {meta.datasetVersion}</p>
      <p>적용 방향: {state.mode === 'patterns' ? PATTERN_DIRECTION_LABELS[conditions.direction ?? 'all'] : DIRECTION_LABELS[conditions.direction!]}{state.mode === 'paths' && <> · 최대 깊이: {conditions.maxDepth}단계</>}</p>
      {meta.coverage && <><p>관측 블록: {meta.coverage.startBlock} ~ {meta.coverage.endBlock}</p>
        <p>관측 시간: {formatTimestamp(meta.coverage.startTime)} ~ {formatTimestamp(meta.coverage.endTime)}</p></>}
      {conditions.filter && <p className="full-value">적용 필터: {Object.entries(conditions.filter).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>}
      {conditions.limits && <p className="full-value">요청 제한: {Object.entries(conditions.limits).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>}
    </details>
    {state.mode === 'paths' && <p>찾은 경로 {data.limits.found}개{data.limits.foundIsLowerBound ? ' 이상' : ''} 중 {data.paths.length}개 표시</p>}
    {state.mode === 'patterns' && <p>발견된 패턴 창 {data.limits.found}개{data.limits.foundIsLowerBound ? ' 이상 (최소 발견 건수)' : ''} · {data.patterns.length}개 표시</p>}
    {data.patterns.some(pattern => pattern.incomplete) && <p className="notice notice-warning">관측 범위가 불완전한 패턴 창이 포함되어 있습니다. 결과 잘림 여부와는 별개입니다.</p>}
  </div>
}
