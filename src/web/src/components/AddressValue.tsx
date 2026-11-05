import CopyButton from './CopyButton'
import { shortenHex } from '../format'

export default function AddressValue({ value, label = '주소' }: { value: string; label?: string }) {
  return <div className="address-value">
    <span className="mono" title={value}>{shortenHex(value)}</span>
    <details className="address-details"><summary aria-label={`${label} 전체 주소 보기`}><span aria-hidden="true">보기</span></summary>
      <span className="mono full-value">{value}</span> <CopyButton value={value} label={label} />
    </details>
  </div>
}
