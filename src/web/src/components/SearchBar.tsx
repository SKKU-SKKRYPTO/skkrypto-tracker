import { useState } from 'react'
import type { FormEvent } from 'react'
import { DIRECTION_LABELS, DIRECTIONS, MAX_DEPTHS } from '../searchConditions'
import type { Direction, MaxDepth, SearchConditions } from '../searchConditions'

type Props = {
  isSearching: boolean
  disabled?: boolean
  conditions: SearchConditions
  onConditionsChange: (conditions: SearchConditions) => void
  onSearch: (address: string) => void
}

function SearchBar({ isSearching, disabled = false, conditions, onConditionsChange, onSearch }: Props) {
  const [address, setAddress] = useState('')

  // form의 submit을 쓰면 버튼 클릭과 입력창에서 Enter 둘 다 검색이 된다.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!disabled && !isSearching) onSearch(address)
  }

  // 조건 메뉴는 기본 <select>라서 Tab으로 이동하고 방향키로 고를 수 있다.
  return (
    <form className="search-bar" role="search" onSubmit={handleSubmit}>
      <label htmlFor="address-input">주소</label>
      <input
        id="address-input"
        className="mono"
        type="text"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="0x로 시작하는 40자리 주소"
        autoComplete="off"
        spellCheck={false}
      />

      <label htmlFor="direction-select">방향</label>
      <select
        id="direction-select"
        value={conditions.direction}
        onChange={(event) =>
          onConditionsChange({ ...conditions, direction: event.target.value as Direction })
        }
      >
        {DIRECTIONS.map((direction) => (
          <option key={direction} value={direction}>
            {DIRECTION_LABELS[direction]}({direction})
          </option>
        ))}
      </select>

      <label htmlFor="depth-select">깊이</label>
      <select
        id="depth-select"
        value={conditions.maxDepth}
        onChange={(event) =>
          onConditionsChange({
            ...conditions,
            maxDepth: Number(event.target.value) as MaxDepth,
          })
        }
      >
        {MAX_DEPTHS.map((depth) => (
          <option key={depth} value={depth}>
            {depth}단계
          </option>
        ))}
      </select>

      <button type="submit" disabled={isSearching || disabled}>
        {isSearching ? '검색 중…' : '검색'}
      </button>
    </form>
  )
}

export default SearchBar
