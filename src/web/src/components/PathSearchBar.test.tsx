import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactNode, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PathSearchBar from './PathSearchBar'
import { DEFAULT_PATH_CONDITIONS, validatePathAddresses } from '../pathConditions'

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function setup(disabled = false, isSearching = false) {
  const props = { conditions: DEFAULT_PATH_CONDITIONS, disabled, isSearching, onChange: vi.fn(), onSearch: vi.fn(), onCancel: vi.fn() }
  const tree = PathSearchBar(props)
  return { props, tree, nodes: elements(tree) }
}
describe('Path search form', () => {
  it('shows endpoints, existing direction/depth choices and only the Path search action', () => {
    const { tree } = setup(), html = renderToStaticMarkup(tree)
    for (const text of ['시작 주소', '대상 주소', 'outgoing', 'incoming', '1단계', '3단계', '경로 검색']) expect(html).toContain(text)
    expect(html).not.toContain('Pattern')
  })
  it.each(['path-address', 'path-target', 'path-direction', 'path-depth'])('forwards controlled %s changes', id => {
    const { props, nodes } = setup()
    const value = id === 'path-depth' ? '3' : id === 'path-direction' ? 'incoming' : '0x123'
    const input = nodes.find(node => node.props.id === id)!
    ;(input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } })
    const key = { 'path-address': 'address', 'path-target': 'targetAddress', 'path-direction': 'direction', 'path-depth': 'maxDepth' }[id]!
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_PATH_CONDITIONS, [key]: id === 'path-depth' ? 3 : value })
  })
  it.each([[false, false, 1], [true, false, 0], [false, true, 0]])('guards form submission (disabled=%s, searching=%s)', (disabled, searching, calls) => {
    const { props, tree } = setup(disabled as boolean, searching as boolean)
    const preventDefault = vi.fn(); tree.props.onSubmit({ preventDefault } as never)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(props.onSearch).toHaveBeenCalledTimes(calls as number)
    if (disabled || searching) expect(renderToStaticMarkup(tree)).toMatch(/<button[^>]*disabled/)
  })
  it('provides a cancel action while searching and leaves inputs editable for invalidation', () => {
    const { nodes, props, tree } = setup(false, true)
    const cancel = nodes.find(node => node.type === 'button' && node.props.type === 'button')!
    ;(cancel.props.onClick as () => void)()
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(renderToStaticMarkup(tree)).toContain('검색 취소')
    expect(nodes.filter(node => node.type === 'input').every(node => !node.props.disabled)).toBe(true)
  })
  it('uses the official Address schema and compares normalized addresses', () => {
    expect(validatePathAddresses(` 0x${'a'.repeat(40)} `, `0x${'b'.repeat(40)}`)).toBeNull()
    expect(validatePathAddresses(`0x${'a'.repeat(40)}`, `0x${'A'.repeat(40)}`)).toContain('서로 달라야')
    expect(validatePathAddresses('0x123', `0x${'b'.repeat(40)}`)).toContain('시작 주소')
    expect(validatePathAddresses(`0x${'a'.repeat(40)}`, '')).toContain('대상 주소')
  })
})
