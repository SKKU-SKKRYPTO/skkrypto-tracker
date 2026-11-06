// Manual browser regression harness; not imported by the application entry point.
import { useMemo, useState } from 'react'
import TransferGraph from '../src/components/TransferGraph'
import type { TransferGraphData } from '../src/components/graphElements'
import sample from '../mocks/v1/samples/patterns-success.json'
import '../src/index.css'
import '../src/App.css'

export default function Harness() {
  const [incoming, setIncoming] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [evidence, setEvidence] = useState(false)
  const result = useMemo<TransferGraphData>(() => {
    const center = sample.meta.conditions.address
    const transfers = Array.from({ length: 4 }, (_, i) => {
      const other = `0x${(101 + i % 3).toString(16).padStart(40, '0')}`
      return { ...sample.data.transfers[0], transferType: 'TRANSFER' as const, id: `test:long:${i}`, amountRaw: (BigInt('0x' + 'f'.repeat(64)) - BigInt(i)).toString(),
        from: incoming ? other : center, to: incoming ? center : other }
    })
    return { nodes: [], transfers, conditions: { address: center }, startLabel: '기준' }
  }, [incoming])
  return <main className="app">
    <h1>긴 금액 그래프 검증 전용</h1>
    <p>uint256 최대값 부근의 금액 4건 / 고유 상대 3개 / 동일 주소 쌍 2건</p>
    <button onClick={() => setIncoming(!incoming)}>{incoming ? 'FAN_OUT으로 전환' : 'FAN_IN으로 전환'}</button>
    <button onClick={() => setEvidence(!evidence)}>근거 강조 전환</button>
    <div className="analysis-workspace trace-workspace">
      <TransferGraph result={result} controls selectedTransferId={selected} onSelect={setSelected} evidenceKind="pattern"
        highlightedTransferIds={new Set(evidence ? result.transfers.map(t => t.id) : [])} />
    </div>
    <p role="status">선택 ID: {selected ?? '없음'}</p>
    {result.transfers.map(t => <button key={t.id} onClick={() => setSelected(t.id)}>{t.id} 선택</button>)}
  </main>
}
