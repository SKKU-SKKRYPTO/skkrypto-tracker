import AnalysisResultHeader from './components/AnalysisResultHeader'
import JsonDownloadButton from './components/JsonDownloadButton'
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
import './App.css'

const ANALYSIS_MODES = [
  ['trace', 'Trace', '송금 추적', '한 주소에서 시간순 송금 흐름을 추적합니다.'],
  ['paths', 'Path', '경로 탐색', '두 주소 사이의 후보 연결을 확인합니다.'],
  ['patterns', 'Pattern', '패턴 탐지', '분산·합류 형태와 그 근거를 확인합니다.'],
] as const

export default function LiveApp({ session: provided }: { session?: DatasetSession } = {}) {
  const [session] = useState(() => provided ?? createDatasetSession())
  const [traceAddress, setTraceAddress] = useState('')
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => {
    void session.loadDatasets()
    return session.cancelPending
  }, [session])
  return <main className="app">
    <header className="page-heading">
      <div className="brand-lockup">
        <span className="brand-logo" aria-hidden="true"><img src="/trackoon-logo.png" alt="" width="896" height="1200" /></span>
        <h1>Trackoon</h1>
      </div>
    </header>
    <p className="page-intro">온체인 송금 흐름을 분석하고 근거를 확인하는 도구</p>
    <section className="workspace-section" aria-labelledby="dataset-heading">
    <h2 id="dataset-heading">데이터셋 설정</h2>
    <p className="section-description">분석할 데이터셋과 버전, 준비 상태를 확인해 주세요.</p>
    <DatasetSelector state={state} onSelect={key => { void session.selectDataset(key) }} onReload={() => { void session.loadDatasets() }}
      onRetryDetail={() => { if (state.selection) void session.selectDataset(state.selection) }} />
    </section>
    <section className="workspace-section" aria-labelledby="analysis-heading">
    <h2 id="analysis-heading">분석 설정</h2>
    <p className="section-description">분석 종류를 선택하고 주소와 검색 조건을 입력해 주세요.</p>
    <div className="mode-switch" role="group" aria-label="분석 종류">
      {ANALYSIS_MODES.map(([mode, name, label, description]) => <button key={mode} id={'analysis-mode-' + mode} type="button"
        aria-label={`${label}(${name})`} aria-pressed={state.mode === mode} aria-describedby={'mode-description-' + mode} onClick={() => session.setMode(mode as AnalysisMode)}>
        <strong>{name}</strong><span className="mode-label">{label}</span>
        <span className="visually-hidden" id={'mode-description-' + mode}>{description}</span>
      </button>)}
    </div>
    <p className="mode-description">{ANALYSIS_MODES.find(([mode]) => mode === state.mode)![3]}</p>
    {state.mode === 'trace' ? <SearchBar isSearching={state.isSearching} disabled={!canSearch(state)} conditions={state.conditions} address={traceAddress}
      onAddressChange={address => { setTraceAddress(address); session.onTraceAddressChange() }} onConditionsChange={session.setConditions} onSearch={address => { void session.search(address) }} />
      : state.mode === 'paths' ? <PathSearchBar conditions={state.pathConditions} disabled={!canSearch(state)} isSearching={state.isSearching}
        onChange={session.setPathConditions} onSearch={() => { void session.searchPaths() }} onCancel={session.cancelSearch} />
      : <PatternSearchBar conditions={state.patternConditions} disabled={!canSearch(state)} isSearching={state.isSearching}
        onChange={session.setPatternConditions} onSearch={() => { void session.searchPatterns() }} onCancel={session.cancelSearch} />}
    </section>
    <section className="workspace-section" aria-labelledby="results-heading">
    <div className="result-heading"><h2 id="results-heading">분석 결과</h2><JsonDownloadButton session={session} /></div>
    {state.traceResultOutdated && state.mode === 'trace' && state.response?.ok && <p className="notice notice-warning" role="status">검색 조건이 변경되었습니다. 현재 표시된 내용은 이전 검색 결과입니다. 새 조건을 적용하려면 다시 검색해 주세요.</p>}
    <AnalysisResultHeader state={state} />
    {state.isSearching && <p className="notice" role="status">검색 중…</p>}
    {!state.isSearching && !state.pathValidationError && !state.patternValidationError && (state.mode === 'trace' ? state.response === null : state.mode === 'paths' ? state.pathResponse === null : state.patternResponse === null) && <p className="notice">{canSearch(state) ? (state.mode === 'trace' ? '주소를 입력하고 검색하면 송금 목록이 나옵니다.' : state.mode === 'paths' ? '시작 주소와 대상 주소를 입력하고 경로를 검색해 주세요.' : '기준 주소와 방향을 입력하고 패턴을 검색해 주세요.') : 'READY 데이터셋의 상세 정보를 확인한 뒤 검색할 수 있습니다.'}</p>}
    {state.mode === 'patterns' && <>
      {state.patternValidationError && <p className="notice notice-error" role="alert">{state.patternValidationError}</p>}
      {state.patternResponse && !state.patternResponse.ok && <RequestNotice failure={state.patternResponse} />}
      {state.patternResponse?.ok && <PatternResults showContext={false} envelope={state.patternResponse.envelope} selectedPatternId={state.selectedPatternId} onSelectPattern={session.selectPattern}
        selectedTransferId={state.selectedTransferId} onSelectTransfer={session.selectTransfer} />}
    </>}
    {state.mode === 'paths' && <>
      {state.pathValidationError && <p className="notice notice-error" role="alert">{state.pathValidationError}</p>}
      {state.pathResponse && !state.pathResponse.ok && <RequestNotice failure={state.pathResponse} />}
      {state.pathResponse?.ok && <PathResults showContext={false} result={state.pathResponse.result} selectedPathId={state.selectedPathId} onSelectPath={session.selectPath}
        selectedTransferId={state.selectedTransferId} onSelectTransfer={session.selectTransfer} />}
    </>}
    {state.mode === 'trace' && state.response && !state.response.ok && <RequestNotice failure={state.response} />}
    {state.mode === 'trace' && state.response?.ok && <>
      <TraceView result={state.response.result} selectedTransferId={state.selectedTransferId} onSelect={session.selectTransfer} />
    </>}
    </section>
  </main>
}
