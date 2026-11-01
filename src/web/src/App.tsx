import { useRef, useState } from 'react'
import { buildTraceRequest, searchTrace } from './api/trace'
import type { MockScenario, TraceResponse } from './api/trace'
import SearchBar from './components/SearchBar'
import { DEFAULT_SEARCH_CONDITIONS, formatConditions } from './searchConditions'
import type { SearchConditions } from './searchConditions'
import { searchFailure } from './api/searchFailure'
import TraceView from './components/TraceView'
import './App.css'

function App() {
  const [response, setResponse] = useState<TraceResponse | null>(null)
  const [conditions, setConditions] = useState<SearchConditions>(DEFAULT_SEARCH_CONDITIONS)
  const [scenario, setScenario] = useState<MockScenario>('default')
  const [isSearching, setIsSearching] = useState(false)
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null)
  const latestSearchId = useRef(0)

  async function handleSearch(address: string) {
    const searchId = ++latestSearchId.current
    setSelectedTransferId(null)
    setResponse(null)
    setIsSearching(true)
    try {
      const nextResponse = await searchTrace(buildTraceRequest(address, conditions, scenario))
      if (searchId !== latestSearchId.current) return
      setResponse(nextResponse)
    } catch (error: unknown) {
      if (searchId !== latestSearchId.current) return
      setResponse(searchFailure(error))
    } finally {
      if (searchId === latestSearchId.current) setIsSearching(false)
    }
  }

  function invalidatePendingSearch() {
    // Invalidate synchronously so old success, catch and finally handlers cannot update the UI.
    ++latestSearchId.current
    setIsSearching(false)
    setSelectedTransferId(null)
  }

  function handleConditionsChange(nextConditions: SearchConditions) {
    invalidatePendingSearch()
    setConditions(nextConditions)
  }

  function handleScenarioChange(nextScenario: MockScenario) {
    invalidatePendingSearch()
    setScenario(nextScenario)
  }

  return (
    <main className="app">
      {response?.ok && response.result.sourceMode === 'FIXTURE' && <p className="fixture-badge">합성 데이터(FIXTURE)</p>}
      <h1>송금 목록</h1>
      <p className="notice">flow-demo / v1 · 공식 샘플 Mock (실제 서버에 연결하지 않음)</p>
      <label htmlFor="mock-scenario">Mock 확인 모드 </label>
      <select id="mock-scenario" value={scenario} onChange={event => handleScenarioChange(event.target.value as MockScenario)}>
        <option value="default">기본 샘플</option>
        <option value="candidate-limit">후보 상한 4 (부분 결과 샘플)</option>
      </select>
      <p className="notice">기본: 끝자리 0001 또는 0007 · 보낸 쪽 · 2단계. 부분 결과: 0001 · 보낸 쪽 · 3단계 · 후보 상한 4. 다른 조합의 Mock 미지원은 실제 API의 기능 제한이 아닙니다.</p>
      <SearchBar isSearching={isSearching} conditions={conditions} onConditionsChange={handleConditionsChange} onSearch={handleSearch} />
      {response?.ok && <p className="applied-conditions">적용 조건: {formatConditions(response.result.conditions)}{response.result.conditions.limits?.maxCandidates === 4 ? ' · 후보 상한 4' : ''}</p>}
      {response === null && <p className="notice" role="status">{isSearching ? '검색 중…' : '주소를 입력하고 검색하면 송금 목록이 나옵니다.'}</p>}
      {response !== null && !response.ok && (
        <p className="notice notice-error" role="alert">
          {response.kind === 'api' ? `API 오류 (공식 샘플 · HTTP ${response.status} · ${response.error.code}): ` : response.kind === 'mock-unsupported' ? 'Mock 미지원: ' : response.kind === 'request-failed' ? '요청 실패: ' : '응답 형식 오류: '}
          {response.error.message}
          {response.kind === 'api' && response.error.retryable && ' 잠시 뒤 다시 시도할 수 있습니다.'}
        </p>
      )}
      {response?.ok && <TraceView result={response.result} selectedTransferId={selectedTransferId} onSelect={setSelectedTransferId} />}
    </main>
  )
}

export default App
