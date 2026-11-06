import type { DatasetSessionState } from '../state/datasetSession'
import { datasetKeyValue } from '../state/datasetSession'
import type { DatasetKey } from '../api/datasets'
import { formatTimestamp } from '../format'
import RequestNotice from './RequestNotice'

type Props = { state: DatasetSessionState; onSelect: (key: DatasetKey) => void; onReload: () => void; onRetryDetail: () => void }
export default function DatasetSelector({ state, onSelect, onReload, onRetryDetail }: Props) {
  const dataset = state.detail?.data
  // Only suppress exact duplicates that are currently visible in this mode's results.
  // Keep dataset-only restrictions and restore all notices before search/on failure.
  const resultMeta = state.mode === 'trace' ? (state.response?.ok ? state.response.envelope.meta : null)
    : state.mode === 'paths' ? (state.pathResponse?.ok ? state.pathResponse.result.meta : null)
    : (state.patternResponse?.ok ? state.patternResponse.envelope.meta : null)
  const shownInResults = dataset && resultMeta?.datasetId === dataset.datasetId && resultMeta.datasetVersion === dataset.datasetVersion
    ? resultMeta.limitations : []
  const limitations = [...new Set(state.detail?.meta.limitations ?? [])].filter(text => !shownInResults.includes(text))
  return <section className="dataset-panel" aria-label="데이터셋 선택 및 정보">
    <div className="search-bar">
      <label htmlFor="dataset-select">데이터셋</label>
      <select id="dataset-select" disabled={state.listStatus === 'loading' || state.datasets.length === 0}
        value={state.selection ? datasetKeyValue(state.selection) : ''}
        onChange={event => {
          const selected = state.datasets.find(row => datasetKeyValue(row) === event.target.value)
          if (selected) onSelect({ datasetId: selected.datasetId, datasetVersion: selected.datasetVersion })
        }}>
        {state.datasets.length === 0 && <option value="">선택 가능한 데이터셋 없음</option>}
        {state.datasets.map(row => <option key={datasetKeyValue(row)} value={datasetKeyValue(row)}>{row.datasetId} / {row.datasetVersion}{state.detailStatus === 'ready' && dataset && datasetKeyValue(row) === datasetKeyValue(dataset) ? '' : ` · ${row.status}`}</option>)}
      </select>
      <button className="button-secondary" type="button" disabled={state.listStatus === 'loading'} onClick={onReload}>목록 다시 조회</button>
    </div>
    {state.listStatus === 'loading' && <p className="notice" role="status">데이터셋 목록을 불러오는 중…</p>}
    {state.listStatus === 'ready' && state.datasets.length === 0 && <p className="notice" role="status">선택 가능한 데이터셋이 없습니다.</p>}
    {state.listError && <RequestNotice failure={state.listError} />}
    {state.detailStatus === 'loading' && <p className="notice" role="status">데이터셋 상세 정보를 불러오는 중…</p>}
    {state.detailError && <RequestNotice failure={state.detailError} />}
    {state.selection && (state.detailStatus === 'error' || state.detailStatus === 'idle') && <div className="notice">
      데이터셋 정보를 다시 조회해 주세요. <button type="button" onClick={onRetryDetail}>상세 다시 조회</button>
    </div>}
    {dataset && <div className="notice dataset-summary">
      <p className="dataset-identity">
        <span className="status-badge" data-status={dataset.status}>{dataset.status}</span>
        <span className="source-badge">{dataset.sourceMode === 'FIXTURE' ? '합성 데이터(FIXTURE)' : '수집 데이터(SNAPSHOT)'}</span></p>
      <p className="dataset-asset">분석 자산: {dataset.asset.symbol}</p>
      {dataset.invalidationReason && <p className="notice notice-warning">{dataset.invalidationReason}</p>}
      {dataset.status !== 'READY' && <p role="status">현재 상태가 {dataset.status}이므로 검색할 수 없습니다.</p>}
      <details className="dataset-details"><summary>데이터셋 상세 정보</summary>
      <p><strong>{dataset.datasetId} / {dataset.datasetVersion}</strong></p>
      <p>소수 자릿수 {dataset.asset.decimals} · Chain ID {dataset.asset.chainId}</p>
      <p className="mono full-value">토큰 주소: {dataset.asset.tokenAddress}</p>
      <p>수집 블록: {dataset.startBlock}~{dataset.endBlock}</p>
      <p>수집 시간: {formatTimestamp(dataset.startTime)} ~ {formatTimestamp(dataset.endTime)}</p>
      <p>확정 블록: {dataset.finalizedBlock ?? '해당 없음'} · 수집 완료: {dataset.collectedAt === null ? '미확인' : formatTimestamp(dataset.collectedAt)}</p>
      {dataset.notes.length > 0 && <ul className="dataset-notes">{dataset.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      {limitations.length > 0 && <ul className="dataset-limitations">{limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}
      </details>
    </div>}
  </section>
}
