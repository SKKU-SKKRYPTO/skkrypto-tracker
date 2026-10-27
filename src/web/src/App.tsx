import { useState } from 'react'
import traceOk from '../mocks/trace-ok.draft.json'
import TransferDetail from './components/TransferDetail'
import TransferTable from './components/TransferTable'
import type { TraceResult } from './types'
import './App.css'

const trace: TraceResult = traceOk

function App() {
  const { dataset, transfers } = trace
  // 선택은 송금 id 하나로 관리한다. 표·상세(나중에 그래프도)가 이 값을 같이 쓴다.
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null)

  const selectedTransfer =
    transfers.find((transfer) => transfer.id === selectedTransferId) ?? null

  return (
    <main className="app">
      {dataset.mode === 'FIXTURE' && (
        <p className="fixture-badge">합성 데이터(FIXTURE)</p>
      )}

      <h1>송금 목록</h1>

      <div className="layout">
        <TransferTable
          transfers={transfers}
          token={dataset.token}
          selectedTransferId={selectedTransferId}
          onSelect={setSelectedTransferId}
        />
        <TransferDetail transfer={selectedTransfer} token={dataset.token} />
      </div>
    </main>
  )
}

export default App
