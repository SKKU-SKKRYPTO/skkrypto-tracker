import type { Transfer } from '../api/v1Types'
import { shortenHex } from '../format'

export default function WorkspaceSelection({ group, transfer }: { group?: string | null; transfer: Transfer | null }) {
  return <div className="workspace-selection" role="status">
    {group !== undefined && <p>선택한 분석 결과: {group ?? '없음'}</p>}
    <p>선택한 개별 송금: {transfer ? <span className="mono" title={transfer.id}>{shortenHex(transfer.id)}</span> : '없음'}</p>
    <p>{group === undefined ? '굵은 실선·선택됨 = 개별 송금' : '굵은 점선·근거 표시 = 선택한 경로 또는 패턴의 송금 · 굵은 실선·선택됨 = 개별 송금'}</p>
    {transfer && <a href="#detail-title">선택한 송금 상세로 이동</a>}
  </div>
}
