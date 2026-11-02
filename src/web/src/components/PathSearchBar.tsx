import type { PathConditions } from '../pathConditions'
import { DIRECTION_LABELS, DIRECTIONS, MAX_DEPTHS } from '../searchConditions'
import type { Direction, MaxDepth } from '../searchConditions'

type Props = {
  conditions: PathConditions; disabled: boolean; isSearching: boolean
  onChange: (conditions: PathConditions) => void; onSearch: () => void; onCancel: () => void
}
export default function PathSearchBar({ conditions, disabled, isSearching, onChange, onSearch, onCancel }: Props) {
  return <form className="search-bar" role="search" aria-label="경로 검색" onSubmit={event => {
    event.preventDefault()
    if (!disabled && !isSearching) onSearch()
  }}>
    <label htmlFor="path-address">시작 주소</label>
    <input id="path-address" className="mono" value={conditions.address} autoComplete="off" spellCheck={false}
      placeholder="0x로 시작하는 40자리 주소" onChange={event => onChange({ ...conditions, address: event.target.value })} />
    <label htmlFor="path-target">대상 주소</label>
    <input id="path-target" className="mono" value={conditions.targetAddress} autoComplete="off" spellCheck={false}
      placeholder="0x로 시작하는 40자리 주소" onChange={event => onChange({ ...conditions, targetAddress: event.target.value })} />
    <label htmlFor="path-direction">방향</label>
    <select id="path-direction" value={conditions.direction} onChange={event => onChange({ ...conditions, direction: event.target.value as Direction })}>
      {DIRECTIONS.map(value => <option key={value} value={value}>{DIRECTION_LABELS[value]}({value})</option>)}
    </select>
    <label htmlFor="path-depth">최대 깊이</label>
    <select id="path-depth" value={conditions.maxDepth} onChange={event => onChange({ ...conditions, maxDepth: Number(event.target.value) as MaxDepth })}>
      {MAX_DEPTHS.map(value => <option key={value} value={value}>{value}단계</option>)}
    </select>
    <button type="submit" disabled={disabled || isSearching}>{isSearching ? '검색 중…' : '경로 검색'}</button>
    {isSearching && <button type="button" onClick={onCancel}>검색 취소</button>}
  </form>
}
