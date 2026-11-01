import { useEffect, useState, useSyncExternalStore } from 'react'
import { createDatasetSession, canSearch } from './state/datasetSession'
import type { DatasetSession } from './state/datasetSession'
import DatasetSelector from './components/DatasetSelector'
import SearchBar from './components/SearchBar'
import TraceView from './components/TraceView'
import RequestNotice from './components/RequestNotice'
import { formatConditions } from './searchConditions'
import './App.css'

export default function LiveApp({ session: provided }: { session?: DatasetSession } = {}) {
  const [session] = useState(() => provided ?? createDatasetSession())
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => {
    void session.loadDatasets()
    return session.cancelPending
  }, [session])
  return <main className="app">
    <h1>송금 목록</h1>
    <DatasetSelector state={state} onSelect={key => { void session.selectDataset(key) }} onReload={() => { void session.loadDatasets() }}
      onRetryDetail={() => { if (state.selection) void session.selectDataset(state.selection) }} />
    <SearchBar isSearching={state.isSearching} disabled={!canSearch(state)} conditions={state.conditions}
      onConditionsChange={session.setConditions} onSearch={address => { void session.search(address) }} />
    {state.isSearching && <p className="notice" role="status">검색 중…</p>}
    {state.response === null && !state.isSearching && <p className="notice">{canSearch(state) ? '주소를 입력하고 검색하면 송금 목록이 나옵니다.' : 'READY 데이터셋의 상세 정보를 확인한 뒤 검색할 수 있습니다.'}</p>}
    {state.response && !state.response.ok && <RequestNotice failure={state.response} />}
    {state.response?.ok && <>
      {state.response.result.sourceMode === 'FIXTURE' && <p className="fixture-badge">합성 데이터(FIXTURE)</p>}
      <p className="applied-conditions">적용 데이터셋: {state.response.result.conditions.datasetId} / {state.response.result.conditions.datasetVersion} · 조건: {formatConditions(state.response.result.conditions)}</p>
      <TraceView result={state.response.result} selectedTransferId={state.selectedTransferId} onSelect={session.selectTransfer} />
    </>}
  </main>
}
