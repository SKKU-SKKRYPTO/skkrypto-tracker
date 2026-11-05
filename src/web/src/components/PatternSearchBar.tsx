import type { PatternConditions, PatternDirection } from '../patternConditions'
import { PATTERN_DIRECTION_LABELS } from '../patternConditions'

type Props = {
  conditions: PatternConditions; disabled: boolean; isSearching: boolean
  onChange: (conditions: PatternConditions) => void; onSearch: () => void; onCancel: () => void
}
export default function PatternSearchBar({ conditions, disabled, isSearching, onChange, onSearch, onCancel }: Props) {
  return <form className="search-bar analysis-form" role="search" aria-label="패턴 검색" onSubmit={event => {
    event.preventDefault()
    if (!disabled && !isSearching) onSearch()
  }}>
    <div className="search-field address-field"><label htmlFor="pattern-address">기준 주소</label>
    <input id="pattern-address" className="mono" value={conditions.address} autoComplete="off" spellCheck={false}
      placeholder="0x로 시작하는 40자리 주소" onChange={event => onChange({ ...conditions, address: event.target.value })} /></div>
    <div className="search-field"><label htmlFor="pattern-direction">패턴 방향</label>
    <select id="pattern-direction" value={conditions.direction} onChange={event => onChange({ ...conditions, direction: event.target.value as PatternDirection })}>
      {(Object.keys(PATTERN_DIRECTION_LABELS) as PatternDirection[]).map(direction => <option key={direction} value={direction}>{PATTERN_DIRECTION_LABELS[direction]}</option>)}
    </select></div>
    <div className="search-actions"><button type="submit" disabled={disabled || isSearching}>{isSearching ? '검색 중…' : '패턴 검색'}</button>
    {isSearching && <button className="button-secondary" type="button" onClick={onCancel}>검색 취소</button>}</div>
  </form>
}
