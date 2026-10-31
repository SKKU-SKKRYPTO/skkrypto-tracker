import { useRef, useState } from 'react'
import { searchTrace } from './api/trace'
import type { TraceResponse } from './api/trace'
import SearchBar from './components/SearchBar'
import TransferDetail from './components/TransferDetail'
import TransferGraph from './components/TransferGraph'
import TransferTable from './components/TransferTable'
import type { TraceResult } from './types'
import './App.css'

function App() {
  const [response, setResponse] = useState<TraceResponse | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  // 선택은 송금 id 하나로 관리한다. 표·상세·그래프가 이 값을 같이 쓴다.
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null)
  // 검색을 빠르게 여러 번 하면 늦게 온 옛 응답이 새 응답을 덮을 수 있어서, 마지막 검색 번호만 반영한다.
  const latestSearchId = useRef(0)

  async function handleSearch(address: string) {
    const searchId = ++latestSearchId.current
    // 새 검색을 시작하면 이전 결과에서 고른 송금은 선택 해제한다.
    setSelectedTransferId(null)
    setIsSearching(true)
    const nextResponse = await searchTrace(address)
    if (searchId !== latestSearchId.current) return
    setResponse(nextResponse)
    setIsSearching(false)
  }

  return (
    <main className="app">
      {response?.ok && response.result.dataset.mode === 'FIXTURE' && (
        <p className="fixture-badge">합성 데이터(FIXTURE)</p>
      )}

      <h1>송금 목록</h1>

      <SearchBar isSearching={isSearching} onSearch={handleSearch} />

      {response === null && (
        <p className="notice">주소를 입력하고 검색하면 송금 목록이 나옵니다.</p>
      )}

      {response !== null && !response.ok && (
        <p className="notice notice-error" role="alert">
          {response.error.message}
        </p>
      )}

      {response?.ok && (
        <TraceView
          result={response.result}
          selectedTransferId={selectedTransferId}
          onSelect={setSelectedTransferId}
        />
      )}
    </main>
  )
}

type TraceViewProps = {
  result: TraceResult
  selectedTransferId: string | null
  onSelect: (transferId: string) => void
}

function TraceView({ result, selectedTransferId, onSelect }: TraceViewProps) {
  const { dataset, transfers, truncation } = result

  // 빈 결과는 "송금이 없다"가 아니라 "이 수집 범위에서 못 봤다"는 뜻이다.
  // 이때와 오류일 때는 표·그래프 없이 안내 문구만 보여 준다.
  if (transfers.length === 0) {
    return (
      <p className="notice" role="status">
        선택한 수집 범위에서 관측되지 않음 (블록 {dataset.blockRange.from}~
        {dataset.blockRange.to})
      </p>
    )
  }

  const selectedTransfer =
    transfers.find((transfer) => transfer.id === selectedTransferId) ?? null

  return (
    <>
      {result.truncated && truncation !== null && (
        <p className="notice notice-warning" role="status">
          결과가 상한({truncation.reason})에 걸려 일부만 표시됨 · 찾은 송금{' '}
          {truncation.foundCount}건{truncation.isLowerBound ? ' 이상' : ''} 중{' '}
          {transfers.length}건 표시
        </p>
      )}

      <div className="layout">
        <TransferTable
          transfers={transfers}
          token={dataset.token}
          selectedTransferId={selectedTransferId}
          onSelect={onSelect}
        />
        <TransferGraph
          result={result}
          token={dataset.token}
          selectedTransferId={selectedTransferId}
          onSelect={onSelect}
        />
        <TransferDetail transfer={selectedTransfer} token={dataset.token} />
      </div>
    </>
  )
}

export default App
