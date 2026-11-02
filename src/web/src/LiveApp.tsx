import PatternSearchBar from './components/PatternSearchBar'
import PatternResults from './components/PatternResults'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createDatasetSession, canSearch } from './state/datasetSession'
import type { DatasetSession } from './state/datasetSession'
import DatasetSelector from './components/DatasetSelector'
import SearchBar from './components/SearchBar'
import TraceView from './components/TraceView'
import RequestNotice from './components/RequestNotice'
import PathSearchBar from './components/PathSearchBar'
import PathResults from './components/PathResults'
import type { AnalysisMode } from './state/datasetSession'
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
    <div className="search-bar">
      <label htmlFor="analysis-mode">분석 종류</label>
      <select id="analysis-mode" value={state.mode} onChange={event => session.setMode(event.target.value as AnalysisMode)}>
        <option value="trace">추적(Trace)</option><option value="paths">경로(Path)</option><option value="patterns">패턴(Pattern)</option>
      </select>
    </div>
    {state.mode === 'trace' ? <SearchBar isSearching={state.isSearching} disabled={!canSearch(state)} conditions={state.conditions}
      onConditionsChange={session.setConditions} onSearch={address => { void session.search(address) }} />
      : state.mode === 'paths' ? <PathSearchBar conditions={state.pathConditions} disabled={!canSearch(state)} isSearching={state.isSearching}
        onChange={session.setPathConditions} onSearch={() => { void session.searchPaths() }} onCancel={session.cancelSearch} />
      : <PatternSearchBar conditions={state.patternConditions} disabled={!canSearch(state)} isSearching={state.isSearching}
        onChange={session.setPatternConditions} onSearch={() => { void session.searchPatterns() }} onCancel={session.cancelSearch} />}
    {state.isSearching && <p className="notice" role="status">검색 중…</p>}
    {!state.isSearching && !state.pathValidationError && !state.patternValidationError && (state.mode === 'trace' ? state.response === null : state.mode === 'paths' ? state.pathResponse === null : state.patternResponse === null) && <p className="notice">{canSearch(state) ? (state.mode === 'trace' ? '주소를 입력하고 검색하면 송금 목록이 나옵니다.' : state.mode === 'paths' ? '시작 주소와 대상 주소를 입력하고 경로를 검색해 주세요.' : '기준 주소와 방향을 입력하고 패턴을 검색해 주세요.') : 'READY 데이터셋의 상세 정보를 확인한 뒤 검색할 수 있습니다.'}</p>}
    {state.mode === 'patterns' && <>
      {state.patternValidationError && <p className="notice notice-error" role="alert">{state.patternValidationError}</p>}
      {state.patternResponse && !state.patternResponse.ok && <RequestNotice failure={state.patternResponse} />}
      {state.patternResponse?.ok && <PatternResults envelope={state.patternResponse.envelope} />}
    </>}
    {state.mode === 'paths' && <>
      {state.pathValidationError && <p className="notice notice-error" role="alert">{state.pathValidationError}</p>}
      {state.pathResponse && !state.pathResponse.ok && <RequestNotice failure={state.pathResponse} />}
      {state.pathResponse?.ok && <PathResults result={state.pathResponse.result} selectedPathId={state.selectedPathId} onSelectPath={session.selectPath}
        selectedTransferId={state.selectedTransferId} onSelectTransfer={session.selectTransfer} />}
    </>}
    {state.mode === 'trace' && state.response && !state.response.ok && <RequestNotice failure={state.response} />}
    {state.mode === 'trace' && state.response?.ok && <>
      {state.response.result.sourceMode === 'FIXTURE' && <p className="fixture-badge">합성 데이터(FIXTURE)</p>}
      <p className="applied-conditions">적용 데이터셋: {state.response.result.conditions.datasetId} / {state.response.result.conditions.datasetVersion} · 조건: {formatConditions(state.response.result.conditions)}</p>
      <TraceView result={state.response.result} selectedTransferId={state.selectedTransferId} onSelect={session.selectTransfer} />
    </>}
  </main>
}
