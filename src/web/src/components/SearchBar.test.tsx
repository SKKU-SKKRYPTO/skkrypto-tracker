import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import SearchBar from './SearchBar'
import { DEFAULT_SEARCH_CONDITIONS } from '../searchConditions'
const { setAddress } = vi.hoisted(() => ({ setAddress: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => [initial, setAddress] }))
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
describe('Trace address draft notifications', () => {
  it('updates the local draft and notifies the owner immediately on every edit', () => {
    const onAddressChange = vi.fn(), onSearch = vi.fn()
    const tree = SearchBar({ conditions: DEFAULT_SEARCH_CONDITIONS, isSearching: true, onConditionsChange: vi.fn(), onSearch, onAddressChange })
    const field = elements(tree).find(n => n.props.id === 'address-input')!
    for (const value of ['new address', '', 'old address']) {
      ;(field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } })
      expect(setAddress).toHaveBeenLastCalledWith(value); expect(onAddressChange).toHaveBeenLastCalledWith(value)
    }
    expect(onAddressChange).toHaveBeenCalledTimes(3); expect(onSearch).not.toHaveBeenCalled()
  })
  it('keeps legacy/mock callers working without a draft callback', () => {
    const tree = SearchBar({ conditions: DEFAULT_SEARCH_CONDITIONS, isSearching: false, onConditionsChange: vi.fn(), onSearch: vi.fn() })
    const field = elements(tree).find(n => n.props.id === 'address-input')!
    expect(() => (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'draft' } })).not.toThrow()
  })
})
