import { useState } from 'react'
import type { FormEvent } from 'react'

type Props = {
  isSearching: boolean
  onSearch: (address: string) => void
}

function SearchBar({ isSearching, onSearch }: Props) {
  const [address, setAddress] = useState('')

  // form의 submit을 쓰면 버튼 클릭과 입력창에서 Enter 둘 다 검색이 된다.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSearch(address)
  }

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
      <button type="submit" disabled={isSearching}>
        {isSearching ? '검색 중…' : '검색'}
      </button>
    </form>
  )
}

export default SearchBar
