import traceOk from '../mocks/trace-ok.draft.json'
import { formatUnits, shortenHex } from './format'
import type { TraceResult } from './types'
import './App.css'

const trace: TraceResult = traceOk

function App() {
  const { dataset, transfers } = trace
  const { symbol, decimals } = dataset.token

  return (
    <main className="app">
      {dataset.mode === 'FIXTURE' && (
        <p className="fixture-badge">합성 데이터(FIXTURE)</p>
      )}

      <h1>송금 목록</h1>

      <div className="table-scroll">
        <table className="transfers">
          <thead>
            <tr>
              <th>보낸 주소</th>
              <th>받은 주소</th>
              <th className="num">금액</th>
              <th className="num">블록 번호</th>
              <th>거래 번호</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((transfer) => (
              <tr key={transfer.id}>
                <td className="mono" title={transfer.from}>
                  {shortenHex(transfer.from)}
                </td>
                <td className="mono" title={transfer.to}>
                  {shortenHex(transfer.to)}
                </td>
                <td className="num">
                  {formatUnits(transfer.amount, decimals)} {symbol}
                </td>
                <td className="num">{transfer.blockNumber}</td>
                <td className="mono" title={transfer.transactionHash}>
                  {shortenHex(transfer.transactionHash)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

export default App
